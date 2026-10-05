import { clientEnv } from "@/lib/env/client";
import { sitemapXml } from "@/lib/marketing/seo";
import { tenantSitemap } from "@/lib/tenant-render/sitemap";

/**
 * GET /sitemap.xml: the marketing pages on the root host, a site's own sitemap (Home and its live
 * sub-pages, M11-10) on a handle host or a verified custom domain, 404 on every other host.
 */
export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  let site;
  try {
    site = await tenantSitemap(host, rootDomain);
  } catch (error) {
    console.error("[sitemap] failed", error);
    return new Response("Something went wrong\n", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const result = site ?? sitemapXml(host, rootDomain);
  return new Response(result.body, {
    status: result.status,
    headers: {
      "Content-Type": result.contentType,
      // A site's sitemap follows its Publish within a minute; the marketing one changes with a deploy.
      "Cache-Control": site ? "public, max-age=60" : "public, max-age=3600",
    },
  });
}
