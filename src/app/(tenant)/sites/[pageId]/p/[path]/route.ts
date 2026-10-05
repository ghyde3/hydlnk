import { siteSubPageResponse } from "@/lib/tenant-render/respond";

/*
 * A sub-page of a verified custom domain (M11-06): the proxy resolves the host to its site and
 * rewrites `/items` to /sites/<pageId>/p/items, only for one valid, non-reserved lowercase segment
 * (everything else is the plain 404). Dynamic on purpose, for the reason documented in
 * `src/app/(tenant)/t/[handle]/p/[path]/route.ts`: a static route would store one cache entry per
 * path a visitor invents; this one stores none and answers from the site's cached public read, the
 * cached site index and, for a real page, the cached page under its own id, all under `page:<id>`.
 * It answers exactly what the handle host answers, so a publish shows on both at once. Never
 * reachable by typing the path on any host (the proxy answers 404), and `pageId` and `path` are
 * validated here as well.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pageId: string; path: string }> },
) {
  const { pageId, path } = await params;
  return siteSubPageResponse(pageId, path);
}
