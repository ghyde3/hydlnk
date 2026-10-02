import type { CookieOptions } from "@supabase/ssr";
import { clientEnv } from "@/lib/env/client";
import { protocolFor } from "./urls";

/**
 * Auth cookies are host-only: they are set for app.<root> and never for the parent domain, so
 * tenant subdomains and custom domains cannot receive the session. Omitting `domain` is what makes
 * a cookie host-only, so this removes it from whatever options a caller hands over.
 *
 * They are also `Secure` on every https deployment: @supabase/ssr never sets the flag itself.
 * Only plain-http local development (`localhost:3000`) goes without it (M1-06).
 */
export function hostOnlyCookie(
  options: CookieOptions,
  rootDomain: string = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
): CookieOptions {
  const hostOnly: CookieOptions = { ...options, secure: protocolFor(rootDomain) === "https" };
  delete hostOnly.domain;
  return hostOnly;
}
