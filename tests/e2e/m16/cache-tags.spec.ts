import { expect, test, type BrowserContext } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, signIn } from "../fixtures/data";
import { PRODUCTION_BUILD, appRaw, authCookies, cookieHeader, rawRequest } from "../fixtures/http";
import { DEV_PORT } from "../helpers";
import type { Block } from "@/lib/document";
import { ingestPage, type IngestPage } from "../m4/analytics-ingest-helpers";

/**
 * M16-09: cache tags per entry, type and site, end to end through the real routes. Written for a
 * production build (CI's browser suite, the `full-ci` label): there, post A's HTML is a Data Cache
 * entry under `entry:<A>`, and the proof that publishing post B does not render A again is a marker
 * written straight into A's published copy behind the cache's back: it must NOT show after B's
 * publish (the type tag expired, the entry tag did not), while the archive and A's "next" link,
 * which come from the type's index, show B at once. A's own publish then expires A.
 *
 * Against `next dev` nothing is cached (every request reads Postgres), so the marker shows at once;
 * the rest of the flow (the archive, the next link, the 404 after trash) is asserted there too.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 240_000 });

const APP = `http://app.localhost:${DEV_PORT}`;
/** A post page's "next" link (the stylesheet names `[rel="next"]` too, so the href is part of it). */
const hasNext = (html: string) => html.includes('rel="next" href="');
const A = { slug: "post-a", title: "Post A" };
const B = { slug: "post-b", title: "Post B" };

async function postType(siteId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("content_types")
    .update({ enabled: true })
    .eq("site_id", siteId)
    .eq("key", "post")
    .select("id")
    .single();
  if (error) throw new Error(`enabling the blog failed: ${error.message}`);
  return data.id as string;
}

async function addDraft(siteId: string, typeId: string, post: typeof A, body: string) {
  const { data, error } = await adminClient()
    .from("content_entries")
    .insert({
      site_id: siteId,
      type_id: typeId,
      draft: { title: post.title, slug: post.slug, body } as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(`adding ${post.slug} failed: ${error.message}`);
  return data.id as string;
}

async function revOf(entryId: string): Promise<number> {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("rev")
    .eq("id", entryId)
    .single();
  if (error) throw new Error(error.message);
  return Number(data.rev);
}

/** A post action through the real app route (the writer expires the tags in the server process). */
async function act(
  context: BrowserContext,
  site: IngestPage,
  entryId: string,
  action: "publish" | "unpublish" | "trash",
) {
  const response = await appRaw(`/api/pages/${site.pageId}/entries/${entryId}/${action}`, {
    method: "POST",
    cookie: cookieHeader(await authCookies(context)),
    headers: { origin: APP, "content-type": "application/json" },
    body: JSON.stringify({ rev: await revOf(entryId) }),
  });
  expect(response.status, `${action}: ${response.body}`).toBe(200);
}

test(
  "M16-09 publishing post B leaves post A's cached HTML alone while the archive and A's next link show B",
  { tag: "@full-ci" },
  async ({ context }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const site = await ingestPage("ct", { plan: "pro" });
    await signIn(context, site.email);
    const typeId = await postType(site.pageId);
    const get = (path: string) => rawRequest(site.host, path);

    // Post A goes live through the real route and is requested once (in production: now cached).
    const a = await addDraft(site.pageId, typeId, A, "Body of A, first version.");
    await act(context, site, a, "publish");
    const first = await get(`/blog/${A.slug}`);
    expect(first.status).toBe(200);
    expect(first.body.includes("Body of A, first version.")).toBe(true);
    expect(hasNext(first.body)).toBe(false);
    expect((await get("/blog")).body.includes(A.title)).toBe(true);

    // Behind the cache's back: A's published copy changes with no invalidation at all.
    const marked = await adminClient()
      .from("content_entries")
      .update({
        published: { title: A.title, slug: A.slug, body: "Body of A, UNCACHED MARKER." } as never,
      })
      .eq("id", a);
    if (marked.error) throw new Error(marked.error.message);

    // Post B is published: its own entry tag and the type tag expire. Not A's, not the site's.
    const b = await addDraft(site.pageId, typeId, B, "Body of B.");
    await act(context, site, b, "publish");

    // The archive and the feed (the type tag) show B on the next request.
    const archive = await get("/blog");
    expect(archive.status).toBe(200);
    expect(archive.body.includes(B.title)).toBe(true);
    expect(archive.body.includes(A.title)).toBe(true);
    expect((await get("/blog/feed.xml")).body.includes(B.title)).toBe(true);
    expect((await get(`/blog/${B.slug}`)).body.includes("Body of B.")).toBe(true);

    // A's "next" link is B (from the type's index, written into the cached page per request)...
    const again = await get(`/blog/${A.slug}`);
    expect(again.status).toBe(200);
    expect(again.body.includes(`rel="next" href="/blog/${B.slug}"`)).toBe(true);
    // ...and A's own HTML was not rendered again: the marker is still not in it.
    expect(again.body.includes("UNCACHED MARKER")).toBe(!PRODUCTION_BUILD);
    expect(again.body.includes("Body of A, first version.")).toBe(PRODUCTION_BUILD);

    // A's own publish expires A: the saved draft shows on the next request.
    const edited = await adminClient()
      .from("content_entries")
      .update({
        draft: { title: A.title, slug: A.slug, body: "Body of A, second version." } as never,
      })
      .eq("id", a);
    if (edited.error) throw new Error(edited.error.message);
    await act(context, site, a, "publish");
    const republished = await get(`/blog/${A.slug}`);
    expect(republished.body.includes("Body of A, second version.")).toBe(true);
    expect(republished.body.includes("UNCACHED MARKER")).toBe(false);

    // Trash takes B down at once: its page, the archive entry and A's next link.
    await act(context, site, b, "trash");
    expect((await get(`/blog/${B.slug}`)).status).toBe(404);
    expect((await get("/blog")).body.includes(B.title)).toBe(false);
    expect(hasNext((await get(`/blog/${A.slug}`)).body)).toBe(false);
  },
);

test(
  "M16-07 M16-09 Home's Latest posts card goes on the next request after the post is unpublished or trashed",
  { tag: "@full-ci" },
  async ({ context }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const block = {
      id: "latest-posts-ct",
      type: "latest_posts",
      visible: true,
      heading: "From the blog",
      count: 3,
    } as unknown as Block;
    const site = await ingestPage("cl", { plan: "pro", blocks: [block] });
    await signIn(context, site.email);
    const typeId = await postType(site.pageId);
    const get = (path: string) => rawRequest(site.host, path);
    const C = { slug: "post-c", title: "Post C" };
    const a = await addDraft(site.pageId, typeId, A, "Body of A.");
    const c = await addDraft(site.pageId, typeId, C, "Body of C.");
    await act(context, site, a, "publish");
    await act(context, site, c, "publish");

    // Home lists both (in production this response is now the cached Home).
    const first = await get("/");
    expect(first.status).toBe(200);
    expect(first.body.includes(`href="/blog/${A.slug}"`)).toBe(true);
    expect(first.body.includes(`href="/blog/${C.slug}"`)).toBe(true);
    expect((await get("/")).body.includes(`href="/blog/${C.slug}"`)).toBe(true);

    // Unpublished through the route: the very next Home has no card for it.
    await act(context, site, c, "unpublish");
    const afterUnpublish = await get("/");
    expect(afterUnpublish.body.includes(`href="/blog/${C.slug}"`)).toBe(false);
    expect(afterUnpublish.body.includes(`href="/blog/${A.slug}"`)).toBe(true);

    // Trashed: the last card goes, and with no post left the block draws nothing.
    await act(context, site, a, "trash");
    const afterTrash = await get("/");
    expect(afterTrash.status).toBe(200);
    expect(afterTrash.body.includes(`href="/blog/${A.slug}"`)).toBe(false);
    expect(afterTrash.body.includes("hl-latest-posts")).toBe(false);
  },
);
