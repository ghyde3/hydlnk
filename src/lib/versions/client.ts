import { createBrowserSupabase } from "@/lib/supabase/browser";
import { createDraftSaver } from "@/lib/editor/save-client";
import type { DraftDoc } from "@/lib/document";
import { nextRev } from "./restore";

/**
 * The browser side of Restore's Undo (M6-50). Both calls use the signed-in user's own session and
 * the publishable key, so RLS decides, exactly as the editor's own draft saves do.
 *
 * Before the screen calls `restorePageVersion` it reads the draft here (`readDraft`); Undo writes
 * that same draft back (`undoRestore`) through the normal draft save, with the rev guard: the write
 * is conditional on the rev the restore left behind, so it never overwrites anything that was saved
 * after the restore (the editor, another tab), and it carries a newer rev than the restore did, so
 * an editor tab open on the old draft still meets its stale-tab guard afterwards.
 */

export interface SavedDraft {
  /** The stored `pages.draft`, as it was, rev included. */
  draft: Record<string, unknown>;
}

/** The draft as stored, or null when it cannot be read (then the restore is not offered an Undo). */
export async function readDraft(pageId: string): Promise<SavedDraft | null> {
  const { data, error } = await createBrowserSupabase()
    .from("pages")
    .select("draft")
    .eq("id", pageId)
    .maybeSingle();
  if (error || !data) return null;
  const draft = data.draft;
  if (typeof draft !== "object" || draft === null || Array.isArray(draft)) return null;
  return { draft: draft as Record<string, unknown> };
}

export type UndoOutcome = "ok" | "conflict" | "error";

export async function undoRestore(pageId: string, saved: SavedDraft): Promise<UndoOutcome> {
  // The restore wrote `rev + 1`; the write back carries one more and is conditional on that.
  const restoredRev = nextRev(saved.draft);
  const doc = { ...saved.draft, rev: restoredRev + 1 } as unknown as DraftDoc;
  const result = await createDraftSaver(pageId)(doc, String(restoredRev));
  if (result.kind === "ok") return "ok";
  return result.kind === "conflict" ? "conflict" : "error";
}
