import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HOSTNAME_PATTERN } from "@/lib/domains/hostname";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Custom-domain lookup for hosts that are neither the root, www, app nor a handle subdomain
 * (M4-09). Runs in the proxy on every request to a custom host, so it is deliberately small and
 * (M8-10) remembers its answers for a short while:
 *
 *   - the input is the request's real Host header and nothing else (the proxy never passes
 *     X-Forwarded-Host or X-Original-Host); it is lower-cased, its port and one trailing dot are
 *     dropped, and anything that is not a plain domain name (the `domains_hostname_format` shape,
 *     which also rules out IPs and garbage) or that sits under vercel.app is "unknown" without a
 *     database round trip and without a cache entry;
 *   - the answer is the page id of a `domains` row with that hostname and status 'verified', or
 *     null (no row, or a pending or errored one). Nothing about the page is part of it: whether a
 *     page is published, suspended or deleted is decided per page by the page route
 *     (`/sites/<pageId>` answers the plain 404 for a draft-only page, a suspended owner and an
 *     unknown id), and `/r/*` and `/api/e` check the page and the host themselves. So Publish and
 *     unpublish change nothing here and need no expiry;
 *   - a database error, a timeout or missing configuration also answers null: a 404 with no
 *     details, never a 500. Such an answer is never stored (the next request asks again) and never
 *     replaces a good one;
 *   - the hostname is only ever a filter value of a database query. It is never fetched (SSRF).
 *
 * The cache (production builds only: `next dev` reads Postgres every time, like the page cache
 * does, so a spec that changes a domain from its own process sees it on the next request):
 *
 *   - one entry per normalized hostname holding the page id or "none", a fixed life from the moment
 *     it was stored (a hit never extends it): 60 seconds for a found host, 10 seconds for none;
 *   - at most 1,000 entries, the oldest stored dropped first, so a flood of different host names
 *     cannot grow it; a request for a name that is not a lookup key never reaches it;
 *   - one database read at a time per hostname: concurrent requests for the same name share it;
 *   - it lives on `globalThis`: the proxy is bundled apart from the app, but in one server process
 *     the Server Action that changes a domain and the proxy reach the same store, so
 *     `expireDomainHost` (src/lib/domains/expire-host.ts, called after every domain change) takes
 *     effect at once. On Vercel the proxy and the app may run in different instances, which share
 *     nothing: there a changed domain can show stale for at most the two lifetimes above on an
 *     instance the change did not run on (M8-11 records the bounds).
 *
 * The proxy bundle cannot import `server-only` modules, so this talks to Supabase with the plain
 * client and the secret key from process.env (server runtime only; never reaches the browser).
 */

const LOOKUP_TIMEOUT_MS = 3_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long a found hostname is served from memory. It is the longest a removed or re-pointed domain
 * can keep answering with its old page when an expiry cannot reach the instance that holds the
 * entry (M8-11); everywhere the expiry reaches, it stops at once.
 */
export const CUSTOM_DOMAIN_FOUND_SECONDS = 60;
/**
 * How long "no verified domain" is remembered. It is how long a typo, a probe or a domain that is
 * not verified yet costs one lookup instead of one per request; a domain that has just been
 * verified waits at most this long on an instance the verification did not run on.
 */
export const CUSTOM_DOMAIN_NONE_SECONDS = 10;
/** The most entries the store holds, however many different host names arrive. */
export const CUSTOM_DOMAIN_CACHE_MAX_ENTRIES = 1_000;

/**
 * The lookup key for a Host header value: lower case, no port, no trailing dot; null when it is not
 * a plain domain name or is a *.vercel.app host. Exported for the tests.
 */
export function lookupKey(host: string): string | null {
  const lowered = host.trim().toLowerCase();
  if (lowered === "" || lowered.length > 300) return null;
  const withoutPort = lowered.replace(/:\d{1,5}$/, "");
  const bare = withoutPort.endsWith(".") ? withoutPort.slice(0, -1) : withoutPort;
  if (!HOSTNAME_PATTERN.test(bare) || bare.length > 253) return null;
  if (bare === "vercel.app" || bare.endsWith(".vercel.app")) return null;
  return bare;
}

// ---------------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------------

/** What one lookup answers: a page id or "none"; `failed` is an error or timeout and is never stored. */
type Lookup = { failed: false; pageId: string | null } | { failed: true };

interface Entry {
  pageId: string | null;
  expiresAt: number;
}

interface Flight {
  promise: Promise<Lookup>;
}

/**
 * Bounded memory of hostname -> page id answers (see the header). Insertion ordered: the first key
 * is always the oldest stored, which is the one dropped when the store is full. Exported so tests
 * can build their own.
 */
export class HostCache {
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new Map<string, Flight>();

  constructor(private readonly maxEntries: number = CUSTOM_DOMAIN_CACHE_MAX_ENTRIES) {}

  /** Entries held, expired ones not yet dropped included. */
  get size(): number {
    return this.entries.size;
  }

  /** The stored answer for `key`, or undefined (nothing stored, or its life is over: dropped). */
  get(key: string, now: number): { pageId: string | null } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return { pageId: entry.pageId };
  }

  private store(key: string, pageId: string | null, now: number): void {
    const seconds = pageId ? CUSTOM_DOMAIN_FOUND_SECONDS : CUSTOM_DOMAIN_NONE_SECONDS;
    // Re-inserting moves the key to the end: its life starts again, which only happens after the
    // previous one is over (or was expired).
    this.entries.delete(key);
    this.entries.set(key, { pageId, expiresAt: now + seconds * 1_000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Runs `read` for `key`, or joins the read already running for it, and stores a successful answer
   * unless `expire(key)` ran in the meantime: an answer read before a change must not come back
   * after the change has expired the entry.
   */
  async lookup(
    key: string,
    read: () => Promise<Lookup>,
    now: () => number,
  ): Promise<{ result: Lookup; joined: boolean }> {
    const running = this.flights.get(key);
    if (running) return { result: await running.promise, joined: true };

    const flight: Flight = { promise: undefined as unknown as Promise<Lookup> };
    flight.promise = (async () => {
      try {
        const result = await read();
        if (!result.failed && this.flights.get(key) === flight) {
          this.store(key, result.pageId, now());
        }
        return result;
      } finally {
        if (this.flights.get(key) === flight) this.flights.delete(key);
      }
    })();
    this.flights.set(key, flight);
    return { result: await flight.promise, joined: false };
  }

  /** Forgets `key` and cuts off the read in flight for it (it still answers its own callers). */
  expire(key: string): void {
    this.entries.delete(key);
    this.flights.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.flights.clear();
  }
}

const STORE_KEY = Symbol.for("hydlnk.customDomainHostCache");
type WithStore = typeof globalThis & { [STORE_KEY]?: HostCache };

/** The one store of this server process, shared by the proxy bundle and the app bundle. */
export function sharedHostCache(): HostCache {
  const holder = globalThis as WithStore;
  return (holder[STORE_KEY] ??= new HostCache());
}

// ---------------------------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------------------------

let cachedClient: SupabaseClient<Database> | null | undefined;

function secretClient(): SupabaseClient<Database> | null {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  cachedClient =
    url && key
      ? createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
      : null;
  return cachedClient;
}

/**
 * Where an answer came from: `HIT` the store; `MISS` a database read (or one already running);
 * `BYPASS` caching is off (development and the unit harness: every request reads); `NONE` the host
 * is not a lookup key, so there was no read and nothing stored.
 */
export type DomainCacheState = "HIT" | "MISS" | "BYPASS" | "NONE";

export interface CustomDomainDeps {
  client?: SupabaseClient<Database> | null;
  /**
   * The store to use. Default: the process's shared one in a production build, none otherwise
   * (`false` forces no caching, as in development).
   */
  cache?: HostCache | false;
  /** The clock in milliseconds, for the entries' lives. Default `Date.now`. */
  now?: () => number;
  /** Told where the answer came from (the proxy sets a test header from it; see src/proxy.ts). */
  report?: (state: DomainCacheState) => void;
}

async function readDomain(
  hostname: string,
  client: SupabaseClient<Database> | null,
): Promise<Lookup> {
  if (!client) {
    console.error("[proxy] custom-domain lookup is not configured");
    return { failed: true };
  }
  try {
    const { data, error } = await client
      .from("domains")
      .select("page_id")
      .eq("hostname", hostname)
      .eq("status", "verified")
      .limit(1)
      .abortSignal(AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
    if (error) {
      console.error("[proxy] custom-domain lookup failed");
      return { failed: true };
    }
    const row = data?.[0];
    if (!row) return { failed: false, pageId: null };
    // A malformed id is an answer that cannot be used: not a "none" to remember as if the host were
    // unknown, but not something to rewrite to either.
    if (!UUID.test(row.page_id)) return { failed: false, pageId: null };
    return { failed: false, pageId: row.page_id };
  } catch {
    console.error("[proxy] custom-domain lookup failed");
    return { failed: true };
  }
}

export async function resolveCustomDomain(
  host: string,
  deps: CustomDomainDeps = {},
): Promise<string | null> {
  const hostname = lookupKey(host);
  if (!hostname) {
    deps.report?.("NONE");
    return null;
  }
  const client = deps.client === undefined ? secretClient() : deps.client;
  const cache =
    deps.cache === undefined
      ? process.env.NODE_ENV === "production"
        ? sharedHostCache()
        : null
      : deps.cache || null;

  if (!cache) {
    deps.report?.("BYPASS");
    const result = await readDomain(hostname, client);
    return result.failed ? null : result.pageId;
  }

  const now = deps.now ?? Date.now;
  const hit = cache.get(hostname, now());
  if (hit) {
    deps.report?.("HIT");
    return hit.pageId;
  }
  const { result } = await cache.lookup(hostname, () => readDomain(hostname, client), now);
  deps.report?.("MISS");
  return result.failed ? null : result.pageId;
}
