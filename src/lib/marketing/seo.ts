import { SITEMAP_PATHS } from "@/components/marketing/site-map";
import { classifyHost } from "@/lib/routing/host";
import { protocolFor, rootOrigin } from "@/lib/routing/urls";

/**
 * robots.txt and sitemap.xml for every host. The proxy skips both paths (see its matcher), so one
 * route answers for the marketing host, the app host, tenant subdomains and custom domains alike;
 * the Host header decides what it says. Pure, so it is unit-tested without a server.
 *
 *   marketing  allow everything, and point at the sitemap of the root host
 *   app        disallow everything: the editor is private
 *   www        same as marketing (normally redirected before it gets here)
 *   tenant     allow the page and its sub-pages, keep crawlers off the click-redirect and beacon
 *              routes, and name the site's own sitemap (M11-10)
 *   custom     as tenant, naming the sitemap once the route has resolved the host to a site
 *
 * The marketing sitemap exists only on the marketing host. A tenant host or a custom domain answers
 * its own site's sitemap (src/lib/tenant-render/sitemap.ts: Home and the live sub-pages), so it
 * never lists the marketing pages as its own; the app host answers 404.
 */

export interface TextResponse {
  status: number;
  contentType: string;
  body: string;
}

/**
 * `siteOrigin`: for a custom host, the origin the route resolved it to (a verified domain of a
 * site); never taken from the request unchecked. A tenant host derives its own from the handle.
 */
export function robotsTxt(
  host: string,
  rootDomain: string,
  siteOrigin: string | null = null,
): TextResponse {
  const { kind, handle } = classifyHost(host, rootDomain);
  const plain = "text/plain; charset=utf-8";
  if (kind === "app") {
    return { status: 200, contentType: plain, body: "User-agent: *\nDisallow: /\n" };
  }
  if (kind === "marketing" || kind === "www") {
    return {
      status: 200,
      contentType: plain,
      body: `User-agent: *\nAllow: /\n\nSitemap: ${rootOrigin(rootDomain)}/sitemap.xml\n`,
    };
  }
  const own =
    kind === "tenant" && handle
      ? `${protocolFor(rootDomain)}://${handle}.${rootDomain}`
      : siteOrigin;
  return {
    status: 200,
    contentType: plain,
    body:
      "User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /api/\n" +
      (own ? `\nSitemap: ${own}/sitemap.xml\n` : ""),
  };
}

/**
 * A site's sitemap (M11-10): Home and every live sub-page, absolute, on the site's primary host
 * (`origin`: the verified custom domain when there is one, else the handle host). `paths` are the
 * sub-pages' live paths; they are valid segments by the database constraint, and escaped for XML
 * anyway.
 */
export function siteSitemapXml(origin: string, paths: readonly string[]): TextResponse {
  const xml = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const urls = [`${origin}/`, ...paths.map((path) => `${origin}/${path}`)]
    .map((url) => `  <url><loc>${xml(url)}</loc></url>`)
    .join("\n");
  return {
    status: 200,
    contentType: "application/xml; charset=utf-8",
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  };
}

export function sitemapXml(host: string, rootDomain: string): TextResponse {
  const { kind } = classifyHost(host, rootDomain);
  if (kind !== "marketing") {
    return { status: 404, contentType: "text/plain; charset=utf-8", body: "Not found\n" };
  }
  const origin = rootOrigin(rootDomain);
  const urls = SITEMAP_PATHS.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n");
  return {
    status: 200,
    contentType: "application/xml; charset=utf-8",
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  };
}
