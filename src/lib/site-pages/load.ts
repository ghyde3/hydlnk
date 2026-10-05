import "server-only";
import {
  draftSubPageSchema,
  emptySubPageDraft,
  publishedSubPageSchema,
  type SubPageDraft,
  type SubPagePublish,
} from "@/lib/document";
import { createServerSupabase } from "@/lib/supabase/server";

/** One sub-page as the editor opens it. */
export interface LoadedSubPage {
  id: string;
  draft: SubPageDraft;
  /** The page's published document, or null when it was never published (or cannot be read). */
  published: SubPagePublish | null;
  livePath: string | null;
  createdAt: string;
}

/** Keeps what a stored draft still holds when it does not validate: the strings that are strings. */
function repair(raw: unknown, fallbackPath: string): SubPageDraft {
  const parsed = draftSubPageSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const base = emptySubPageDraft(
    typeof record.path === "string" ? record.path : fallbackPath,
    typeof record.title === "string" && record.title !== "" ? record.title : "New page",
  );
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.filter(
        (block) => draftSubPageSchema.shape.blocks.element.safeParse(block).success,
      )
    : [];
  return {
    ...base,
    description: typeof record.description === "string" ? record.description : "",
    blocks,
  };
}

/**
 * Every sub-page of a site, read with the signed-in user's own session under RLS (M11-08): the
 * owner reads their own rows and nobody else's. A stored draft that does not validate is repaired
 * to the nearest valid document, like Home's (nothing is written until the owner edits).
 */
export async function loadSubPages(siteId: string): Promise<LoadedSubPage[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("site_pages")
    .select("id, draft, published, live_path, created_at")
    .eq("page_id", siteId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Loading the pages of site ${siteId} failed: ${error.message}`);
  return data.map((row) => {
    const published =
      row.published === null ? null : publishedSubPageSchema.safeParse(row.published);
    return {
      id: row.id,
      draft: repair(row.draft, row.live_path ?? "page"),
      published: published?.success ? published.data : null,
      livePath: row.live_path,
      createdAt: row.created_at,
    };
  });
}
