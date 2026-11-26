import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";
import { nextRev } from "./restore";

/**
 * The browser side of Restore's Undo (M6-50; design only since M15-10). Both calls use the signed-in
 * user's own session and the publishable key, so RLS decides, exactly as the editor's own saves do.
 *
 * A restore writes the site's design (`pages.draft`) and no page. Before the screen calls
 * `restorePageVersion` it reads that draft here (`readDraft`); Undo writes it back (`undoRestore`),
 * conditional on the rev the restore left behind, so it never overwrites anything saved after the
 * restore (the editor, another tab), and it carries a newer rev than the restore did, so an editor
 * tab open on the old draft still meets its stale-tab guard afterwards. No page entry is read or
 * written: the pages were not restored, so there is nothing of theirs to put back.
 */

export interface SavedDraft {
  /** The stored `pages.draft`, as it was, rev and frozen `blocks` included. */
  draft: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The design draft as stored, or null when it cannot be read (then the restore is not offered an Undo). */
export async function readDraft(pageId: string): Promise<SavedDraft | null> {
  const { data, error } = await createBrowserSupabase()
    .from("pages")
    .select("draft")
    .eq("id", pageId)
    .maybeSingle();
  if (error || !data || !isRecord(data.draft)) return null;
  return { draft: data.draft };
}

export type UndoOutcome = "ok" | "conflict" | "error";

/**
 * Put the design back. The restore wrote `rev + 1`; the write back carries one more and matches only
 * a draft still at the restore's rev. Anything saved since (another tab, an MCP tool) matches no row
 * and answers `conflict`, with nothing written. The frozen `blocks` go back exactly as they were
 * read, which is what the database still holds (a restore never changes them).
 */
export async function undoRestore(pageId: string, saved: SavedDraft): Promise<UndoOutcome> {
  const restoredRev = nextRev(saved.draft);
  const { data, error } = await createBrowserSupabase()
    .from("pages")
    .update({ draft: { ...saved.draft, rev: restoredRev + 1 } as unknown as Json })
    .eq("id", pageId)
    .eq("draft->>rev", String(restoredRev))
    .select("id");
  if (error) return "error";
  return data.length === 0 ? "conflict" : "ok";
}
