import type { SupabaseClient } from "@supabase/supabase-js";
import { stripHiddenCharacters, toPublishForm, type PublishDoc } from "@/lib/document";
import { loadDraft } from "@/lib/editor/load";
import type { Database } from "@/lib/supabase/database.types";
import { homeUsesSiteIndex } from "@/lib/site/live";
import { buildMenu, hrefsOf, type SiteContext, type SitePageSummary } from "@/lib/site/menu";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import { sanitizeSharedDoc } from "./sanitize";
import { hashPreviewToken, isPreviewTokenShape } from "./token";

/**
 * What a share link shows (M6-10): the page's saved draft, read at the moment of the request, by the
 * link's token. Written against an injected secret-key client so tests drive it without Next.js (and
 * can spy on it: a token that is not 43 base64url characters never makes a query).
 *
 * Every way a link can fail to be active answers the same `inactive`, so nothing tells an unknown
 * token from an expired, turned-off, suspended or deleted one: malformed, no such hash, `revoked_at`
 * set, `expires_at` passed, the owner's account suspended. A deleted page takes its links with it
 * (cascade), so it reads as no such hash.
 *
 * What it shows has the hidden characters the Publish gate refuses removed (`sanitizeSharedDoc`).
 *
 * The one query selects named columns only and reads nothing of the owner's account but the plan (the
 * footer badge) and the suspension state. The token's hash is the only key: the page comes from the
 * link row, so a token can never draw another page, whatever else the request carries.
 */

export type SharedPreview =
  | { kind: "inactive" }
  | {
      kind: "active";
      pageId: string;
      /** The draft as saved, as the publish form the renderer draws. */
      doc: PublishDoc;
      /** The owner's plan: the "Made with HYDLNK" badge follows it. */
      plan: string;
      /**
       * The rest of the site as the draft has it (M11-07): the menu as plain text (the preview never
       * leaves the draft) and the hrefs of its page links. Absent when Home uses neither. Previews
       * of the sub-pages themselves are M2.
       */
      site?: SiteContext;
      /** When the link stops working (ISO, UTC). */
      expiresAt: string;
    };

export async function loadSharedPreview(
  admin: SupabaseClient<Database>,
  token: unknown,
  now: Date = new Date(),
): Promise<SharedPreview> {
  if (!isPreviewTokenShape(token)) return { kind: "inactive" };

  const { data, error } = await admin
    .from("preview_links")
    .select(
      "expires_at, revoked_at, pages!inner(id, handle, owner_id, draft, accounts!inner(plan, suspended_at))",
    )
    .eq("token_hash", hashPreviewToken(token))
    .maybeSingle();
  // A database failure is a 500, never "not active": the owner's link is fine, the server is not.
  if (error) throw new Error(`Loading a shared preview failed: ${error.message}`);
  if (!data) return { kind: "inactive" };
  if (data.revoked_at !== null) return { kind: "inactive" };
  if (new Date(data.expires_at).getTime() <= now.getTime()) return { kind: "inactive" };

  const page = data.pages;
  if (page.accounts.suspended_at !== null) return { kind: "inactive" };

  const { draft } = loadDraft(page.draft, page.handle);

  // The draft's theme row: a system theme or one of the owner's own (what the editor's own read
  // sees under RLS). Anything else, or a deleted row, reads as no theme.
  let themeTokens: Partial<TokenSet> | null = null;
  const ref = draft.theme.ref;
  if (ref) {
    const theme = await admin
      .from("themes")
      .select("tokens")
      .eq("id", ref)
      .or(`owner_id.is.null,owner_id.eq.${page.owner_id}`)
      .maybeSingle();
    if (theme.error) throw new Error(`Loading theme ${ref} failed: ${theme.error.message}`);
    const parsed = tokenSetSchema.partial().safeParse(theme.data?.tokens);
    themeTokens = parsed.success ? parsed.data : null;
  }

  // A draft never met the Publish gate: what the gate refuses in text (control and bidi
  // characters) is taken out of what is shown. The stored draft is not touched.
  const doc = sanitizeSharedDoc(toPublishForm(draft, themeTokens));

  // The menu of the draft, as plain text (M11-07). The sub-pages' drafts are read only when Home
  // draws a menu or a page link, with the named columns of the link's own page.
  let site: SiteContext | undefined;
  if (homeUsesSiteIndex(doc)) {
    const rows = await admin.from("site_pages").select("id, draft").eq("page_id", page.id);
    if (rows.error)
      throw new Error(`Loading the pages of a shared preview failed: ${rows.error.message}`);
    const summaries = (rows.data ?? []).flatMap((row): SitePageSummary[] => {
      const body = row.draft as { path?: unknown; title?: unknown } | null;
      if (typeof body?.path !== "string" || typeof body.title !== "string") return [];
      const title = stripHiddenCharacters(body.title).trim();
      return title === "" ? [] : [{ id: row.id, path: body.path, title }];
    });
    site = { hrefs: hrefsOf(summaries), menu: buildMenu(doc.nav, summaries, "home", "text") };
  }

  return {
    kind: "active",
    pageId: page.id,
    doc,
    plan: page.accounts.plan,
    expiresAt: data.expires_at,
    ...(site ? { site } : {}),
  };
}
