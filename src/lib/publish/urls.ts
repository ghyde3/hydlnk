import { clientEnv } from "@/lib/env/client";
import { protocolFor } from "@/lib/routing/urls";

/**
 * The public origin of a tenant page on the HYDLNK root domain: `http://mara.localhost:3000`
 * locally, `https://mara.hydlnk.com` in production. Built from the handle and the configured root
 * domain, never from the request, so a cached page cannot carry a Host header someone chose.
 */
export function tenantOrigin(
  handle: string,
  rootDomain: string = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
): string {
  return `${protocolFor(rootDomain)}://${handle}.${rootDomain}`;
}

/**
 * Where a page's OG image is served: `/og` on the tenant host. `v` (the publish time in
 * milliseconds) changes with every publish, so a cache in front of the image never serves the old
 * one under the new page's URL.
 */
export function ogImageUrl(handle: string, publishedAt: string | null): string {
  const version = publishedAt ? Date.parse(publishedAt) : NaN;
  const query = Number.isFinite(version) ? `?v=${version}` : "";
  return `${tenantOrigin(handle)}/og${query}`;
}
