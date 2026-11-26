import type { PostPublish } from "@/lib/content/schemas/post";
import {
  RESERVED_ENTRY_SLUGS,
  isPathFormat,
  isReservedPath,
  isValidSubPagePath,
} from "@/lib/document/path";

/**
 * The blog's shared shapes (Wave B, M16): what the public reads return, what the templates draw and
 * the one vetted way a blog href is made. Pure: no request, no database, safe in the browser. Its
 * only imports are the post type and the pure path rules.
 */

/** An enabled content type that has an archive, as the routes and the menu need it. */
export interface ArchiveSummary {
  typeId: string;
  key: string;
  path: string;
  label: string;
  labelPlural: string;
  pageSize: number;
}

/** A site's enabled archives, and the ids of its live sub-pages that hold a `latest_posts` block. */
export interface SiteArchives {
  archives: ArchiveSummary[];
  pagesWithPostLists: string[];
}

export interface PostIndexItem {
  id: string;
  slug: string;
  title: string;
  publishedAt: string;
  noindex: boolean;
}

/** The newest `POST_INDEX_MAX` live posts of a type; `complete` is false when the type holds more. */
export interface PostIndex {
  complete: boolean;
  total: number;
  posts: PostIndexItem[];
}

export interface TermIndexItem {
  id: string;
  taxonomy: "category" | "tag";
  slug: string;
  name: string;
  parentId: string | null;
  count: number;
}

export interface PostCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  featuredImage: { path: string; width: number; height: number } | null;
  categoryIds: string[];
}

/** What a `latest_posts` block reads: the archive's path and the newest 12 posts. */
export interface LatestPosts {
  archivePath: string;
  posts: PostCard[];
}

/** A live post as the public read returns it: `post` is the published copy, parsed with `postPublishSchema`. */
export interface PublishedPost {
  id: string;
  typeId: string;
  /** The first publish date (ISO): the date shown and the order of the archive. */
  publishedAt: string;
  /** The last publish (ISO): `dateModified`. */
  updatedAt: string;
  post: PostPublish;
}

/** A post as the article component draws it: the live copy on a post page, the draft in the share preview. */
export interface PostView {
  title: string;
  body: string;
  excerpt: string;
  /** ISO date, or null when the post was never published (a draft preview shows no date). */
  publishedAt: string | null;
  featuredImage: { path: string; width: number; height: number } | null;
}

/** A category or tag of the post being drawn. */
export interface TermView {
  id: string;
  taxonomy: "category" | "tag";
  slug: string;
  name: string;
}

export const POST_INDEX_MAX = 5000;
export const ARCHIVE_PAGE_SIZE = 10;
export const FEED_ITEMS = 20;
export const LATEST_POSTS_MAX = 6;
export const TERMS_PER_TYPE = 500;
export const SLUG_REDIRECTS_KEPT = 200;
/** Where the responder puts the previous and next links in a cached post page. */
export const POST_NAV_MARKER = "<!--hl-post-nav-->";

/** The last archive page number a URL may name (`/blog/page/9999`). */
export const ARCHIVE_PAGE_MAX = 9999;

/** The term slug rule, 1 to 80 characters: a copy of `SLUG` in `src/lib/content/terms-core.ts`. */
const TERM_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** "" for page 1 (or none), "/page/{n}" for 2 to `ARCHIVE_PAGE_MAX`, null for anything else. */
function pageSuffix(page: number | undefined): string | null {
  if (page === undefined || page === 1) return "";
  return Number.isInteger(page) && page >= 2 && page <= ARCHIVE_PAGE_MAX ? `/page/${page}` : null;
}

/** "/blog/my-post", or null: the archive path and the slug are both checked again here. */
export function postHref(archivePath: string, slug: string): string | null {
  if (!isValidSubPagePath(archivePath)) return null;
  // The entry slug rule (`entrySlugIssue`): one segment, not an archive word, not a reserved path.
  if (!isPathFormat(slug) || RESERVED_ENTRY_SLUGS.includes(slug) || isReservedPath(slug)) {
    return null;
  }
  return `/${archivePath}/${slug}`;
}

/** "/blog" (page 1 or none) or "/blog/page/2", or null. */
export function archiveHref(archivePath: string, page?: number): string | null {
  const suffix = pageSuffix(page);
  if (suffix === null || !isValidSubPagePath(archivePath)) return null;
  return `/${archivePath}${suffix}`;
}

/** "/blog/category/news" or "/blog/tag/news/page/2", or null. */
export function termHref(
  archivePath: string,
  taxonomy: "category" | "tag",
  slug: string,
  page?: number,
): string | null {
  const suffix = pageSuffix(page);
  if (suffix === null || !isValidSubPagePath(archivePath)) return null;
  if (taxonomy !== "category" && taxonomy !== "tag") return null;
  if (!TERM_SLUG.test(slug)) return null;
  return `/${archivePath}/${taxonomy}/${slug}${suffix}`;
}

/** The fields of a published post as the templates read them: every one present and of one type. */
export interface PostFields {
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  featuredImage: { path: string; width: number; height: number } | null;
  seoTitle: string;
  seoDescription: string;
  shareImage: { path: string; width: number; height: number } | null;
  noindex: boolean;
  categoryIds: string[];
  tagIds: string[];
}

function imageOf(value: unknown): PostFields["featuredImage"] {
  const image = value as { path?: unknown; width?: unknown; height?: unknown } | null | undefined;
  if (!image || typeof image !== "object") return null;
  if (typeof image.path !== "string") return null;
  if (typeof image.width !== "number" || typeof image.height !== "number") return null;
  return { path: image.path, width: image.width, height: image.height };
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");
const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

/**
 * A published copy read field by field. `postPublishSchema` has checked it; this only gives every
 * field one type and a default, so a template never branches on `undefined`. Pure.
 */
export function postFieldsOf(post: PostPublish): PostFields {
  const record = post as Record<string, unknown>;
  const seo = (record.seo ?? {}) as Record<string, unknown>;
  const terms = (record.terms ?? {}) as Record<string, unknown>;
  return {
    title: textOf(record.title),
    slug: textOf(record.slug),
    body: textOf(record.body),
    excerpt: textOf(record.excerpt),
    featuredImage: imageOf(record.featuredImage),
    seoTitle: textOf(seo.title),
    seoDescription: textOf(seo.description),
    shareImage: imageOf(seo.ogImage),
    noindex: seo.noindex === true,
    categoryIds: idsOf(terms.categories),
    tagIds: idsOf(terms.tags),
  };
}
