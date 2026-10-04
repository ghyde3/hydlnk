import { siteResponse } from "@/lib/tenant-render/respond";

/*
 * A verified custom domain's page (M4-09, M8-02). The proxy rewrites a custom host here as
 * /sites/<pageId> after looking the host up in `domains`; this route is never reachable by typing
 * the path on any host (the proxy answers 404), and it validates the id itself as well. It answers
 * exactly what /t/[handle] answers, from the same cached public read under the same per-page tag, so
 * a publish changes both at once. Static like the handle page: no request API is read, so og:url
 * names the page's primary domain (the oldest verified one, `getPrimaryDomain`), which is also what
 * a search engine should treat as canonical. The sentinel `unknown` (an unknown host) is the plain 404.
 */
export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return siteResponse(pageId);
}
