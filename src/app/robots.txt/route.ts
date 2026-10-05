import { clientEnv } from "@/lib/env/client";
import { robotsTxt } from "@/lib/marketing/seo";
import { siteHostOrigin } from "@/lib/tenant-render/sitemap";

/** GET /robots.txt on any host; the content depends on the host (src/lib/marketing/seo.ts). */
export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  let siteOrigin: string | null = null;
  try {
    siteOrigin = await siteHostOrigin(host, rootDomain);
  } catch (error) {
    console.error("[robots] resolving the host failed", error);
  }
  const result = robotsTxt(host, rootDomain, siteOrigin);
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": result.contentType, "Cache-Control": "public, max-age=3600" },
  });
}
