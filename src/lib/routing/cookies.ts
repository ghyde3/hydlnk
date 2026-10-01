import type { CookieOptions } from "@supabase/ssr";

/**
 * Auth cookies are host-only: they are set for app.<root> and never for the parent domain, so
 * tenant subdomains and custom domains cannot receive the session. Omitting `domain` is what makes
 * a cookie host-only, so this removes it from whatever options a caller hands over.
 */
export function hostOnlyCookie(options: CookieOptions): CookieOptions {
  const hostOnly = { ...options };
  delete hostOnly.domain;
  return hostOnly;
}
