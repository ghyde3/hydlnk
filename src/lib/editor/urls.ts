import { protocolFor } from "@/lib/routing/urls";

/**
 * Public address of a tenant page on a root domain: "http://mara.localhost:3000" in development,
 * "https://mara.hydlnk.com" in production. (The breadcrumb shows `{handle}.hydlnk.com` instead:
 * that one is display text.)
 */
export function tenantOrigin(handle: string, rootDomain: string): string {
  return `${protocolFor(rootDomain)}://${handle}.${rootDomain}`;
}
