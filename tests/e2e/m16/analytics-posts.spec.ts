import { ownerSession, postAction } from "./owner-routes";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly, signIn } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { ANALYTICS, kpi } from "../m4/analytics-dash-helpers";
import {
  ingestPage,
  postBeacon,
  randomIp,
  settledCount,
  userAgentFor,
  waitForEvents,
  type IngestPage,
} from "../m4/analytics-ingest-helpers";

/**
 * M16-11: views of posts and of the archive, on the phone (390x844) and desktop (1440x900). A site
 * with a blog, a live post, a draft post and a trashed one; a second site with its own live post.
 * The real `/api/e` records a post under its entry id and the archive under the Post type's id, and
 * drops a draft's id, another site's ids and an invented one. The Analytics page filter then names
 * "Blog" and the post by its title, and the trashed post reads "Deleted page".
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const LIVE_TITLE = "Notes from the studio";
const DRAFT_TITLE = "Not out yet";
const THEIR_TITLE = "Another site's post";

interface Blog {
  site: IngestPage;
  typeId: string;
  live: string;
  draft: string;
  trashed: string;
}

/** Turns the site's blog on and returns the Post type's id (the secret key, as the writer would). */
async function enableBlog(siteId: string): Promise<string> {
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

/** A post entry: a draft, or published through the real `publish_entry`. */
async function addPost(
  site: Pick<IngestPage, "pageId" | "userId">,
  typeId: string,
  post: { title: string; slug: string; live: boolean },
): Promise<string> {
  const admin = adminClient();
  const draft = { title: post.title, slug: post.slug, body: `Hello from ${post.title}.` };
  const made = await admin
    .from("content_entries")
    .insert({ site_id: site.pageId, type_id: typeId, draft: draft as never })
    .select("id, rev")
    .single();
  if (made.error) throw new Error(`adding a post failed: ${made.error.message}`);
  if (post.live) {
    const published = await admin.rpc("publish_entry", {
      p_entry_id: made.data.id,
      p_owner_id: site.userId,
      p_expected_rev: Number(made.data.rev),
      p_published: draft as never,
    });
    if (published.error) throw new Error(`publishing a post failed: ${published.error.message}`);
  }
  return made.data.id as string;
}

async function makeBlog(label: string, liveTitle = LIVE_TITLE): Promise<Blog> {
  const site = await ingestPage(label, { plan: "pro" });
  const typeId = await enableBlog(site.pageId);
  const live = await addPost(site, typeId, { title: liveTitle, slug: "notes", live: true });
  const draft = await addPost(site, typeId, { title: DRAFT_TITLE, slug: "not-out", live: false });
  const trashed = await addPost(site, typeId, { title: "Gone", slug: "gone", live: true });
  return { site, typeId, live, draft, trashed };
}

let blog: Blog;
let other: Blog;

test.beforeAll(async ({ browser }, info) => {
  blog = await makeBlog("bp");
  other = await makeBlog("bo", THEIR_TITLE);
  const ua = userAgentFor(info.project.name);
  const view = (subPageId: string) =>
    postBeacon(
      blog.site,
      { pageId: blog.site.pageId, subPageId, referrer: "" },
      {
        ip: randomIp(),
        ua,
      },
    );
  // The live post twice, the archive once, the post that is trashed below once: four rows.
  for (const id of [blog.live, blog.live, blog.typeId, blog.trashed]) {
    const response = await view(id);
    if (response.status !== 204) throw new Error(`a view answered ${response.status}`);
  }
  await waitForEvents(blog.site.pageId, 4);
  // Trashed through the real route (the live copy goes with it, and the writer expires the cache
  // the beacon's check reads, so a production build drops the trashed post's views at once).
  const owner = await ownerSession(browser, blog.site.email);
  await postAction(owner, blog.site.pageId, blog.trashed, "trash");
  await owner.close();
});

test("M16-11 the beacon records a live post and the archive, and drops everything else", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const rows = await waitForEvents(blog.site.pageId, 4);
  expect(rows.map((row) => (row as unknown as { sub_page_id: string }).sub_page_id).sort()).toEqual(
    [blog.live, blog.live, blog.typeId, blog.trashed].sort(),
  );
  expect(rows.every((row) => row.type === "view")).toBe(true);

  // A draft's id, the trashed post's id now, another site's post and type, and an invented id: the
  // same silent 204, and no row for this site or for the other one.
  const ok = await postBeacon(other.site, { pageId: other.site.pageId, referrer: "" });
  for (const subPageId of [blog.draft, blog.trashed, other.live, other.typeId, randomUUID()]) {
    const response = await postBeacon(blog.site, {
      pageId: blog.site.pageId,
      subPageId,
      referrer: "",
    });
    expect(response.status, subPageId).toBe(204);
    expect(response.body).toBe(ok.body);
  }
  // This site's post id sent as a view of the OTHER site (from the other site's own origin).
  const crossed = await postBeacon(other.site, {
    pageId: other.site.pageId,
    subPageId: blog.live,
    referrer: "",
  });
  expect(crossed.status).toBe(204);
  expect(await settledCount(blog.site.pageId)).toBe(4);
  // The other site has its one Home view and nothing else.
  const theirs = await waitForEvents(other.site.pageId, 1);
  expect(await settledCount(other.site.pageId)).toBe(1);
  expect((theirs[0] as unknown as { sub_page_id: string | null }).sub_page_id).toBeNull();
});

const filter = (page: Page) => page.getByTestId("page-filter");

test("M16-11 Analytics lists Blog and the post by its title; a trashed post is a Deleted page", async ({
  page,
  context,
}, info) => {
  await signIn(context, blog.site.email);
  await page.goto(`${ANALYTICS()}?range=7`);
  await expect(page.getByTestId("kpi-strip")).toBeVisible();
  const labels = await filter(page).locator("option").allInnerTexts();
  expect(labels).toEqual(["All pages", "Home", "Blog", LIVE_TITLE, "Deleted page"]);
  // A draft post is never named, and the list is the posts that have views in the range.
  expect(labels).not.toContain(DRAFT_TITLE);
  expect(await kpi(page, "Views")).toBe("4");

  await filter(page).selectOption({ label: LIVE_TITLE });
  await expect.poll(() => kpi(page, "Views")).toBe("2");
  expect(page.url()).toContain(`filter=${blog.live}`);
  await filter(page).selectOption({ label: "Blog" });
  await expect.poll(() => kpi(page, "Views")).toBe("1");
  await filter(page).selectOption({ label: "Deleted page" });
  await expect.poll(() => kpi(page, "Views")).toBe("1");

  await expectNoHorizontalScroll(page);
  if (phoneOnly(info)) await expectTapTargets(page, '[data-testid="page-filter"]');
});

test("M16-11 another owner's Analytics never names this site's posts", async ({
  page,
  context,
}) => {
  await signIn(context, other.site.email);
  await page.goto(`${ANALYTICS()}?range=7&filter=${blog.live}`);
  await expect(page.getByTestId("kpi-strip")).toBeVisible();
  const labels = await filter(page).locator("option").allInnerTexts();
  expect(labels).not.toContain(LIVE_TITLE);
  // Their own blog; their own live posts have no view in the range, so they are not named (a post
  // is listed once it has views). The foreign id they asked for is only ever "Deleted page".
  expect(labels).toEqual(["All pages", "Home", "Blog", "Deleted page"]);
  expect(labels).not.toContain(THEIR_TITLE);
  await expect(filter(page)).toHaveValue(blog.live);
  await expect(page.locator("option:checked")).toHaveText("Deleted page");
});

test("M16-11 opening the post and the archive in a browser sends their ids", async ({ page }) => {
  const sent: Array<{ pageId?: string; subPageId?: string | null }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/e" && request.method() === "POST") {
      sent.push(JSON.parse(request.postData() ?? "{}"));
    }
  });
  await page.goto(`${blog.site.origin}/blog/notes`);
  await expect(page.getByRole("heading", { level: 1, name: LIVE_TITLE })).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ pageId: blog.site.pageId, subPageId: blog.live });

  await page.goto(`${blog.site.origin}/blog`);
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ pageId: blog.site.pageId, subPageId: blog.typeId });
});
