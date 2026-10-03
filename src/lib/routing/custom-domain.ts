import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HOSTNAME_PATTERN } from "@/lib/domains/hostname";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Custom-domain lookup for hosts that are neither the root, www, app nor a handle subdomain
 * (M4-09). Runs in the proxy on every request to a custom host, so it is deliberately small:
 *
 *   - the input is the request's real Host header and nothing else (the proxy never passes
 *     X-Forwarded-Host or X-Original-Host); it is lower-cased, its port and one trailing dot are
 *     dropped, and anything that is not a plain domain name (the `domains_hostname_format` shape,
 *     which also rules out IPs and garbage) or that sits under vercel.app is "unknown" without a
 *     database round trip;
 *   - the answer is the page id of a `domains` row with that hostname and status 'verified' whose
 *     page has something published; a pending or errored row, a draft-only page and a hostname with
 *     no row all answer null (the proxy rewrites those to the plain 404);
 *   - a database error, a timeout or missing configuration also answers null: a 404 with no details,
 *     never a 500;
 *   - the hostname is only ever a filter value of a database query. It is never fetched (SSRF);
 *   - nothing is cached between requests. A removed or re-pointed domain must stop or change at the
 *     very next request (M4-17), so each request asks Postgres (one indexed lookup). The page
 *     content itself is cached per page by the tenant loader, shared with the handle host.
 *
 * The proxy bundle cannot import `server-only` modules, so this talks to Supabase with the plain
 * client and the secret key from process.env (server runtime only; never reaches the browser).
 */

const LOOKUP_TIMEOUT_MS = 3_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export interface CustomDomainDeps {
  client?: SupabaseClient<Database> | null;
}

export async function resolveCustomDomain(
  host: string,
  deps: CustomDomainDeps = {},
): Promise<string | null> {
  const hostname = lookupKey(host);
  if (!hostname) return null;
  const client = deps.client === undefined ? secretClient() : deps.client;
  if (!client) {
    console.error("[proxy] custom-domain lookup is not configured");
    return null;
  }
  try {
    const { data, error } = await client
      .from("domains")
      .select("page_id, pages!inner(published_at)")
      .eq("hostname", hostname)
      .eq("status", "verified")
      .not("pages.published_at", "is", null)
      .limit(1)
      .abortSignal(AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
    if (error) {
      console.error("[proxy] custom-domain lookup failed");
      return null;
    }
    const row = data?.[0];
    if (!row || !UUID.test(row.page_id) || row.pages?.published_at == null) return null;
    return row.page_id;
  } catch {
    console.error("[proxy] custom-domain lookup failed");
    return null;
  }
}
