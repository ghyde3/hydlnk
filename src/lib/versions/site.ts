import { publishFormsEqual, publishedSubPageSchema, type SubPagePublish } from "@/lib/document";

/**
 * The stored sub-pages of a version (M12-04), pure: parsing `page_versions.sub_pages` and comparing
 * a version with the live site. No I/O, no write.
 */

/** One sub-page as a version stores it (`page_versions.sub_pages`), parsed. */
export interface StoredSubPage {
  id: string;
  path: string;
  title: string;
  doc: SubPagePublish;
}

const SUB_PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `page_versions.sub_pages` parsed with the strict published schema, ordered by path then id (the
 * order the database stores). Null when the column is not an array or one entry does not parse: the
 * raw JSON is never handed on. The path and title are the page's own (`published`), so the stored
 * copies of them cannot disagree.
 */
export function parseStoredSubPages(raw: unknown): StoredSubPage[] | null {
  // The column is not null (default `[]`); a row read without it is a version with no sub-pages.
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const pages: StoredSubPage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { id, published } = entry as { id?: unknown; published?: unknown };
    if (typeof id !== "string" || !SUB_PAGE_ID.test(id)) return null;
    const doc = publishedSubPageSchema.safeParse(published);
    if (!doc.success) return null;
    pages.push({ id, path: doc.data.path, title: doc.data.title, doc: doc.data });
  }
  return pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * Is this stored version the site as it is live now (M12-04)? Home's document and every live
 * sub-page must be equal (key order does not matter): a version that differs only in a sub-page is
 * not live. `live.subPages` are the site's published sub-pages, `{id, published}`.
 */
export function versionIsLive(
  version: { document: unknown; subPages: unknown },
  live: { home: unknown; subPages: readonly { id: string; published: unknown }[] },
): boolean {
  if (live.home === null || !publishFormsEqual(version.document, live.home)) return false;
  const stored = Array.isArray(version.subPages)
    ? (version.subPages as { id?: unknown; published?: unknown }[])
    : null;
  if (stored === null || stored.length !== live.subPages.length) return false;
  const byId = new Map(live.subPages.map((page) => [page.id, page.published]));
  return stored.every(
    (entry) =>
      typeof entry.id === "string" &&
      byId.has(entry.id) &&
      publishFormsEqual(entry.published, byId.get(entry.id)),
  );
}
