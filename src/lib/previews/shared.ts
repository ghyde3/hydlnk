import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOME_TARGET,
  draftSubPageSchema,
  isValidSubPagePath,
  stripHiddenCharacters,
  toPublishForm,
  toSubPagePublishForm,
  type Block,
  type PublishDoc,
} from "@/lib/document";
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
       * The rest of the site as the draft has it (M11-07, M12-06): a working menu and the hrefs of its
       * page links, all pointing at this same link's addresses (`/share/{token}` and
       * `/share/{token}/{path}`), never at a tenant host. Absent when nothing needs it.
       */
      site?: SiteContext;
      /** The page being previewed when the address named one (M12-06): its title and blocks. Absent for Home. */
      subPage?: { title: string; blocks: readonly Block[] };
      /** When the link stops working (ISO, UTC). */
      expiresAt: string;
    };

export async function loadSharedPreview(
  admin: SupabaseClient<Database>,
  token: unknown,
  now: Date = new Date(),
  /** What follows the token in the address ("" for Home, one valid path segment for a page, M12-06). */
  path: string = "",
): Promise<SharedPreview> {
  if (!isPreviewTokenShape(token)) return { kind: "inactive" };
  // A path that cannot be a page's (nested, reserved, odd characters) is the one 404 and never a query.
  if (path !== "" && !isValidSubPagePath(path)) return { kind: "inactive" };

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

  return loadDraftPreview(
    admin,
    {
      id: page.id,
      handle: page.handle,
      ownerId: page.owner_id,
      draft: page.draft,
      plan: page.accounts.plan,
    },
    { path, base: `/share/${token as string}`, expiresAt: data.expires_at },
  );
}

/** A page row as `loadDraftPreview` needs it. */
export interface DraftPreviewPage {
  id: string;
  handle: string;
  ownerId: string;
  draft: unknown;
  plan: string;
}

/**
 * The part of a preview that does not depend on how the caller got to the page: the draft's theme,
 * the cleaned document, and the rest of the site (menu and page links) with every address under
 * `base`. The share link calls it after its token checks (`base` = `/share/{token}`); the admin
 * draft view (M13-11) calls it with its own base, so the two draw the same thing the same way.
 * `path` was already checked by the caller (`""` for Home, else one valid sub-page path).
 */
export async function loadDraftPreview(
  admin: SupabaseClient<Database>,
  page: DraftPreviewPage,
  options: { path: string; base: string; expiresAt: string },
): Promise<SharedPreview> {
  const { path, base, expiresAt } = options;
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
      .or(`owner_id.is.null,owner_id.eq.${page.ownerId}`)
      .maybeSingle();
    if (theme.error) throw new Error(`Loading theme ${ref} failed: ${theme.error.message}`);
    const parsed = tokenSetSchema.partial().safeParse(theme.data?.tokens);
    themeTokens = parsed.success ? parsed.data : null;
  }

  // A draft never met the Publish gate: what the gate refuses in text (control and bidi
  // characters) is taken out of what is shown. The stored draft is not touched.
  const doc = sanitizeSharedDoc(toPublishForm(draft, themeTokens));

  // The site as the draft has it (M11-07, M12-06). The sub-pages' titles and paths are read only when
  // the address names a page, or Home draws a menu or a page link: named columns, never whole drafts.
  let site: SiteContext | undefined;
  let subPage: { title: string; blocks: readonly Block[] } | undefined;
  if (path !== "" || homeUsesSiteIndex(doc)) {
    const rows = await admin
      .from("site_pages")
      .select("id, path:draft->>path, title:draft->>title")
      .eq("page_id", page.id);
    if (rows.error)
      throw new Error(`Loading the pages of a shared preview failed: ${rows.error.message}`);
    const listed = (rows.data ?? []).map((row) => {
      const { path: rowPath, title } = row as unknown as {
        path: string | null;
        title: string | null;
      };
      return { id: row.id, path: rowPath, title };
    });
    const summaries = listed.flatMap((row): SitePageSummary[] => {
      if (typeof row.path !== "string" || typeof row.title !== "string") return [];
      const title = stripHiddenCharacters(row.title).trim();
      return title === "" ? [] : [{ id: row.id, path: row.path, title }];
    });
    let currentId = HOME_TARGET;
    if (path !== "") {
      const match = summaries.find((entry) => entry.path.trim() === path);
      // No page of this site at that path: the same 404 as an inactive link.
      if (!match) return { kind: "inactive" };
      currentId = match.id;
      // That one page's whole draft, by its id (which came from this link's own site).
      const full = await admin
        .from("site_pages")
        .select("draft")
        .eq("id", match.id)
        .eq("page_id", page.id)
        .maybeSingle();
      if (full.error)
        throw new Error(`Loading a page of a shared preview failed: ${full.error.message}`);
      const parsed = draftSubPageSchema.safeParse(full.data?.draft);
      if (!parsed.success) return { kind: "inactive" };
      const publishForm = toSubPagePublishForm(parsed.data);
      // The same cleaning as Home: hidden characters out of every text.
      const cleaned = sanitizeSharedDoc({ ...doc, blocks: publishForm.blocks });
      subPage = {
        title: stripHiddenCharacters(publishForm.title),
        blocks: cleaned.blocks,
      };
    }
    // The menu is the draft's: Home and the sub-pages in Home's order, the current one marked, every
    // entry a link to this same preview. Page links resolve to the same addresses.
    const toShare = (href: string) => (href === "/" ? base : `${base}${href}`);
    const menu = buildMenu(doc.nav, summaries, currentId, "links");
    const hrefs: Record<string, string> = { [HOME_TARGET]: base };
    for (const [id, href] of Object.entries(hrefsOf(summaries))) hrefs[id] = toShare(href);
    site = {
      hrefs,
      menu: menu
        ? { ...menu, items: menu.items.map((item) => ({ ...item, href: toShare(item.href) })) }
        : null,
    };
  }

  return {
    kind: "active",
    pageId: page.id,
    doc,
    plan: page.plan,
    expiresAt,
    ...(site ? { site } : {}),
    ...(subPage ? { subPage } : {}),
  };
}
