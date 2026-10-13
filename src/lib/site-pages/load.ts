import "server-only";
import {
  draftSubPageSchema,
  emptySubPageDraft,
  publishedSubPageSchema,
  type SubPageDraft,
  type SubPagePublish,
} from "@/lib/document";
import { listDraftPagesWithClient } from "@/lib/site/page-entries-core";
import { createServerSupabase } from "@/lib/supabase/server";

/** One sub-page as the editor opens it. */
export interface LoadedSubPage {
  id: string;
  draft: SubPageDraft;
  /** The page's published document, or null when it was never published (or cannot be read). */
  published: SubPagePublish | null;
  livePath: string | null;
  createdAt: string;
  /** The page entry's `rev`: the revision the editor's saves are checked against (M15-01, 1b1-17). */
  rev: number;
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
 * Every sub-page of a site: its non-Home page entries that are not in the trash, read with the
 * signed-in user's own session under RLS (M11-08, 1b1-17), so the owner reads their own entries and
 * nobody else's. A stored draft that does not validate is repaired to the nearest valid document,
 * like Home's (nothing is written until the owner edits).
 */
export async function loadSubPages(siteId: string): Promise<LoadedSubPage[]> {
  const supabase = await createServerSupabase();
  const pages = await listDraftPagesWithClient(supabase, siteId);
  return pages.map((row) => {
    const published =
      row.published === null || row.published === undefined
        ? null
        : publishedSubPageSchema.safeParse(row.published);
    return {
      id: row.id,
      draft: repair(row.draft, row.livePath ?? "page"),
      published: published?.success ? published.data : null,
      livePath: row.livePath,
      createdAt: row.createdAt,
      rev: row.rev,
    };
  });
}
