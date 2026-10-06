import { protocolFor } from "@/lib/routing/urls";

/**
 * Which Origin may report a view for a page (M4-21): the page's own tenant origin, or one of its
 * verified custom hosts. A browser always sends Origin on the beacon's POST, so a missing Origin, or
 * any other origin (a forged curl, another site embedding the beacon call), is ignored.
 *
 *   production   https://{handle}.hydlnk.com, https://{custom host}
 *   local dev    http://{handle}.localhost:3000, http://{custom host}[:port]
 *
 * Returns the allowed origin's hostname (the page's own host, which `referrerHost` drops), or null.
 */

export interface OriginRules {
  /** `pages.handle` of the page. */
  handle: string;
  /** Hostnames of the page's verified custom domains. */
  customHosts: readonly string[];
  /** NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" locally, "hydlnk.com" in production. */
  rootDomain: string;
}

export function allowedOriginHost(origin: string | null, rules: OriginRules): string | null {
  if (!origin || origin.length > 300) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  // A real Origin header is exactly scheme://host[:port]: anything with a path, query, fragment or
  // credentials is not one, whatever it parses to.
  if (parsed.origin !== origin.toLowerCase() || parsed.origin === "null") return null;

  const protocol = protocolFor(rules.rootDomain);
  if (parsed.protocol !== `${protocol}:`) return null;

  const tenantOrigin = `${protocol}://${rules.handle}.${rules.rootDomain}`.toLowerCase();
  if (parsed.origin === tenantOrigin) return parsed.hostname;

  const hostname = parsed.hostname;
  if (!rules.customHosts.some((host) => host.toLowerCase() === hostname)) return null;
  // Custom domains are served on the default port; local development serves them on the dev port.
  return parsed.port === "" || protocol === "http" ? hostname : null;
}
