import { clientEnv } from "@/lib/env/client";
import { sitemapXml } from "@/lib/marketing/seo";

/** GET /sitemap.xml: the marketing pages on the root host, 404 on every other host. */
export function GET(request: Request): Response {
  const result = sitemapXml(request.headers.get("host") ?? "", clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": result.contentType, "Cache-Control": "public, max-age=3600" },
  });
}
