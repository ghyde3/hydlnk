import { archiveRouteFromParams } from "@/lib/routing/archive-paths";
import { handleArchiveResponse } from "@/lib/tenant-render/blog-respond";

/*
 * A post (Wave B, M16-04): `/{archive}/{slug}` on the site's host, rewritten here by the proxy only
 * for that exact shape (`archiveRoute`). Dynamic on purpose, like the sub-page route beside it
 * (`p/[path]/route.ts` explains why): Next.js stores nothing per path a visitor invents. The
 * responder decides from cached reads (the site's archives, the type's post index) and reads the
 * post's cached HTML only by a real entry id. The params are parsed again before anything is read.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string; archive: string; slug: string }> },
) {
  const { handle, archive, slug } = await params;
  return handleArchiveResponse(handle, archiveRouteFromParams({ archive, slug }));
}
