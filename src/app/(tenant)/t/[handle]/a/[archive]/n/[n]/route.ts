import { archiveRouteFromParams } from "@/lib/routing/archive-paths";
import { handleArchiveResponse } from "@/lib/tenant-render/blog-respond";

/*
 * Page n of an archive (Wave B, M16-05): `/{archive}/page/{n}`, n from 2 to 9999. Dynamic, with no
 * entry stored per path: a number past the last page answers the plain 404 from the cached post
 * index, and the page's HTML is cached only for a page the index proved.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string; archive: string; n: string }> },
) {
  const { handle, archive, n } = await params;
  // "1" is never a public path here (page 1 is the archive itself), so it is refused before parsing.
  return handleArchiveResponse(handle, n === "1" ? null : archiveRouteFromParams({ archive, n }));
}
