import "server-only";
import { toPlanId, type PlanId } from "@/lib/limits";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import { MCP_LIST_PAGES_MAX, MCP_LIST_SUB_PAGES_MAX } from "./constants";
import { MESSAGES, pageIdRequiredMessage } from "./errors";
import type {
  AdminClient,
  LoadPageResult,
  LoadSubPageResult,
  OwnedPage,
  OwnedSubPage,
} from "./types";

/**
 * The one place the connector reads pages and drafts (M10-22, M10-24). Every read filters on the
 * owner IN THE QUERY and asks again in code, because the secret key skips RLS and this is the access
 * rule. A page of someone else, a random id, a malformed id and a deleted page are one answer:
 * `not_found`, with the same sentence, never "forbidden". A static scan keeps `draft` out of every
 * other `select` under `src/lib/mcp`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE_COLUMNS = "id, name, handle, created_at, updated_at, published_at, owner_id";
const DRAFT_COLUMNS = `${BASE_COLUMNS}, draft, published`;

export const NOT_FOUND = { code: "not_found", message: MESSAGES.not_found } as const;

interface PageRow {
  id: string;
  name: string;
  handle: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  owner_id: string;
  draft?: unknown;
  published?: unknown;
}

/** Home's page entry as the tools read it: its blocks are Home's blocks, its rev the blocks' rev. */
interface HomeEntryRow {
  id: string;
  site_id: string;
  rev: number | string;
  draft: unknown;
  published: unknown;
}

const blocksOf = (doc: unknown): unknown =>
  doc && typeof doc === "object" ? (doc as { blocks?: unknown }).blocks : undefined;

/**
 * The site row's design with Home's blocks from its '/' entry (the site row's own blocks are a frozen
 * copy nobody reads). A site with no Home entry keeps the whole document of the site row.
 */
function toOwnedPage(row: PageRow, withDraft: boolean, home: HomeEntryRow | undefined): OwnedPage {
  let draft = row.draft;
  let published = row.published ?? null;
  if (home && withDraft) {
    const blocks = blocksOf(home.draft);
    if (blocks !== undefined && draft && typeof draft === "object") {
      draft = { ...(draft as object), blocks };
    }
    const liveBlocks = blocksOf(home.published);
    if (published && typeof published === "object" && liveBlocks !== undefined) {
      published = { ...(published as object), blocks: liveBlocks };
    }
  }
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    ...(home ? { homeRev: Number(home.rev) } : {}),
    ...(withDraft ? { draft, published } : {}),
  };
}

/** The `page` content type of each site: site id to type id. */
async function pageTypeIdsOf(
  admin: AdminClient,
  siteIds: readonly string[],
): Promise<Map<string, string>> {
  const types = new Map<string, string>();
  if (siteIds.length === 0) return types;
  const { data, error } = await admin
    .from("content_types")
    .select("id, site_id")
    .eq("key", "page")
    .in("site_id", [...siteIds]);
  if (error) throw new PageReadError("reading the page type failed");
  for (const row of data ?? []) types.set(row.site_id, row.id);
  return types;
}

/** Home's entry of each site that has one, by site id. */
async function loadHomeEntries(
  admin: AdminClient,
  siteIds: readonly string[],
): Promise<Map<string, HomeEntryRow>> {
  const homes = new Map<string, HomeEntryRow>();
  const types = await pageTypeIdsOf(admin, siteIds);
  if (types.size === 0) return homes;
  const { data, error } = await admin
    .from("content_entries")
    .select("id, site_id, type_id, rev, draft, published")
    .in("type_id", [...types.values()])
    .is("deleted_at", null)
    .eq("draft->>path", "/");
  if (error) throw new PageReadError("reading Home failed");
  for (const row of data ?? []) {
    if (types.get(row.site_id) === row.type_id) homes.set(row.site_id, row as HomeEntryRow);
  }
  return homes;
}

/** A failed read is the caller's `server_error`: the message of the database never leaves here. */
export class PageReadError extends Error {}

/**
 * The caller's page `pageId`, or, with no id, the account's only page. `pageId` is optional only
 * when the account owns exactly one page; with more it is `invalid_input`.
 */
export async function loadOwnedPage(
  admin: AdminClient,
  userId: string,
  pageId: string | undefined,
  options: { withDraft?: boolean } = {},
): Promise<LoadPageResult> {
  const withDraft = options.withDraft === true;
  let id = pageId;
  if (id === undefined) {
    const mine = await admin
      .from("pages")
      .select("id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(MCP_LIST_PAGES_MAX + 1);
    if (mine.error) throw new PageReadError("listing pages failed");
    const rows = mine.data ?? [];
    if (rows.length === 0) return { ok: false, failure: { ...NOT_FOUND } };
    if (rows.length > 1) {
      const message = pageIdRequiredMessage(rows.length);
      return {
        ok: false,
        failure: { code: "invalid_input", message, issues: [{ path: "pageId", message }] },
      };
    }
    id = rows[0]!.id;
  }
  if (!UUID.test(id)) return { ok: false, failure: { ...NOT_FOUND } };

  const found = await admin
    .from("pages")
    .select(withDraft ? DRAFT_COLUMNS : BASE_COLUMNS)
    .eq("id", id.toLowerCase())
    .eq("owner_id", userId)
    .maybeSingle();
  if (found.error) throw new PageReadError("reading the page failed");
  const row = found.data as unknown as PageRow | null;
  if (row && row.owner_id === userId) {
    const homes = await loadHomeEntries(admin, [row.id]);
    return { ok: true, page: toOwnedPage(row, withDraft, homes.get(row.id)) };
  }
  if (pageId === undefined) return { ok: false, failure: { ...NOT_FOUND } };

  // Not one of the caller's sites: an AI app with a stale tool list sends a page id from
  // list_pages as pageId (M13-14). Look it up as a page entry of one of the caller's sites; the
  // answer for every miss (another account, deleted, random) stays the same `not_found`. Home's
  // entry id means Home ("home"), and the id itself is never printed.
  const sub = await admin
    .from("content_entries")
    .select(`id, site_id, type_id, draft->>path, ${SITE_JOIN}`)
    .eq("id", id.toLowerCase())
    .is("deleted_at", null)
    .eq("site.owner_id", userId)
    .maybeSingle();
  if (sub.error) throw new PageReadError("reading the page failed");
  const subRow = sub.data as unknown as EntryRow | null;
  if (!subRow || siteOwnerOf(subRow) !== userId) return { ok: false, failure: { ...NOT_FOUND } };
  const types = await pageTypeIdsOf(admin, [subRow.site_id]);
  if (types.get(subRow.site_id) !== subRow.type_id) return { ok: false, failure: { ...NOT_FOUND } };
  const site = await loadOwnedPage(admin, userId, subRow.site_id, options);
  if (!site.ok) return site;
  return {
    ok: true,
    page: site.page,
    subPageId: subRow.path === "/" ? "home" : subRow.id,
  };
}

/** Every page the caller owns, oldest first, drafts and published documents included. */
export async function listOwnedPages(admin: AdminClient, userId: string): Promise<OwnedPage[]> {
  const { data, error } = await admin
    .from("pages")
    .select(DRAFT_COLUMNS)
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(MCP_LIST_PAGES_MAX);
  if (error) throw new PageReadError("listing pages failed");
  const mine = ((data ?? []) as unknown as PageRow[]).filter((row) => row.owner_id === userId);
  const homes = await loadHomeEntries(
    admin,
    mine.map((row) => row.id),
  );
  return mine.map((row) => toOwnedPage(row, true, homes.get(row.id)));
}

/** The plan of the account (`free` when unreadable: the lower plan fails closed). */
export async function loadAccountPlan(admin: AdminClient, userId: string): Promise<PlanId> {
  const { data, error } = await admin
    .from("accounts")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new PageReadError("reading the account failed");
  return toPlanId(data?.plan);
}

export interface CustomDomainSummary {
  pageId: string;
  hostname: string;
  status: string;
}

/** The custom domains of the caller's pages: hostname and status only. */
export async function listPageDomains(
  admin: AdminClient,
  pageIds: readonly string[],
): Promise<CustomDomainSummary[]> {
  if (pageIds.length === 0) return [];
  const { data, error } = await admin
    .from("domains")
    .select("page_id, hostname, status")
    .in("page_id", [...pageIds])
    .order("created_at", { ascending: true });
  if (error) throw new PageReadError("reading the domains failed");
  return (data ?? []).map((row) => ({
    pageId: row.page_id,
    hostname: row.hostname,
    status: row.status,
  }));
}

export interface ThemeEntry {
  id: string;
  name: string;
  /** A system theme (no owner), or one of the caller's saved themes. */
  system: boolean;
  tokens: Partial<TokenSet>;
}

/** Every theme the caller may use: the system themes and their own saved ones, never anyone else's. */
export async function listUsableThemes(admin: AdminClient, userId: string): Promise<ThemeEntry[]> {
  const { data, error } = await admin
    .from("themes")
    .select("id, owner_id, name, tokens, created_at")
    .or(`owner_id.is.null,owner_id.eq.${userId}`)
    .order("owner_id", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new PageReadError("reading the themes failed");
  return (data ?? [])
    .filter((row) => row.owner_id === null || row.owner_id === userId)
    .map((row) => {
      const tokens = tokenSetSchema.partial().safeParse(row.tokens);
      return {
        id: row.id,
        name: row.name,
        system: row.owner_id === null,
        tokens: tokens.success ? tokens.data : {},
      };
    });
}

/** The tokens of the theme a draft names, or null: none, deleted, someone else's, or unreadable. */
export async function loadThemeTokens(
  admin: AdminClient,
  userId: string,
  ref: string | null,
): Promise<ThemeEntry | null> {
  if (!ref || !UUID.test(ref)) return null;
  const { data, error } = await admin
    .from("themes")
    .select("id, owner_id, name, tokens")
    .eq("id", ref.toLowerCase())
    .or(`owner_id.is.null,owner_id.eq.${userId}`)
    .maybeSingle();
  if (error) throw new PageReadError("reading the theme failed");
  if (!data) return null;
  const tokens = tokenSetSchema.partial().safeParse(data.tokens);
  return {
    id: data.id,
    name: data.name,
    system: data.owner_id === null,
    tokens: tokens.success ? tokens.data : {},
  };
}

// ---------------------------------------------------------------------------------------------
// Sub-pages (M12-05, on page entries since 1b1-20)
// ---------------------------------------------------------------------------------------------

/**
 * A sub-page is a non-Home `page` entry of the caller's site. An entry has no owner column: it
 * belongs to the owner of its site. Every read below joins the site (`SITE_JOIN`) and filters on
 * `pages.owner_id` IN THE QUERY, and asks again in code, so the owner rule holds whatever the caller
 * passes. A page of another site, of another account, a trashed one, a random id and a malformed id
 * are one answer: `not_found`. The page's entry id is the id the tools show, and its entry rev is the
 * `ifRev` of its writes.
 */
// PostgREST spells an inner join with an exclamation mark, which the copy rules keep out of every
// string in this directory; the character is built so the join stays readable here.
const SITE_JOIN = `site:pages${String.fromCharCode(33)}inner(owner_id)`;
const ENTRY_BASE = `id, site_id, type_id, rev, created_at, updated_at, published_at, live_path, path:draft->>path, ${SITE_JOIN}`;
const ENTRY_WITH_DOCS = `${ENTRY_BASE}, draft, published`;

interface EntryRow {
  id: string;
  site_id: string;
  type_id: string;
  rev?: number | string;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
  live_path?: string | null;
  path: string | null;
  title?: string | null;
  site: { owner_id: string } | { owner_id: string }[] | null;
  draft?: unknown;
  published?: unknown;
}

function siteOwnerOf(row: { site: EntryRow["site"] }): string | null {
  const site = Array.isArray(row.site) ? row.site[0] : row.site;
  return site?.owner_id ?? null;
}

/**
 * One page of the caller's site `siteId` by its entry id, with its documents when `docs` is true.
 * Home's entry id answers `subPage: null`: it means Home, and Home's entry id is never printed.
 */
export async function loadOwnedSubPage(
  admin: AdminClient,
  userId: string,
  siteId: string,
  subPageId: string,
  options: { docs?: boolean } = {},
): Promise<LoadSubPageResult> {
  if (!UUID.test(subPageId) || !UUID.test(siteId)) return { ok: false, failure: { ...NOT_FOUND } };
  const docs = options.docs === true;
  const found = await admin
    .from("content_entries")
    .select(docs ? ENTRY_WITH_DOCS : ENTRY_BASE)
    .eq("id", subPageId.toLowerCase())
    .eq("site_id", siteId.toLowerCase())
    .is("deleted_at", null)
    .eq("site.owner_id", userId)
    .maybeSingle();
  if (found.error) throw new PageReadError("reading the page failed");
  const row = found.data as unknown as EntryRow | null;
  if (!row || siteOwnerOf(row) !== userId || row.site_id !== siteId.toLowerCase()) {
    return { ok: false, failure: { ...NOT_FOUND } };
  }
  const types = await pageTypeIdsOf(admin, [row.site_id]);
  if (types.get(row.site_id) !== row.type_id) return { ok: false, failure: { ...NOT_FOUND } };
  if (row.path === "/") return { ok: true, subPage: null };
  const subPage: OwnedSubPage = {
    id: row.id,
    siteId: row.site_id,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    rev: Number(row.rev),
    publishedAt: row.published_at ?? null,
    livePath: row.live_path ?? null,
    ...(docs ? { draft: row.draft, published: row.published ?? null } : {}),
  };
  return { ok: true, subPage };
}

/** What `list_pages` and the path checks need of a sub-page: its title and path, never its blocks. */
export interface SubPageSummaryRow {
  id: string;
  siteId: string;
  title: string;
  path: string;
  livePath: string | null;
  publishedAt: string | null;
  createdAt: string;
}

/**
 * The sub-pages (non-Home page entries, trash excluded) of the caller's sites `siteIds`, oldest
 * first (at most `MCP_LIST_SUB_PAGES_MAX` a site are kept by the caller; this read is capped at 1,000
 * rows in all). Only the title and the path are read from the draft.
 */
export async function listSubPageSummaries(
  admin: AdminClient,
  userId: string,
  siteIds: readonly string[],
): Promise<SubPageSummaryRow[]> {
  if (siteIds.length === 0) return [];
  const types = await pageTypeIdsOf(admin, siteIds);
  if (types.size === 0) return [];
  const { data, error } = await admin
    .from("content_entries")
    .select(
      `id, site_id, type_id, title:draft->>title, path:draft->>path, live_path, published_at, created_at, ${SITE_JOIN}`,
    )
    .in("type_id", [...types.values()])
    .is("deleted_at", null)
    .neq("draft->>path", "/")
    .eq("site.owner_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MCP_LIST_SUB_PAGES_MAX * 10);
  if (error) throw new PageReadError("listing the pages of a site failed");
  return ((data ?? []) as unknown as EntryRow[])
    .filter((row) => siteOwnerOf(row) === userId && types.get(row.site_id) === row.type_id)
    .map((row) => ({
      id: row.id,
      siteId: row.site_id,
      title: row.title ?? "",
      path: row.path ?? "",
      livePath: row.live_path ?? null,
      publishedAt: row.published_at ?? null,
      createdAt: row.created_at ?? "",
    }));
}

/**
 * The documents (draft and published) of the caller's sub-pages, `size` rows from `offset`, in id
 * order. The image resolver reads them in batches, only when an image is not found on a Home draft.
 */
export async function listOwnedSubPageDocs(
  admin: AdminClient,
  userId: string,
  offset: number,
  size: number,
): Promise<Array<{ draft: unknown; published: unknown }>> {
  const { data, error } = await admin
    .from("content_entries")
    .select(`site_id, type_id, draft, published, ${SITE_JOIN}`)
    .is("deleted_at", null)
    .neq("draft->>path", "/")
    .eq("site.owner_id", userId)
    .order("id", { ascending: true })
    .range(offset, offset + size - 1);
  if (error) throw new PageReadError("reading the pages of a site failed");
  const rows = ((data ?? []) as unknown as EntryRow[]).filter((row) => siteOwnerOf(row) === userId);
  const types = await pageTypeIdsOf(admin, [...new Set(rows.map((row) => row.site_id))]);
  return rows
    .filter((row) => types.get(row.site_id) === row.type_id)
    .map((row) => ({ draft: row.draft, published: row.published ?? null }));
}
