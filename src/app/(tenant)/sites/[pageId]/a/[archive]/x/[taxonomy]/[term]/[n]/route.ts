import { archiveRouteFromParams } from "@/lib/routing/archive-paths";
import { siteArchiveResponse } from "@/lib/tenant-render/blog-respond";

/*
 * A category or tag page (Wave B, M16-05): `/{archive}/category|tag/{term}` (n is 1) and its
 * `/page/{n}`. Dynamic, with no entry stored per path: an unknown term, a term with no live post
 * and a number past its last page answer the plain 404 from the cached term index.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ pageId: string; archive: string; taxonomy: string; term: string; n: string }>;
  },
) {
  const { pageId, archive, taxonomy, term, n } = await params;
  return siteArchiveResponse(pageId, archiveRouteFromParams({ archive, taxonomy, term, n }));
}
