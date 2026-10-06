import "server-only";
import { publishedDocSchema, type PublishDoc } from "@/lib/document";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadDraft, type LoadedDraft } from "./load";

export interface EditorPageData extends LoadedDraft {
  /** The draft's theme row (system or the owner's own), or null: none, deleted or unreadable. */
  themeTokens: Partial<TokenSet> | null;
  hasPublished: boolean;
  /** `pages.published_at` (an ISO time) or null: it versions the live /og URL the share card shows (M6-33). */
  publishedAt: string | null;
  published: PublishDoc | null;
}

/**
 * Everything the editor screen needs about one page, read with the signed-in user's own session
 * and the publishable key (never the secret key: RLS decides what is readable). The caller has
 * already picked the page from the user's own pages; the owner filter below is a second guard.
 *
 *   draft         `pages.draft`, repaired to a valid document when it is not one (see loadDraft)
 *   theme         `themes.tokens` for `draft.theme.ref`: system themes and the owner's own are
 *                 readable, anything else (or a deleted row) reads as no theme
 *   published     `pages.published` parsed with the strict schema; unreadable reads as null while
 *                 `hasPublished` (from `published_at`) still says the page was published
 */
export async function loadEditorPageData(
  page: { id: string; handle: string },
  ownerId: string,
): Promise<EditorPageData> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("pages")
    // `draft_rev` is Postgres' own `draft->>'rev'`: the stale-tab guard filters on exactly that text,
    // so it is read from the database rather than re-derived (an object or 1.50 as rev would differ).
    .select("draft, published, published_at, draft_rev:draft->>rev")
    .eq("id", page.id)
    .eq("owner_id", ownerId)
    .single();
  if (error) throw new Error(`Loading the draft for page ${page.id} failed: ${error.message}`);

  const loaded = { ...loadDraft(data.draft, page.handle), revKey: data.draft_rev ?? null };

  let themeTokens: Partial<TokenSet> | null = null;
  const ref = loaded.draft.theme.ref;
  if (ref) {
    const theme = await supabase.from("themes").select("tokens").eq("id", ref).maybeSingle();
    if (theme.error) throw new Error(`Loading theme ${ref} failed: ${theme.error.message}`);
    const parsed = tokenSetSchema.partial().safeParse(theme.data?.tokens);
    themeTokens = parsed.success ? parsed.data : null;
  }

  const parsedPublished =
    data.published === null ? null : publishedDocSchema.safeParse(data.published);
  return {
    ...loaded,
    themeTokens,
    hasPublished: data.published_at !== null,
    publishedAt: data.published_at ?? null,
    published: parsedPublished?.success ? parsedPublished.data : null,
  };
}
