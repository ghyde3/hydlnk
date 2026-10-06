import { handleResponse } from "@/lib/tenant-render/respond";

/*
 * The live page of a handle host (M2-22, M2-26, M8-02, M8-04): `<handle>.hydlnk.com/` is rewritten
 * here by the proxy. A STATIC route handler that answers finished HTML (no React in the browser, no
 * framework runtime) built by src/lib/tenant-render from the same PageRenderer the editor preview
 * draws. Next.js generates the response on the first request for a handle and serves it from its
 * cache after that, until the page's tag is expired (src/lib/publish/tags.ts): Publish with
 * `updateTag`, a plan change or a suspension with `invalidateAccountPages`, a claim with
 * `invalidateHandle`. Nothing here reads a request API (no cookies, no headers, no query string), so
 * the document is identical for every visitor and a query string can never force a regeneration.
 * `generateStaticParams` returns nothing to prebuild: every handle is generated on demand
 * (`dynamicParams`). `revalidate` is the backstop under a missed invalidation (PAGE_REVALIDATE_SECONDS,
 * pinned by tests/unit/m8-render-routes.test.ts); a handle with nothing to show registers a shorter one.
 * `next dev` renders every request on demand and reads Postgres every time.
 *
 * Only GET and HEAD reach it: the proxy answers every other method with 405 (a static handler that
 * exported POST would stop being static). Every other path on the host is rewritten by the proxy to
 * the one plain 404 (/sites/unknown), so an invented path never gets a cache entry of its own.
 */
export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return handleResponse(handle);
}
