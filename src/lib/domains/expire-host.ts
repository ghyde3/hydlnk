import { lookupKey, sharedHostCache } from "@/lib/routing/custom-domain";

/**
 * Expires the proxy's remembered answer for one custom hostname (M8-11). Called after every
 * server-side change to a `domains` row (add, verify, a stale pending row removed, re-point,
 * removal, and the deletion of a page or an account that held domains), and nowhere else, once the
 * database change has succeeded: a lookup that started before the change cannot put its old answer
 * back afterwards (the store drops the read in flight with the entry).
 *
 * It never throws and takes no input from a request: the name is normalized the way the proxy
 * normalizes a Host header (`lookupKey`: case, port, one trailing dot) and anything that is not a
 * plain domain name is ignored, so a hostile string changes nothing. A failure is logged without
 * the name; the lifetimes in src/lib/routing/custom-domain.ts (60 and 10 seconds) are the backstop.
 *
 * It touches only the hostname store, never a page tag (`expirePage` does that, and still runs as
 * before), and it is a plain module so the domain logic stays importable from Vitest and Playwright
 * without a Next runtime. Server code only: no client component imports it.
 */
export function expireDomainHost(hostname: unknown): void {
  try {
    if (typeof hostname !== "string") return;
    const key = lookupKey(hostname);
    if (key) sharedHostCache().expire(key);
  } catch {
    console.error("[domains] expiring a hostname lookup failed");
  }
}
