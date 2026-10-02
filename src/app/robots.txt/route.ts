import { clientEnv } from "@/lib/env/client";
import { robotsTxt } from "@/lib/marketing/seo";

/** GET /robots.txt on any host; the content depends on the host (src/lib/marketing/seo.ts). */
export function GET(request: Request): Response {
  const result = robotsTxt(request.headers.get("host") ?? "", clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": result.contentType, "Cache-Control": "public, max-age=3600" },
  });
}
