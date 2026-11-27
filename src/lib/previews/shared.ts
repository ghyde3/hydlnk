import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOME_TARGET,
  documentAt,
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
import { getHomeDraftWithClient, listDraftPagesWithClient } from "@/lib/site/page-entries";
import { buildMenu, hrefsOf, type SiteContext, type SitePageSummary } from "@/lib/site/menu";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import { postDraftSchema } from "@/lib/content/schemas/post";
import type { TermView } from "@/lib/blog/types";
import { sanitizeSharedDoc, sanitizeSharedPost } from "./sanitize";
import { hashPreviewToken, isPreviewTokenShape } from "./token";
import type { SharedPost } from "./types";

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
 * What it shows has the hidden characters the Publish gate refuses removed (`sanitizeSharedDoc`,
 * and `sanitizeSharedPost` for a post).
 *
 * `/share/{token}/entry/{entryId}` (M16-16) shows one post's saved draft: the share preview is the
 * only place a post draft is ever shown to someone who is not its owner. The entry is looked up
 * inside the link's own site (`loadDraftPost`), after every token check.
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
      /**
       * The post being previewed when the address is `/share/{token}/entry/{entryId}` (M16-16): an
       * untrashed post of this link's own site, its saved draft. Absent for Home and for a page.
       */
      post?: SharedPost;
      /** When the link stops working (ISO, UTC). */
      expiresAt: string;
    };

/** The one address form of a post preview: `entry/` and a canonical (lower-case) UUID, nothing else. */
const ENTRY_TAIL = /^entry\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The entry id when `path` is exactly `entry/{uuid}`, else null. */
export function sharedEntryId(path: string): string | null {
  return ENTRY_TAIL.exec(path)?.[1] ?? null;
}

export async function loadSharedPreview(
  admin: SupabaseClient<Database>,
  token: unknown,
  now: Date = new Date(),
  /**
   * What follows the token in the address: "" for Home, one valid path segment for a page (M12-06),
   * or exactly `entry/{uuid}` for a post (M16-16).
   */
  path: string = "",
): Promise<SharedPreview> {
  if (!isPreviewTokenShape(token)) return { kind: "inactive" };
  // A tail that is neither a post's address nor a path a page could have (nested, reserved, odd
  // characters) is the one 404 and never a query.
  const entryId = typeof path === "string" ? sharedEntryId(path) : null;
  if (entryId === null && path !== "" && !isValidSubPagePath(path)) return { kind: "inactive" };

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

  const site: DraftPreviewPage = {
    id: page.id,
    handle: page.handle,
    ownerId: page.owner_id,
    draft: page.draft,
    plan: page.accounts.plan,
  };
  const base = `/share/${token as string}`;
  if (entryId === null) {
    return loadDraftPreview(admin, site, { path, base, expiresAt: data.expires_at, now });
  }

  // A post (M16-16). The site is the link row's and nothing else: the entry is looked up inside it,
  // so a token of one site can never draw an entry of another, whatever id the address carries.
  const post = await loadDraftPost(admin, { siteId: site.id, ownerId: site.ownerId }, entryId);
  if (!post) return { kind: "inactive" };
  // The design, the cleaned site document and the menu, as for Home; nothing is marked current.
  const preview = await loadDraftPreview(admin, site, {
    path: "",
    base,
    expiresAt: data.expires_at,
    currentId: entryId,
    now,
  });
  return preview.kind === "active" ? { ...preview, post } : preview;
}

/**
 * One post's saved draft for a preview (M16-16), or null. `site` is the page the caller already
 * resolved (the share link's own row); the entry must be an untrashed entry of THAT site's built-in
 * Post type. Another site's entry, a page entry, a trashed post, an unknown id and a stored draft
 * that is not a post's shape are all null. Named columns only: the draft and the first publish
 * date, never the published copy. Its terms are read inside the same site and type, so an id of
 * another site's term in the draft names nothing. Every text has the hidden characters removed.
 */
export async function loadDraftPost(
  admin: SupabaseClient<Database>,
  site: { siteId: string; ownerId: string },
  entryId: string,
): Promise<SharedPost | null> {
  if (sharedEntryId(`entry/${entryId}`) === null) return null;
  const type = await admin
    .from("content_types")
    .select("id, archive_path")
    .eq("site_id", site.siteId)
    .eq("key", "post")
    .maybeSingle();
  if (type.error) throw new Error(`Loading the post type failed: ${type.error.message}`);
  if (!type.data) return null;

  const entry = await admin
    .from("content_entries")
    .select("id, draft, first_published_at")
    .eq("id", entryId)
    .eq("site_id", site.siteId)
    .eq("type_id", type.data.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (entry.error) throw new Error(`Loading a post draft failed: ${entry.error.message}`);
  if (!entry.data) return null;
  const parsed = postDraftSchema.safeParse(entry.data.draft);
  if (!parsed.success) return null;
  const draft = parsed.data;
  const text = sanitizeSharedPost(draft);

  // The terms the draft names, categories first, each in the draft's order; at most the schema's 50.
  const wanted = [...(draft.terms?.categories ?? []), ...(draft.terms?.tags ?? [])];
  const terms: TermView[] = [];
  if (wanted.length > 0) {
    const found = await admin
      .from("content_terms")
      .select("id, taxonomy, slug, name")
      .eq("site_id", site.siteId)
      .eq("type_id", type.data.id)
      .in("id", wanted);
    if (found.error) throw new Error(`Loading a post's terms failed: ${found.error.message}`);
    const byId = new Map((found.data ?? []).map((term) => [term.id, term]));
    const seen = new Set<string>();
    for (const id of wanted) {
      const term = byId.get(id);
      if (!term || seen.has(id)) continue;
      if (term.taxonomy !== "category" && term.taxonomy !== "tag") continue;
      seen.add(id);
      terms.push({
        id: term.id,
        taxonomy: term.taxonomy,
        slug: term.slug,
        name: stripHiddenCharacters(term.name),
      });
    }
  }

  // A draft image may be half-saved (an upload in progress): drawn only when it is whole. The
  // article component checks again that it is a file of this owner's own folder.
  const image = draft.featuredImage as
    { path?: unknown; width?: unknown; height?: unknown } | null | undefined;
  const featuredImage =
    image &&
    typeof image.path === "string" &&
    typeof image.width === "number" &&
    typeof image.height === "number"
      ? { path: image.path, width: image.width, height: image.height }
      : null;

  return {
    entryId: entry.data.id,
    view: {
      title: text.title,
      body: text.body,
      excerpt: text.excerpt,
      publishedAt: entry.data.first_published_at,
      featuredImage,
    },
    terms,
    ownerId: site.ownerId,
    archivePath: type.data.archive_path ?? "",
  };
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
  options: {
    path: string;
    base: string;
    expiresAt: string;
    /**
     * Set when what is drawn is neither Home nor a page (a post, M16-16): the menu is always built
     * and the entry with this id is the current one (none, for a post).
     */
    currentId?: string;
    /** The instant the draft is drawn for (Wave E, M20-06): blocks outside their time window are not drawn. */
    now?: Date;
  },
): Promise<SharedPreview> {
  const { path, base, expiresAt } = options;
  const at = (options.now ?? new Date()).getTime();
  // The design is the site row's; Home's blocks are its page entry's draft (the blocks frozen in
  // `pages.draft` by the move are never read). A site with no Home entry has not been moved: its
  // `pages.draft` is the whole document, as the editor reads it.
  const home = await getHomeDraftWithClient(admin, page.id);
  const { draft } = loadDraft(
    home ? { ...(page.draft as Record<string, unknown>), blocks: home.draft.blocks } : page.draft,
    page.handle,
  );

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
  if (path !== "" || options.currentId !== undefined || homeUsesSiteIndex(doc)) {
    const entries = await listDraftPagesWithClient(admin, page.id);
    const listed = entries.map((entry) => ({
      id: entry.id,
      path: entry.draft.path,
      title: entry.draft.title,
    }));
    const summaries = listed.flatMap((row): SitePageSummary[] => {
      if (typeof row.path !== "string" || typeof row.title !== "string") return [];
      const title = stripHiddenCharacters(row.title).trim();
      return title === "" ? [] : [{ id: row.id, path: row.path, title }];
    });
    let currentId = options.currentId ?? HOME_TARGET;
    if (path !== "") {
      const match = summaries.find((entry) => entry.path.trim() === path);
      // No page of this site at that path: the same 404 as an inactive link.
      if (!match) return { kind: "inactive" };
      currentId = match.id;
      // That one page's whole draft (the entry came from this link's own site).
      const full = entries.find((entry) => entry.id === match.id);
      const parsed = draftSubPageSchema.safeParse(full?.draft);
      if (!parsed.success) return { kind: "inactive" };
      const publishForm = toSubPagePublishForm(parsed.data);
      // The same cleaning as Home: hidden characters out of every text.
      const cleaned = sanitizeSharedDoc({ ...doc, blocks: publishForm.blocks });
      subPage = {
        title: stripHiddenCharacters(publishForm.title),
        blocks: cleaned.blocks,
      };
    }
    // The site's archives that are on (the Blog, M16-08) join the menu as on the live site: the type's
    // id, its path and its plural label. The preview has no archive of its own, so such an item keeps
    // the live address, which the preview frame does not follow.
    const types = await admin
      .from("content_types")
      .select("id, archive_path, label_plural")
      .eq("site_id", page.id)
      .eq("enabled", true);
    if (types.error) throw new Error(`Loading the site's archives failed: ${types.error.message}`);
    const archives = (types.data ?? []).flatMap((type): SitePageSummary[] => {
      const archivePath = type.archive_path;
      const title = stripHiddenCharacters(type.label_plural ?? "").trim();
      if (typeof archivePath !== "string" || !isValidSubPagePath(archivePath) || title === "") {
        return [];
      }
      return [{ id: type.id, path: archivePath, title }];
    });
    const archiveHrefs = new Set(archives.map((archive) => `/${archive.path}`));
    // The menu is the draft's: Home and the sub-pages in Home's order, the current one marked, every
    // page entry a link to this same preview. Page links resolve to the same addresses.
    const toShare = (href: string) => (href === "/" ? base : `${base}${href}`);
    const menu = buildMenu(doc.nav, [...summaries, ...archives], currentId, "links");
    const hrefs: Record<string, string> = { [HOME_TARGET]: base };
    for (const [id, href] of Object.entries(hrefsOf(summaries))) hrefs[id] = toShare(href);
    site = {
      hrefs,
      menu: menu
        ? {
            ...menu,
            items: menu.items.map((item) =>
              archiveHrefs.has(item.href) ? item : { ...item, href: toShare(item.href) },
            ),
          }
        : null,
    };
  }

  // The draft as a visitor would see it now (M20-06): a block outside its time window is not drawn.
  return {
    kind: "active",
    pageId: page.id,
    doc: documentAt(doc, at),
    plan: page.plan,
    expiresAt,
    ...(site ? { site } : {}),
    ...(subPage ? { subPage: documentAt(subPage, at) } : {}),
  };
}
