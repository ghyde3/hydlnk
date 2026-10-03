import { customOrigin } from "@/lib/routing/urls";

/**
 * Where a custom domain's OG image is served: `/og` on the custom host, versioned by the publish
 * time exactly like the handle host's image (`ogImageUrl` in src/lib/publish/urls.ts), so a cache
 * in front of it never serves the old image under the new page's URL.
 */
export function customOgImageUrl(
  hostname: string,
  publishedAt: string | null,
  rootDomain: string,
): string {
  const version = publishedAt ? Date.parse(publishedAt) : NaN;
  const query = Number.isFinite(version) ? `?v=${version}` : "";
  return `${customOrigin(hostname, rootDomain)}/og${query}`;
}
