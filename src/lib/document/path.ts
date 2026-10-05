/**
 * The path of a sub-page (M11-04): one lowercase segment on the site's host, `/items`. One rule, one
 * reserved list, used by the document schemas, the editor's live check and the server routes.
 */

/** One lowercase segment, 1 to 40 characters, starting and ending with a letter or digit. */
export const SUB_PAGE_PATH_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Paths a sub-page may not take: the routes a tenant host already answers (`/og`, `/r/...`, `/c/...`,
 * `/api/...`, see `src/lib/routing/paths.ts`), the internal prefixes the proxy rewrites into
 * (`app`, `t`, `sites`), the shared static folders (`media`, `_t`), `share`, `auth`, the crawler files
 * (`sitemap`, `robots`) and the sentinel of the unknown-page 404 (`404-not-found`). Anything starting
 * with `hl-` is reserved as well (test hooks), see `isReservedPath`.
 */
export const RESERVED_PATHS: readonly string[] = [
  "og",
  "r",
  "c",
  "api",
  "media",
  "share",
  "auth",
  "app",
  "t",
  "sites",
  "_t",
  "sitemap",
  "robots",
  "404-not-found",
];

/** The reserved prefix: test hooks such as `hl-query-count`. */
export const RESERVED_PATH_PREFIX = "hl-";

export const PATH_MESSAGES = {
  format:
    "Use 1 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
  reserved: "That path is reserved. Choose another.",
  taken: "Another page of this site already uses that path.",
} as const;

/** True when `path` is on the reserved list or starts with `hl-` (compared as given, lowercase). */
export function isReservedPath(path: string): boolean {
  return RESERVED_PATHS.includes(path) || path.startsWith(RESERVED_PATH_PREFIX);
}

/** True when `path` follows the segment rule (reserved paths still pass this). */
export function isPathFormat(path: string): boolean {
  return SUB_PAGE_PATH_PATTERN.test(path);
}

/** True when `path` is a valid, non-reserved sub-page path. */
export function isValidSubPagePath(path: string): boolean {
  return isPathFormat(path) && !isReservedPath(path);
}

/** The first problem with `path` as the message to show, or null when it is valid. */
export function subPagePathError(path: string): string | null {
  if (!isPathFormat(path)) return PATH_MESSAGES.format;
  if (isReservedPath(path)) return PATH_MESSAGES.reserved;
  return null;
}

const FALLBACK_BASE = "page";

/** Lowercase ASCII slug of `title`: accents folded, other characters become hyphens, 40 at most. */
function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug;
}

/**
 * A free path suggested from a page title: the slug of the title (`page` when it has no letters or
 * digits), then `-2`, `-3`... when the slug is reserved or already in `taken`. The result always
 * passes `isValidSubPagePath`.
 */
export function suggestPath(title: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  // A slug starting `hl-` is reserved whatever follows, so no suffix could free it: drop the prefix.
  let base = slugify(title);
  while (base.startsWith(RESERVED_PATH_PREFIX)) base = base.slice(RESERVED_PATH_PREFIX.length);
  base = base.replace(/^-+/, "") || FALLBACK_BASE;
  const fits = (candidate: string) => isValidSubPagePath(candidate) && !used.has(candidate);
  if (fits(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (fits(candidate)) return candidate;
  }
}
