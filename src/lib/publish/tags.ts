/**
 * Cache tags of the public page. One tag per page: the public query, the page and its OG image all
 * carry it, Publish expires it with `updateTag` (a Server Action), and `invalidateAccountPages`
 * revalidates it for every page of an account (plan change, suspension). Autosave never touches
 * it. Built from the page id, which never changes, not from the handle.
 */
export function pageTag(pageId: string): string {
  return `page:${pageId}`;
}

/**
 * Tag of the cached 404 of a handle nobody owns (yet). The claim flow expires it with
 * `invalidateHandle` so a freshly claimed handle shows its placeholder at once; without that, the
 * short `MISSING_REVALIDATE_SECONDS` window ends the stale 404 on its own.
 */
export function handleTag(handle: string): string {
  return `handle:${handle}`;
}

/** How long a 404 for an unknown handle may be served from the cache. */
export const MISSING_REVALIDATE_SECONDS = 5;

/**
 * A backstop under the explicit invalidation: a cached public page is regenerated at least this
 * often, so a missed `updateTag` or `revalidateTag` (a failed webhook, a crashed action) cannot
 * leave a stale page, badge or suspension in place for good.
 */
export const PAGE_REVALIDATE_SECONDS = 86_400;

/**
 * Part of the key of the cached public read (`published-page.ts`). The Data Cache outlives a
 * deployment, and what it holds is the stored published document as plain JSON, validated only
 * after it is read. So when the published-document schema stops accepting something that older
 * stored documents hold, bump this: the entries written under the old number are never read again
 * and every page regenerates from Postgres. Without it, a deploy that tightens the schema turns each
 * cached page that still carries the old value into a 404 until its entry expires.
 *
 * "2": `letterCase` lost its legacy `none` (M3-02; migration 20261002100004 rewrote the stored
 * documents to `normal`).
 *
 * "3": the three gradient tokens joined the token set (M6-41; migration 20261006000000 added them
 * to every stored complete token set).
 */
export const PUBLIC_READ_CACHE_VERSION = "3";
