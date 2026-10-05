import "server-only";
import { getTenantPageState, getTenantPageStateById } from "@/app/(tenant)/published-page";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { siteSitemapXml, type TextResponse } from "@/lib/marketing/seo";
import { tenantOrigin } from "@/lib/publish/urls";
import { lookupKey, resolveCustomDomain } from "@/lib/routing/custom-domain";
import { classifyHost, invalidHandleLabel } from "@/lib/routing/host";
import { customOrigin } from "@/lib/routing/urls";
import { getSiteIndex } from "@/lib/site/published";

/**
 * `/sitemap.xml` and the sitemap line of `/robots.txt` on a site's own hosts (M11-10). Both paths
 * skip the proxy (see its matcher), so the route resolves the host itself: a handle host by its
 * handle, a custom host through the same cached lookup the proxy uses (`resolveCustomDomain`, the
 * real Host header only). The sitemap lists Home and every live sub-page on the site's PRIMARY host:
 * its oldest verified custom domain when it has one, else its handle host. It is read from the cached
 * public read and the cached site index, so a Publish refreshes it with the pages. A site that is
 * not published, a suspended owner and an unknown host are 404.
 */

const PLAIN = "text/plain; charset=utf-8";
const notFound = (): TextResponse => ({ status: 404, contentType: PLAIN, body: "Not found\n" });

/** What a host serves: `null` for a host that is not a site's (marketing, app: the caller answers). */
export async function tenantSitemap(
  host: string,
  rootDomain: string,
): Promise<TextResponse | null> {
  const { kind, handle } = classifyHost(host, rootDomain);
  if (kind === "tenant" && handle) {
    const state = await getTenantPageState(handle);
    if (state.kind !== "published") return notFound();
    const primary = await getPrimaryDomain(state.page.pageId);
    const origin = primary ? customOrigin(primary, rootDomain) : tenantOrigin(handle, rootDomain);
    return siteSitemapXml(
      origin,
      (await getSiteIndex(state.page.pageId)).map((page) => page.path),
    );
  }
  if (kind !== "custom") return null;
  if (invalidHandleLabel(host, rootDomain)) return notFound();
  const pageId = await resolveCustomDomain(host);
  const hostname = lookupKey(host);
  if (!pageId || !hostname) return notFound();
  const state = await getTenantPageStateById(pageId);
  if (state.kind !== "published") return notFound();
  const primary = (await getPrimaryDomain(pageId)) ?? hostname;
  return siteSitemapXml(
    customOrigin(primary, rootDomain),
    (await getSiteIndex(pageId)).map((page) => page.path),
  );
}

/** The origin a custom host's robots.txt names its sitemap on, or null when the host is not a verified domain. */
export async function customHostOrigin(host: string, rootDomain: string): Promise<string | null> {
  if (classifyHost(host, rootDomain).kind !== "custom" || invalidHandleLabel(host, rootDomain)) {
    return null;
  }
  const hostname = lookupKey(host);
  if (!hostname || !(await resolveCustomDomain(host))) return null;
  return customOrigin(hostname, rootDomain);
}
