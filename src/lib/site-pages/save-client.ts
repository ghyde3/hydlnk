import { readBlockedLinkError } from "@/lib/blocklist/error";
import { scheduleMediaCleanup } from "@/lib/media/cleanup-client";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";
import type { SubSaveFn } from "./saver";

/**
 * The revision of every sub-page the editor holds (M15-01): the row's `updated_at` exactly as the
 * database returned it, the same notion MCP's writer uses (`src/lib/editor/draft-write.ts`, where a
 * sub-page's `rev` is its `updated_at` in milliseconds). The string is kept whole, not the
 * milliseconds, because the column has microseconds and the guard is an equality.
 */
export interface SubPageRevisions {
  get(id: string): string | undefined;
  set(id: string, updatedAt: string): void;
  delete(id: string): void;
  /**
   * Re-reads the revisions of a site's sub-pages. Publish and Unpublish write `published` on every
   * sub-page row, which moves `updated_at` without changing a draft, so the editor adopts the new
   * value after them (it has flushed first, so nothing of its own is unsaved).
   */
  refresh(siteId: string): Promise<void>;
}

export function createSubPageRevisions(
  initial: Readonly<Record<string, string>>,
): SubPageRevisions {
  const map = new Map(Object.entries(initial));
  return {
    get: (id) => map.get(id),
    set: (id, updatedAt) => void map.set(id, updatedAt),
    delete: (id) => void map.delete(id),
    async refresh(siteId) {
      const { data, error } = await createBrowserSupabase()
        .from("site_pages")
        .select("id, updated_at")
        .eq("page_id", siteId);
      if (error || !data) return;
      for (const row of data) map.set(row.id, row.updated_at);
    },
  };
}

/**
 * The browser-side write of a sub-page's draft (M11-08): an update of `site_pages.draft` with the
 * user's own session and the publishable key, so RLS decides (the owner, not suspended). The write is
 * conditional on the revision the editor last loaded or saved (`updated_at`), so a change made
 * elsewhere (an MCP client) is never overwritten: an update that matches no row while the page still
 * exists is a conflict. The rest is the mapping of Home's `createDraftSaver`: a CHECK violation
 * (23514) is a draft too large for the database, a 401 is a gone session, HL005 is a link to a
 * blocked site, and a write that matches no row of a page that no longer exists means it was deleted
 * elsewhere.
 */
export function createSubPageSaveFn(revisions: SubPageRevisions): SubSaveFn {
  return async (id, doc) => {
    const revision = revisions.get(id);
    // Never write without a revision to check against: reloading gives the editor one.
    if (revision === undefined) return { kind: "conflict" };
    const supabase = createBrowserSupabase();
    const { data, error, status } = await supabase
      .from("site_pages")
      .update({ draft: doc as unknown as Json })
      .eq("id", id)
      .eq("updated_at", revision)
      .select("id, updated_at");
    if (error) {
      if (status === 401) return { kind: "unauthorized" };
      const blocked = readBlockedLinkError(error);
      if (blocked) return { kind: "blocked", ...blocked };
      if (error.code === "HL009") return { kind: "storage-full" };
      return error.code === "23514" ? { kind: "too-large" } : { kind: "error" };
    }
    if (data.length === 0) {
      // Nothing matched: someone saved first, or the page is gone.
      const still = await supabase.from("site_pages").select("id").eq("id", id);
      if (still.error) return { kind: "error" };
      return still.data.length > 0 ? { kind: "conflict" } : { kind: "missing" };
    }
    revisions.set(id, data[0]!.updated_at);
    scheduleMediaCleanup();
    return { kind: "ok" };
  };
}
