import { SITEMAP_PATHS } from "@/components/marketing/site-map";
import { classifyHost } from "@/lib/routing/host";
import { rootOrigin } from "@/lib/routing/urls";

/**
 * robots.txt and sitemap.xml for every host. The proxy skips both paths (see its matcher), so one
 * route answers for the marketing host, the app host, tenant subdomains and custom domains alike;
 * the Host header decides what it says. Pure, so it is unit-tested without a server.
 *
 *   marketing  allow everything, and point at the sitemap of the root host
 *   app        disallow everything: the editor is private
 *   www        same as marketing (normally redirected before it gets here)
 *   tenant     allow the page, keep crawlers off the click-redirect and beacon routes; no sitemap
 *   custom     as tenant
 *
 * The sitemap exists only on the marketing host; every other host answers 404, so a tenant
 * subdomain or a custom domain never lists the marketing pages as its own.
 */

export interface TextResponse {
  status: number;
  contentType: string;
  body: string;
}

export function robotsTxt(host: string, rootDomain: string): TextResponse {
  const { kind } = classifyHost(host, rootDomain);
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
  return {
    status: 200,
    contentType: plain,
    body: "User-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /api/\n",
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
