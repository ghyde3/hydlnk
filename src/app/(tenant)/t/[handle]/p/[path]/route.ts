import { handleSubPageResponse } from "@/lib/tenant-render/respond";

/*
 * A sub-page of a handle host (M11-06): `<handle>.hydlnk.com/items` is rewritten here by the proxy as
 * /t/<handle>/p/items, only when the path is one valid, non-reserved lowercase segment
 * (`isValidSubPagePath`; everything else is the one plain 404, /sites/unknown, as before).
 *
 * Why this route is DYNAMIC and Home's is static. Home's routes are `force-static` with
 * `dynamicParams = true`, and Next.js's docs say what that means for a param that was not prebuilt:
 * it is "generated on-demand" (incremental-static-regeneration.md, step 7; dynamicParams.md: `true`
 * generates segments not in generateStaticParams at request time), and the generated response is
 * stored per param. For `[handle]` that is bounded by real handles (the page read answers
 * the 404 and registers a short revalidate). For a path chosen by a visitor it would be one stored
 * entry per invented path: anybody could fill the cache with `/a1`, `/a2`, ... (the Wave J finding
 * `src/lib/routing/paths.ts` and the proxy describe). So this route is `force-dynamic`: Next.js
 * stores nothing for it, whatever the path, and the cost of a request is bounded by the Data Cache
 * instead:
 *
 *   0. the handle's page id (`["tenant-handle-id", version, handle]`, a minute, the handle's tag,
 *      expired by the claim and delete flows): the id only, so a request never looks the handle up
 *      in Postgres;
 *   1. the site's public read (Home's, `["tenant-page", version, pageId]`): published, plan,
 *      suspension, redirect mode;
 *   2. the site INDEX (`["tenant-site-index", version, pageId]`): the live sub-pages' id, path and
 *      title. An invented path is not in it and answers the branded 404 here, after cached
 *      reads only, with no entry of its own;
 *   3. only for a path that IS in the index, the page itself by its REAL id
 *      (`["tenant-sub-page", version, subPageId]`): one entry per real page.
 *
 * Reads 1 to 3 carry the site's tag, `page:<id>`, so Publish (`updateTag`), a plan change, a
 * suspension and a domain change refresh every page of the site on the next request. Nothing here
 * reads a request API: the response depends on the handle and the path only, and the 404 for a path
 * that is not a page is the same panel as every other.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string; path: string }> },
) {
  const { handle, path } = await params;
  return handleSubPageResponse(handle, path);
}
