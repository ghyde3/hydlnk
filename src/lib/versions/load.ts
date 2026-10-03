import "server-only";
import { publishFormsEqual, toPublishForm } from "@/lib/document";
import { loadEditorPageData } from "@/lib/editor/page-data";
import { computePublishStatus } from "@/lib/editor/status";
import { createServerSupabase } from "@/lib/supabase/server";

/** One row of the history list, with everything the client needs and none of the document. */
export interface HistoryRow {
  id: string;
  versionNo: number;
  /** ISO time of the Publish; the screen shows it in the viewer's time zone. */
  publishedAt: string;
  /** This version's document equals the page's current published document. */
  live: boolean;
}

export interface HistoryData {
  versions: HistoryRow[];
  /** The draft's publish form differs from the live document (or the page was never published). */
  hasUnpublished: boolean;
}

/**
 * What the version history screen lists (M6-50), read with the signed-in user's own session and the
 * publishable key, never the secret key: RLS lets the owner read `page_versions` only while the plan
 * keeps versions, so a plan that does not simply gets no rows (the screen does not ask in that case
 * at all). Newest first, at most `limit` (the plan's `versionsKept`).
 *
 * `live` compares each stored document with the page's published document the way the editor
 * compares a draft (`publishFormsEqual`: key order does not matter), and the documents themselves
 * stay on the server: up to 25 of them would be a heavy thing to send for a list. `hasUnpublished`
 * is the editor's own status rule, for the "You have unpublished changes" line of the confirmation.
 *
 * Throws when anything cannot be read; the page turns that into its "We couldn’t load your
 * versions" card.
 */
export async function loadHistory(
  page: { id: string; handle: string },
  ownerId: string,
  limit: number,
): Promise<HistoryData> {
  const supabase = await createServerSupabase();
  const [rows, live, editor] = await Promise.all([
    supabase
      .from("page_versions")
      .select("id, version_no, published_at, document")
      .eq("page_id", page.id)
      .order("version_no", { ascending: false })
      .limit(limit),
    supabase.from("pages").select("published").eq("id", page.id).eq("owner_id", ownerId).single(),
    loadEditorPageData(page, ownerId),
  ]);
  if (rows.error)
    throw new Error(`Loading the versions of page ${page.id} failed: ${rows.error.code}`);
  if (live.error) throw new Error(`Loading the live page ${page.id} failed: ${live.error.code}`);

  const status = computePublishStatus({
    hasPublished: editor.hasPublished,
    published: editor.published,
    form: toPublishForm(editor.draft, editor.themeTokens),
  });

  return {
    versions: rows.data.map((row) => ({
      id: row.id,
      versionNo: row.version_no,
      publishedAt: row.published_at,
      live: live.data.published !== null && publishFormsEqual(row.document, live.data.published),
    })),
    hasUnpublished: status !== "published",
  };
}
