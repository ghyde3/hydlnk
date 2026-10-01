/**
 * Custom-domain lookup for hosts that are neither the root, www, app nor a handle subdomain.
 *
 * TODO(M4): look the host up in `domains` (verified rows only, hostname unique) and return the
 * owning page id. The proxy then rewrites to /sites/<pageId>. The proxy bundle cannot import
 * `server-only` modules (`@/lib/env/server`, the admin client), so do the lookup with a small
 * fetch to PostgREST using the secret key from process.env, or with an internal route handler.
 * Cache hits per host for a short time: this runs on every request to a custom domain.
 */
export async function resolveCustomDomain(host: string): Promise<string | null> {
  void host;
  return null;
}
