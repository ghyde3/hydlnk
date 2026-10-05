import { publishedDocSchema, publishedSubPageSchema, type PublishDoc } from "@/lib/document";

/**
 * The site-wide block index (M11-09): which published document of a site holds a clickable id, so a
 * click on `/r/[pageId]/[blockId]` or `/c/...` is resolved with one lookup and one document parse
 * instead of a walk over every page. Block ids are unique across a whole site (Publish enforces it),
 * so an id names at most one page.
 *
 * Pure and JSON-only: the cached site read builds it once per publish (tag `page:<id>`) and stores it
 * with the documents. Everything comes from PUBLISHED documents; a draft never reaches it.
 */

/** A sub-page's published row as the site read hands it over. */
export interface PublishedSubPage {
  id: string;
  published: unknown;
}

/** id -> sub-page id, "" for Home. */
export type BlockIndex = Record<string, string>;

const ID_KEYS = new Set(["id", "googleId", "appleId"]);

/**
 * Every string stored under `id`, `googleId` or `appleId` anywhere in the document: block ids and
 * the ids nested in them (social icons, grid cells, link marks, store links, map buttons, the
 * support banner). Over-inclusive on purpose (an id that is not a link just resolves to nothing).
 */
function collectIds(value: unknown, out: string[], depth = 0): void {
  if (depth > 8 || typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, out, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (ID_KEYS.has(key) && typeof child === "string") out.push(child);
    else collectIds(child, out, depth + 1);
  }
}

/** Home first, then the sub-pages in the order given: the first page holding an id wins. */
export function buildBlockIndex(home: unknown, subPages: readonly PublishedSubPage[]): BlockIndex {
  const index = new Map<string, string>();
  const add = (published: unknown, owner: string) => {
    const ids: string[] = [];
    collectIds(published, ids);
    for (const id of ids) if (!index.has(id)) index.set(id, owner);
  };
  add(home, "");
  for (const page of subPages) add(page.published, page.id);
  // fromEntries defines own properties, so an id such as "__proto__" stays a plain key.
  return Object.fromEntries(index);
}

/**
 * The index is cached in shards (by a hash of the id), so no cache entry holds a whole Studio site's
 * ids: the Data Cache refuses an item over 2 MB, and 500 pages of 50 blocks and their nested ids would
 * pass that in one map. A shard is about a sixteenth of it.
 */
export const INDEX_SHARDS = 16;

/** The shard that holds `id`: a stable FNV-1a hash, so a write and a read always agree. */
export function shardOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % INDEX_SHARDS;
}

/** The block index split into `INDEX_SHARDS` plain objects, shard `n` holding the ids with `shardOf(id) === n`. */
export function buildIndexShards(
  home: unknown,
  subPages: readonly PublishedSubPage[],
): BlockIndex[] {
  const shards: Array<Map<string, string>> = Array.from({ length: INDEX_SHARDS }, () => new Map());
  for (const [id, owner] of Object.entries(buildBlockIndex(home, subPages))) {
    shards[shardOf(id)]!.set(id, owner);
  }
  return shards.map((shard) => Object.fromEntries(shard));
}

/** One (block id, sub-page id) pair, as `site_click_pairs` returns them. */
export interface SubPageIdPair {
  block_id: string;
  sub_page_id: string;
}

/**
 * `buildIndexShards` from the ids alone: Home's document and the (block id, sub-page id) pairs of the
 * sub-pages' published documents, which the database extracts so no sub-page document is read. Same
 * rule as the walk: Home first, then sub-pages in id order, the first page holding an id wins.
 */
export function buildIndexShardsFromPairs(
  home: unknown,
  pairs: readonly SubPageIdPair[],
): BlockIndex[] {
  const index = new Map<string, string>();
  const homeIds: string[] = [];
  collectIds(home, homeIds);
  for (const id of homeIds) if (!index.has(id)) index.set(id, "");
  const ordered = pairs
    .map((pair) => ({ id: pair.block_id, owner: pair.sub_page_id.toLowerCase() }))
    .sort((a, b) => a.owner.localeCompare(b.owner));
  for (const { id, owner } of ordered) if (!index.has(id)) index.set(id, owner);
  const shards: Array<Map<string, string>> = Array.from({ length: INDEX_SHARDS }, () => new Map());
  for (const [id, owner] of index) shards[shardOf(id)]!.set(id, owner);
  return shards.map((shard) => Object.fromEntries(shard));
}

export interface SiteRead {
  home: unknown;
  subPages: PublishedSubPage[];
  index: BlockIndex;
}

/**
 * The document that holds `id`, shaped as one `PublishDoc` the link and contact readers walk: Home's
 * own document, or Home's document with the sub-page's blocks in place of its own. A sub-page has no
 * theme, banner or tags of its own; the site's UTM tags (Home's document) apply to its links, and the
 * banner stays Home's. Null when no page holds the id or the holding document fails its schema.
 */
export function documentForBlock(
  site: SiteRead,
  id: string,
): { doc: PublishDoc; subPageId: string | undefined } | null {
  if (!Object.hasOwn(site.index, id)) return null;
  const owner = site.index[id]!;
  const home = publishedDocSchema.safeParse(site.home);
  if (!home.success) return null;
  if (owner === "") return { doc: home.data, subPageId: undefined };

  const row = site.subPages.find((page) => page.id === owner);
  if (!row) return null;
  const sub = publishedSubPageSchema.safeParse(row.published);
  if (!sub.success) return null;
  const { banner: _banner, ...rest } = home.data;
  return { doc: { ...rest, blocks: sub.data.blocks }, subPageId: owner };
}
