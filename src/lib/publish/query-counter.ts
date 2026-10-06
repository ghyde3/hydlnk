import "server-only";
import { testHooksEnabled } from "@/lib/env/test-hooks";

/**
 * A call counter for the public query (M2-26), off unless HYDLNK_QUERY_COUNTER=1 (a test flag,
 * never set in production, and ignored on a Vercel production deployment: see `testHooksEnabled`). It counts how often the query really reads Postgres, per page id, so
 * a test can tell a cache HIT (the count stays) from a regeneration (it goes up). The count lives
 * on globalThis, so the page render and the counter route see the same numbers in one process.
 */
const KEY = "__hydlnkPublicQueryCounts";
type Counts = Map<string, number>;
const store = globalThis as typeof globalThis & { [KEY]?: Counts };

export function queryCounterEnabled(): boolean {
  return testHooksEnabled();
}

export function countPublicQuery(pageId: string): void {
  if (!queryCounterEnabled()) return;
  const counts = (store[KEY] ??= new Map());
  counts.set(pageId, (counts.get(pageId) ?? 0) + 1);
}

export function publicQueryCount(pageId: string): number {
  return store[KEY]?.get(pageId) ?? 0;
}

const INDEX_KEY = "__hydlnkSiteIndexQueryCounts";
const indexStore = globalThis as typeof globalThis & { [INDEX_KEY]?: Counts };

/** The same count for the site index read (M11-06), kept apart so the page read's count means what it did. */
export function countSiteIndexQuery(pageId: string): void {
  if (!queryCounterEnabled()) return;
  const counts = (indexStore[INDEX_KEY] ??= new Map());
  counts.set(pageId, (counts.get(pageId) ?? 0) + 1);
}

export function siteIndexQueryCount(pageId: string): number {
  return indexStore[INDEX_KEY]?.get(pageId) ?? 0;
}
