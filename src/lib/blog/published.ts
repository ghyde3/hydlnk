import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postPublishSchema } from "@/lib/content/schemas/post";
import { IMAGE_PATH_PATTERN, LIMITS } from "@/lib/document";
import { isValidSubPagePath } from "@/lib/document/path";
import {
  PAGE_REVALIDATE_SECONDS,
  PUBLIC_READ_CACHE_VERSION,
  entryTag,
  pageTag,
  typeTag,
} from "@/lib/publish/tags";
import type { Database } from "@/lib/supabase/database.types";
import { plainExcerpt } from "./markdown";
import {
  ARCHIVE_PAGE_SIZE,
  POST_INDEX_MAX,
  SLUG_REDIRECTS_KEPT,
  TERMS_PER_TYPE,
  postHref,
  type ArchiveSummary,
  type LatestPosts,
  type PostCard,
  type PostIndex,
  type PostIndexItem,
  type PublishedPost,
  type SiteArchives,
  type TermIndexItem,
} from "./types";

/**
 * The public reads of the blog (Wave B, M16): published columns only, the secret key (so these
 * queries are the access rule), cached in the Data Cache under the site, type and entry tags.
 *
 * Published only. Every read of `content_entries` here carries the two conditions
 * `published is not null` and `deleted_at is null` and selects from `published` (or the generated
 * `live_slug`), never from `draft`: a draft, an unpublished post and a trashed post do not exist
 * for these functions. Callers check the SITE first (published, owner not suspended) with the
 * public read of Home, exactly as the sub-page reads do.
 *
 * What is cached, and under which key (plan 3.3). Keys never hold anything a visitor typed:
 *
 *   getSiteArchives   ["tenant-site-archives", v, siteId]     page:<siteId>
 *   getSiteOwnerId    ["tenant-site-owner", v, siteId]        page:<siteId>
 *   getPostIndex      ["tenant-post-index", v, typeId]        type:<typeId>, page:<siteId>
 *   getTermIndex      ["tenant-term-index", v, typeId]        type:<typeId>
 *   getSlugRedirects  ["tenant-slug-redirects", v, typeId]    type:<typeId>
 *   getLatestPosts    ["tenant-latest-posts", v, typeId]      type:<typeId>, page:<siteId>
 *                     ["tenant-latest-posts", v, typeId, categoryId]  (one per category a block names)
 *
 * `getPublishedPost`, `getPostCards` and the two page reads are not cached on their own: they are
 * called from inside the cached HTML of a real post or a proven archive page (`post-html.ts`,
 * `archive-html.ts`), which is the one entry per real thing. `next dev` reads Postgres every time.
 */

type Admin = SupabaseClient<Database>;

/** Loaded on first read, not at import: modules that only need the shapes load without the server env. */
let adminModule: Promise<typeof import("@/lib/supabase/admin")> | undefined;
async function adminClient(): Promise<Admin> {
  // One import, shared: several reads of one request start together.
  adminModule ??= import("@/lib/supabase/admin");
  return (await adminModule).createAdminSupabase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** PostgREST answers at most this many rows per request (supabase/config.toml `max_rows`). */
const READ_CHUNK = 1000;

/** `unstable_cache` in production, the function itself in `next dev` (as every public read). */
function cached<A extends unknown[], R>(
  read: (...args: A) => Promise<R>,
  key: string[],
  tags: string[],
): (...args: A) => Promise<R> {
  if (process.env.NODE_ENV !== "production") return read;
  return unstable_cache(read, key, { tags, revalidate: PAGE_REVALIDATE_SECONDS });
}

// The site's archives ----------------------------------------------------------------------------

async function readSiteArchives(siteId: string): Promise<SiteArchives> {
  const client = await adminClient();
  const types = await client
    .from("content_types")
    .select("id, key, label, label_plural, archive_path")
    .eq("site_id", siteId)
    .eq("enabled", true)
    .neq("key", "page")
    .not("archive_path", "is", null)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (types.error) {
    throw new Error(`Loading the archives of site ${siteId} failed: ${types.error.message}`);
  }
  const archives: ArchiveSummary[] = [];
  for (const row of types.data ?? []) {
    if (typeof row.archive_path !== "string" || !isValidSubPagePath(row.archive_path)) continue;
    archives.push({
      typeId: row.id,
      key: row.key,
      path: row.archive_path,
      label: row.label,
      labelPlural: row.label_plural,
      pageSize: ARCHIVE_PAGE_SIZE,
    });
  }
  if (archives.length === 0) return { archives, pagesWithPostLists: [] };

  // The live pages that hold a latest-posts block: their cached HTML also carries the type's tag.
  const pages = await client
    .from("content_entries")
    .select("id, content_types!inner(key)")
    .eq("site_id", siteId)
    .eq("content_types.key", "page")
    .is("deleted_at", null)
    .not("published", "is", null)
    .filter("published->blocks", "cs", JSON.stringify([{ type: "latest_posts" }]));
  if (pages.error) {
    throw new Error(`Loading the post lists of site ${siteId} failed: ${pages.error.message}`);
  }
  return { archives, pagesWithPostLists: (pages.data ?? []).map((row) => row.id) };
}

/** The site's enabled archives. Tag `page:<siteId>`. */
export function getSiteArchives(siteId: string): Promise<SiteArchives> {
  if (!isUuid(siteId)) return Promise.resolve({ archives: [], pagesWithPostLists: [] });
  return cached(
    readSiteArchives,
    ["tenant-site-archives", PUBLIC_READ_CACHE_VERSION, siteId],
    [pageTag(siteId)],
  )(siteId);
}

async function readSiteOwnerId(siteId: string): Promise<string | null> {
  const { data, error } = await (
    await adminClient()
  )
    .from("pages")
    .select("owner_id")
    .eq("id", siteId)
    .maybeSingle();
  if (error) throw new Error(`Loading the owner of site ${siteId} failed: ${error.message}`);
  return data?.owner_id ?? null;
}

/**
 * The uid of the site's owner: the folder a post's images must sit in to be drawn. The id only,
 * never shown. Tag `page:<siteId>`.
 */
export function getSiteOwnerId(siteId: string): Promise<string | null> {
  if (!isUuid(siteId)) return Promise.resolve(null);
  return cached(
    readSiteOwnerId,
    ["tenant-site-owner", PUBLIC_READ_CACHE_VERSION, siteId],
    [pageTag(siteId)],
  )(siteId);
}

// The post index ---------------------------------------------------------------------------------

/** The live posts of one type, newest first by first publish date. Every list read starts here. */
function liveEntries<S extends string>(client: Admin, siteId: string, typeId: string, select: S) {
  return client
    .from("content_entries")
    .select(select, { count: "exact" })
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .is("deleted_at", null)
    .not("published", "is", null)
    .not("live_slug", "is", null)
    .order("first_published_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });
}

const INDEX_COLUMNS =
  "id, live_slug, first_published_at, published_at, title:published->>title, noindex:published->seo->noindex";

interface IndexRow {
  id: string;
  live_slug: string | null;
  first_published_at: string | null;
  published_at: string | null;
  title: string | null;
  noindex: unknown;
}

function indexItem(row: IndexRow): PostIndexItem | null {
  const publishedAt = row.first_published_at ?? row.published_at;
  if (typeof row.live_slug !== "string" || typeof publishedAt !== "string") return null;
  return {
    id: row.id,
    slug: row.live_slug,
    title: typeof row.title === "string" ? row.title : "",
    publishedAt,
    noindex: row.noindex === true,
  };
}

async function readPostIndex(siteId: string, typeId: string): Promise<PostIndex> {
  const client = await adminClient();
  const posts: PostIndexItem[] = [];
  let total = 0;
  for (let from = 0; from < POST_INDEX_MAX; from += READ_CHUNK) {
    const page = await liveEntries(client, siteId, typeId, INDEX_COLUMNS).range(
      from,
      Math.min(from + READ_CHUNK, POST_INDEX_MAX) - 1,
    );
    if (page.error) {
      throw new Error(`Loading the post index of type ${typeId} failed: ${page.error.message}`);
    }
    const rows = (page.data ?? []) as unknown as IndexRow[];
    if (from === 0) total = page.count ?? rows.length;
    for (const row of rows) {
      const item = indexItem(row);
      if (item) posts.push(item);
    }
    if (rows.length < READ_CHUNK) break;
  }
  return { complete: total <= POST_INDEX_MAX, total: Math.max(total, posts.length), posts };
}

/** The newest live posts of a type, newest first. Tags `type:<typeId>` and `page:<siteId>`. */
export function getPostIndex(siteId: string, typeId: string): Promise<PostIndex> {
  if (!isUuid(siteId) || !isUuid(typeId)) {
    return Promise.resolve({ complete: true, total: 0, posts: [] });
  }
  return cached(
    readPostIndex,
    ["tenant-post-index", PUBLIC_READ_CACHE_VERSION, typeId],
    [typeTag(typeId), pageTag(siteId)],
  )(siteId, typeId);
}

// Terms and redirects ----------------------------------------------------------------------------

async function readTermIndex(siteId: string, typeId: string): Promise<TermIndexItem[]> {
  const { data, error } = await (
    await adminClient()
  )
    .rpc("live_term_counts", { p_site: siteId, p_type: typeId })
    .limit(TERMS_PER_TYPE);
  if (error) throw new Error(`Loading the terms of type ${typeId} failed: ${error.message}`);
  const terms: TermIndexItem[] = [];
  for (const row of data ?? []) {
    if (row.taxonomy !== "category" && row.taxonomy !== "tag") continue;
    terms.push({
      id: row.id,
      taxonomy: row.taxonomy,
      slug: row.slug,
      name: row.name,
      parentId: row.parent_id ?? null,
      count: Number(row.live_count) || 0,
    });
  }
  return terms;
}

/** The type's terms with their live counts (zero-count terms included). Tag `type:<typeId>`. */
export function getTermIndex(siteId: string, typeId: string): Promise<TermIndexItem[]> {
  if (!isUuid(siteId) || !isUuid(typeId)) return Promise.resolve([]);
  return cached(
    readTermIndex,
    ["tenant-term-index", PUBLIC_READ_CACHE_VERSION, typeId],
    [typeTag(typeId)],
  )(siteId, typeId);
}

async function readSlugRedirects(siteId: string, typeId: string): Promise<Record<string, string>> {
  const { data, error } = await (
    await adminClient()
  )
    .from("content_slug_redirects")
    .select("from_slug, entry_id")
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .order("created_at", { ascending: false })
    .limit(SLUG_REDIRECTS_KEPT);
  if (error) throw new Error(`Loading the redirects of type ${typeId} failed: ${error.message}`);
  // A null-prototype shape is not JSON; a plain object is read with `hasOwnProperty` by callers.
  const redirects: Record<string, string> = {};
  for (const row of data ?? []) redirects[row.from_slug] = row.entry_id;
  return redirects;
}

/**
 * Old slug -> entry id, at most 200. Tag `type:<typeId>`. A row only names an entry: the caller
 * must find that entry live (in the post index) before it redirects.
 */
export function getSlugRedirects(siteId: string, typeId: string): Promise<Record<string, string>> {
  if (!isUuid(siteId) || !isUuid(typeId)) return Promise.resolve({});
  return cached(
    readSlugRedirects,
    ["tenant-slug-redirects", PUBLIC_READ_CACHE_VERSION, typeId],
    [typeTag(typeId)],
  )(siteId, typeId);
}

// One post ---------------------------------------------------------------------------------------

/** One live post, its published copy parsed with `postPublishSchema`; null when it is not live. */
export async function getPublishedPost(
  siteId: string,
  typeId: string,
  entryId: string,
): Promise<PublishedPost | null> {
  if (!isUuid(siteId) || !isUuid(typeId) || !isUuid(entryId)) return null;
  const { data, error } = await (
    await adminClient()
  )
    .from("content_entries")
    .select("id, type_id, published, published_at, first_published_at")
    .eq("id", entryId)
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .is("deleted_at", null)
    .not("published", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Loading post ${entryId} of site ${siteId} failed: ${error.message}`);
  if (!data || data.published === null || typeof data.published_at !== "string") return null;
  const parsed = postPublishSchema.safeParse(data.published);
  if (!parsed.success) {
    console.error(
      `Published post ${entryId} of site ${siteId} failed validation`,
      parsed.error.issues,
    );
    return null;
  }
  return {
    id: data.id,
    typeId: data.type_id,
    publishedAt: data.first_published_at ?? data.published_at,
    updatedAt: data.published_at,
    post: parsed.data,
  };
}

// Cards ------------------------------------------------------------------------------------------

const CARD_COLUMNS =
  "id, live_slug, first_published_at, published_at, title:published->>title, excerpt:published->>excerpt, body:published->>body, featuredImage:published->featuredImage, categories:published->terms->categories";

interface CardRow {
  id: string;
  live_slug: string | null;
  first_published_at: string | null;
  published_at: string | null;
  title: string | null;
  excerpt: string | null;
  body: string | null;
  featuredImage: unknown;
  categories: unknown;
}

/** How long the excerpt made from a body is when the post has none of its own. */
export const CARD_EXCERPT_LENGTH = 200;

function cardImage(value: unknown): PostCard["featuredImage"] {
  const image = value as { path?: unknown; width?: unknown; height?: unknown } | null;
  if (!image || typeof image.path !== "string" || !IMAGE_PATH_PATTERN.test(image.path)) return null;
  const size = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 20000;
  if (!size(image.width) || !size(image.height)) return null;
  return { path: image.path, width: image.width, height: image.height };
}

function card(row: CardRow): PostCard | null {
  const publishedAt = row.first_published_at ?? row.published_at;
  if (typeof row.live_slug !== "string" || typeof publishedAt !== "string") return null;
  // The slug is checked the way a link to it will be: a row that could not be linked is left out.
  if (postHref("x", row.live_slug) === null) return null;
  const own = typeof row.excerpt === "string" ? row.excerpt.trim() : "";
  return {
    id: row.id,
    slug: row.live_slug,
    title: typeof row.title === "string" ? row.title : "",
    excerpt:
      own !== ""
        ? own
        : plainExcerpt(typeof row.body === "string" ? row.body : "", CARD_EXCERPT_LENGTH),
    publishedAt,
    featuredImage: cardImage(row.featuredImage),
    categoryIds: Array.isArray(row.categories)
      ? row.categories.filter((id): id is string => isUuid(id))
      : [],
  };
}

function cardsOf(rows: unknown): PostCard[] {
  const cards: PostCard[] = [];
  for (const row of (rows ?? []) as CardRow[]) {
    const made = card(row);
    if (made) cards.push(made);
  }
  return cards;
}

/** The cards of these live posts, in the order of `ids`. An id that is not a live post is left out. */
export async function getPostCards(
  siteId: string,
  typeId: string,
  ids: readonly string[],
): Promise<PostCard[]> {
  const wanted = [...new Set(ids.filter(isUuid))].slice(0, 100);
  if (!isUuid(siteId) || !isUuid(typeId) || wanted.length === 0) return [];
  const { data, error } = await liveEntries(await adminClient(), siteId, typeId, CARD_COLUMNS).in(
    "id",
    wanted,
  );
  if (error) throw new Error(`Loading the posts of type ${typeId} failed: ${error.message}`);
  const byId = new Map(cardsOf(data).map((made) => [made.id, made]));
  return wanted.flatMap((id) => byId.get(id) ?? []);
}

/**
 * One page of the archive past the index (a type with more than `POST_INDEX_MAX` live posts): the
 * cards at `offset`, in archive order. Called only for a page number the index's `total` proved.
 */
export async function getPostCardsAt(
  siteId: string,
  typeId: string,
  offset: number,
  limit: number,
): Promise<PostCard[]> {
  if (!isUuid(siteId) || !isUuid(typeId)) return [];
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return [];
  const { data, error } = await liveEntries(
    await adminClient(),
    siteId,
    typeId,
    CARD_COLUMNS,
  ).range(offset, offset + Math.min(limit, 100) - 1);
  if (error) throw new Error(`Loading the posts of type ${typeId} failed: ${error.message}`);
  return cardsOf(data);
}

/**
 * One page of a term's live posts, in archive order. Called only for a term and a page number the
 * term index proved (a real term id with a live count that reaches the page).
 */
export async function getTermPostCards(
  siteId: string,
  typeId: string,
  termId: string,
  offset: number,
  limit: number,
): Promise<PostCard[]> {
  if (!isUuid(siteId) || !isUuid(typeId) || !isUuid(termId)) return [];
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return [];
  const { data, error } = await liveEntries(
    await adminClient(),
    siteId,
    typeId,
    `${CARD_COLUMNS}, content_entry_terms!inner(term_id)`,
  )
    .eq("content_entry_terms.term_id", termId)
    .range(offset, offset + Math.min(limit, 100) - 1);
  if (error) throw new Error(`Loading the posts of term ${termId} failed: ${error.message}`);
  return cardsOf(data);
}

// Latest posts -----------------------------------------------------------------------------------

/** How many posts a latest-posts read holds: enough for a block of 6 filtered by a category. */
export const LATEST_POSTS_READ = 12;

async function readLatestPosts(siteId: string, typeId: string): Promise<LatestPosts | null> {
  const client = await adminClient();
  const type = await client
    .from("content_types")
    .select("archive_path, enabled")
    .eq("id", typeId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (type.error) throw new Error(`Loading type ${typeId} failed: ${type.error.message}`);
  const path = type.data?.archive_path;
  if (!type.data?.enabled || typeof path !== "string" || !isValidSubPagePath(path)) return null;
  const { data, error } = await liveEntries(client, siteId, typeId, CARD_COLUMNS).range(
    0,
    LATEST_POSTS_READ - 1,
  );
  if (error) throw new Error(`Loading the latest posts of type ${typeId} failed: ${error.message}`);
  return { archivePath: path, posts: cardsOf(data) };
}

/** How many categories one read serves (a page with more latest-posts blocks than this is rare). */
export const LATEST_POSTS_CATEGORIES = 12;

/** The newest live posts of one category, at most what a block shows (6), in archive order. */
async function readLatestCategoryPosts(
  siteId: string,
  typeId: string,
  categoryId: string,
): Promise<PostCard[]> {
  const { data, error } = await liveEntries(
    await adminClient(),
    siteId,
    typeId,
    `${CARD_COLUMNS}, content_entry_terms!inner(term_id)`,
  )
    .eq("content_entry_terms.term_id", categoryId)
    .range(0, LIMITS.latestPostsMax - 1);
  if (error)
    throw new Error(`Loading the latest posts of term ${categoryId} failed: ${error.message}`);
  return cardsOf(data);
}

/** Cards of several reads as one list, each post once, in archive order (newest first, then id). */
function mergeCards(lists: readonly PostCard[][]): PostCard[] {
  const byId = new Map<string, PostCard>();
  for (const list of lists)
    for (const made of list) if (!byId.has(made.id)) byId.set(made.id, made);
  return [...byId.values()].sort((a, b) =>
    a.publishedAt === b.publishedAt
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.publishedAt < b.publishedAt
        ? 1
        : -1,
  );
}

/**
 * What `latest_posts` blocks draw; null when the type is off. Tags `type:<typeId>`, `page:<siteId>`.
 * The newest `LATEST_POSTS_READ` posts, plus, for each category in `categoryIds` (a block's own
 * category, at most `LATEST_POSTS_CATEGORIES`), the newest posts of that category, so a block with
 * a category shows that category's posts however old they are. Each category is one cache entry of
 * its own (`["tenant-latest-posts", v, typeId, categoryId]`), so the entries are bounded by the
 * categories the site's documents name, never by a request.
 */
export async function getLatestPosts(
  siteId: string,
  typeId: string,
  categoryIds: readonly string[] = [],
): Promise<LatestPosts | null> {
  if (!isUuid(siteId) || !isUuid(typeId)) return null;
  const latest = await cached(
    readLatestPosts,
    ["tenant-latest-posts", PUBLIC_READ_CACHE_VERSION, typeId],
    [typeTag(typeId), pageTag(siteId)],
  )(siteId, typeId);
  const categories = [...new Set(categoryIds.filter(isUuid).map((id) => id.toLowerCase()))].slice(
    0,
    LATEST_POSTS_CATEGORIES,
  );
  if (latest === null || categories.length === 0) return latest;
  const lists = await Promise.all(
    categories.map((categoryId) =>
      cached(
        readLatestCategoryPosts,
        ["tenant-latest-posts", PUBLIC_READ_CACHE_VERSION, typeId, categoryId],
        [typeTag(typeId), pageTag(siteId)],
      )(siteId, typeId, categoryId),
    ),
  );
  return { archivePath: latest.archivePath, posts: mergeCards([latest.posts, ...lists]) };
}

// Lookups ----------------------------------------------------------------------------------------

async function readLiveIdBySlug(siteId: string, typeId: string, slug: string) {
  const { data, error } = await (
    await adminClient()
  )
    .from("content_entries")
    .select("id")
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .eq("live_slug", slug)
    .is("deleted_at", null)
    .not("published", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Looking up a post of type ${typeId} failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * The id of the live post with this slug. The cached index answers; only when the index is not
 * complete (a type with more than `POST_INDEX_MAX` live posts) does a miss cost one indexed read
 * (`content_entries_site_type_live_slug_key`), which is never cached per slug: the firewall's rate
 * rule (M11-12) is what bounds invented slugs on such a site, not a cache entry each.
 */
export async function findLivePostId(
  siteId: string,
  typeId: string,
  slug: string,
): Promise<string | null> {
  if (!isUuid(siteId) || !isUuid(typeId) || postHref("x", slug) === null) return null;
  const index = await getPostIndex(siteId, typeId);
  const found = index.posts.find((post) => post.slug === slug);
  if (found) return found.id;
  if (index.complete) return null;
  return readLiveIdBySlug(siteId, typeId, slug);
}

async function readIsLive(siteId: string, typeId: string, entryId: string): Promise<boolean> {
  const { data, error } = await (
    await adminClient()
  )
    .from("content_entries")
    .select("id")
    .eq("id", entryId)
    .eq("site_id", siteId)
    .eq("type_id", typeId)
    .is("deleted_at", null)
    .not("published", "is", null)
    .maybeSingle();
  if (error) throw new Error(`Looking up entry ${entryId} failed: ${error.message}`);
  return data !== null;
}

/**
 * True when `entryId` is a live post of an enabled archive of this site (the beacon asks). Cached
 * reads only (the site's archives, each type's index); one indexed read per archive whose index is
 * not complete.
 */
export async function isLivePost(siteId: string, entryId: string): Promise<boolean> {
  if (!isUuid(siteId) || !isUuid(entryId)) return false;
  const { archives } = await getSiteArchives(siteId);
  for (const archive of archives) {
    const index = await getPostIndex(siteId, archive.typeId);
    if (index.posts.some((post) => post.id === entryId)) return true;
    if (!index.complete && (await readIsLive(siteId, archive.typeId, entryId))) return true;
  }
  return false;
}

/** The cache options of one post's HTML: its own tag and the site's (not the type's: see post-html.ts). */
export function postHtmlTags(siteId: string, entryId: string): string[] {
  return [entryTag(entryId), pageTag(siteId)];
}
