import { readBlockedLinkError } from "@/lib/blocklist/error";
import { scheduleMediaCleanup } from "@/lib/media/cleanup-client";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";
import type { SubSaveFn } from "./saver";

/**
 * The browser-side write of a sub-page's draft (M11-08): an update of `site_pages.draft` with the
 * user's own session and the publishable key, so RLS decides (the owner, not suspended). The same
 * mapping as Home's `createDraftSaver`: a CHECK violation (23514) is a draft too large for the
 * database, a 401 is a gone session, HL005 is a link to a blocked site, and a write that matches no
 * row means the page was deleted elsewhere.
 */
export function createSubPageSaveFn(): SubSaveFn {
  return async (id, doc) => {
    const { data, error, status } = await createBrowserSupabase()
      .from("site_pages")
      .update({ draft: doc as unknown as Json })
      .eq("id", id)
      .select("id");
    if (error) {
      if (status === 401) return { kind: "unauthorized" };
      const blocked = readBlockedLinkError(error);
      if (blocked) return { kind: "blocked", ...blocked };
      if (error.code === "HL009") return { kind: "storage-full" };
      return error.code === "23514" ? { kind: "too-large" } : { kind: "error" };
    }
    if (data.length === 0) return { kind: "missing" };
    scheduleMediaCleanup();
    return { kind: "ok" };
  };
}
