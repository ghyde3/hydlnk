import { createBrowserSupabase } from "@/lib/supabase/browser";
import { createDraftSaver } from "@/lib/editor/save-client";
import { postEntryDraft } from "@/lib/site-pages/entry-save-client";
import type { DraftDoc } from "@/lib/document";
import { nextRev } from "./restore";
import type { RestoredEntry } from "./types";

/**
 * The browser side of Restore's Undo (M6-50, 1b1-21). Both calls use the signed-in user's own session
 * and the publishable key, so RLS decides, exactly as the editor's own saves do.
 *
 * Before the screen calls `restorePageVersion` it reads the site's drafts here (`readDraft`): the
 * design (`pages.draft`) and every page entry (Home's blocks and the sub-pages) with its draft. Undo
 * writes them back (`undoRestore`) through the normal saves, each with its rev guard: a write is
 * conditional on the rev the restore left behind, so it never overwrites anything saved after the
 * restore (the editor, another tab), and the design carries a newer rev than the restore did, so an
 * editor tab open on the old draft still meets its stale-tab guard afterwards.
 */

export interface SavedEntry {
  id: string;
  /** The entry's draft as stored. */
  draft: Record<string, unknown>;
}

export interface SavedDraft {
  /** The stored `pages.draft`, as it was, rev included (its `blocks` are the frozen copy once Home is an entry). */
  draft: Record<string, unknown>;
  /** The site's live page entries as they were: Home ('/') and the sub-pages. Empty on a site with no entries. */
  entries: SavedEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The drafts as stored, or null when they cannot be read (then the restore is not offered an Undo). */
export async function readDraft(pageId: string): Promise<SavedDraft | null> {
  const supabase = createBrowserSupabase();
  const { data, error } = await supabase
    .from("pages")
    .select("draft")
    .eq("id", pageId)
    .maybeSingle();
  if (error || !data || !isRecord(data.draft)) return null;
  const found = await supabase
    .from("content_entries")
    .select("id, draft, content_types!inner(key)")
    .eq("site_id", pageId)
    .eq("content_types.key", "page")
    .is("deleted_at", null);
  if (found.error) return null;
  const entries: SavedEntry[] = [];
  for (const row of found.data) {
    if (!isRecord(row.draft)) return null;
    entries.push({ id: row.id, draft: row.draft });
  }
  return { draft: data.draft, entries };
}

export type UndoOutcome = "ok" | "conflict" | "error";

/**
 * Put the snapshot back. `restored` is the restore's answer: each entry it wrote, with the rev it has
 * now. Pages first (a conflict there stops before the design moves), Home with the design last.
 */
export async function undoRestore(
  pageId: string,
  saved: SavedDraft,
  restored: readonly RestoredEntry[],
): Promise<UndoOutcome> {
  const revOf = new Map(restored.map((entry) => [entry.id, entry.rev]));
  const home = saved.entries.find((entry) => entry.draft.path === "/") ?? null;

  for (const entry of saved.entries) {
    if (entry === home) continue;
    const rev = revOf.get(entry.id);
    if (rev === undefined) continue;
    const answer = await postEntryDraft(pageId, entry.id, rev, entry.draft);
    if (answer.kind === "ok") continue;
    return answer.kind === "conflict" ? "conflict" : "error";
  }

  // The restore wrote `rev + 1`; the write back carries one more and is conditional on that.
  const restoredRev = nextRev(saved.draft);
  const doc = {
    ...saved.draft,
    // With a Home entry the saver sends the blocks there; the frozen copy is never sent back.
    ...(home ? { blocks: home.draft.blocks } : {}),
    rev: restoredRev + 1,
  } as unknown as DraftDoc;
  const homeRev = home ? revOf.get(home.id) : undefined;
  if (home && homeRev === undefined) return "error";
  const saver = createDraftSaver(
    pageId,
    home && homeRev !== undefined ? { entryId: home.id, rev: homeRev } : null,
  );
  const result = await saver(doc, String(restoredRev));
  if (result.kind === "ok") return "ok";
  return result.kind === "conflict" ? "conflict" : "error";
}
