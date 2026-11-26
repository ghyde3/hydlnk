import { archiveRouteFromParams } from "@/lib/routing/archive-paths";
import { siteArchiveResponse } from "@/lib/tenant-render/blog-respond";

/*
 * The feed of an archive (Wave B, M16-06): `/{archive}/feed.xml`, RSS 2.0, the 20 newest posts.
 * Dynamic over a cached string, like every route under an archive; a first segment that is not an
 * enabled archive answers the plain 404 with no read of its own.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pageId: string; archive: string }> },
) {
  const { pageId, archive } = await params;
  return siteArchiveResponse(pageId, archiveRouteFromParams({ archive, feed: true }));
}
