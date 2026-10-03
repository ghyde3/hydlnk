import type { ClickTarget } from "./types";

/** Lower case, no port, no trailing dot: the way the proxy reads a Host header. Null when empty. */
export function normalizeRequestHost(host: string | null): string | null {
  if (host === null) return null;
  const lowered = host.trim().toLowerCase().replace(/:\d{1,5}$/, "");
  const bare = lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
  return bare === "" ? null : bare;
}

/**
 * True when `host` (the request's real Host header) is `{handle}.{root domain}` or one of the page's
 * verified custom hosts. The root domain is compared without its port ("localhost:3000" locally).
 */
export function hostServesPage(
  host: string | null,
  page: Pick<ClickTarget, "handle" | "customHosts">,
  rootDomain: string,
): boolean {
  const requested = normalizeRequestHost(host);
  const root = normalizeRequestHost(rootDomain);
  if (requested === null || root === null) return false;
  if (requested === `${page.handle.toLowerCase()}.${root}`) return true;
  return page.customHosts.some((custom) => custom.toLowerCase() === requested);
}
