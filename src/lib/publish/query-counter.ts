import "server-only";

/**
 * A call counter for the public query (M2-26), off unless HYDLNK_QUERY_COUNTER=1 (a test flag,
 * never set in production). It counts how often the query really reads Postgres, per page id, so
 * a test can tell a cache HIT (the count stays) from a regeneration (it goes up). The count lives
 * on globalThis, so the page render and the counter route see the same numbers in one process.
 */
const KEY = "__hydlnkPublicQueryCounts";
type Counts = Map<string, number>;
const store = globalThis as typeof globalThis & { [KEY]?: Counts };

export function queryCounterEnabled(): boolean {
  return process.env.HYDLNK_QUERY_COUNTER === "1";
}

export function countPublicQuery(pageId: string): void {
  if (!queryCounterEnabled()) return;
  const counts = (store[KEY] ??= new Map());
  counts.set(pageId, (counts.get(pageId) ?? 0) + 1);
}

export function publicQueryCount(pageId: string): number {
  return store[KEY]?.get(pageId) ?? 0;
}
