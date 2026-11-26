import { expect, test } from "@playwright/test";
import type { Block } from "@/lib/document";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { addBlock, openEditor, previewScreen, showView, userWithDraft } from "../m2/blocks-helpers";
import { ingestPage } from "../m4/analytics-ingest-helpers";
import { addPost, daysBefore, enableBlog } from "./public-helpers";

/**
 * M16-07 at 390x844 and 1440x900: the Latest posts block. On the live Home it lists the newest
 * published posts as links, another published post shows on the next request without republishing
 * the page, and it draws nothing while the blog is off. In the editor the block is added from the
 * chips, its form is usable, and the preview shows the site's real published posts.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const BLOCK = {
  id: "latest-posts-e2e",
  type: "latest_posts",
  visible: true,
  heading: "From the blog",
  count: 3,
} as unknown as Block;

test("the live Home lists the newest posts, and a new post shows on the next request", async ({
  page,
}) => {
  const site = await ingestPage("latest", { plan: "pro", blocks: [BLOCK] });
  const typeId = await enableBlog(site.pageId);
  await addPost(site, typeId, { title: "First post", slug: "first", publishedAt: daysBefore(3) });
  await addPost(site, typeId, { title: "Second post", slug: "second", publishedAt: daysBefore(2) });
  await addPost(site, typeId, { title: "A draft", slug: "a-draft", live: false });

  await page.goto(site.url);
  const block = page.locator(".hl-latest-posts");
  await expect(block.locator("h2")).toHaveText("From the blog");
  await expect(block.locator("a")).toHaveCount(2);
  await expect(block.locator("a").first()).toHaveAttribute("href", "/blog/second");
  await expect(block.locator("a").first()).toContainText("Second post");
  await expect(block).not.toContainText("A draft");
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, ".hl-latest-posts");

  await addPost(site, typeId, { title: "Third post", slug: "third", publishedAt: daysBefore(1) });
  await page.reload();
  await expect(block.locator("a")).toHaveCount(3);
  await expect(block.locator("a").first()).toContainText("Third post");

  await block.locator("a").first().click();
  await expect(page).toHaveURL(`${site.origin}/blog/third`);
  await expect(page.locator("h1")).toHaveText("Third post");

  // The blog is turned off: the block draws nothing, and the page is otherwise what it was.
  await enableBlog(site.pageId, false);
  await page.goto(site.url);
  await expect(page.locator(".hl-latest-posts")).toHaveCount(0);
  await expect(page.locator("[data-page-root]")).toBeVisible();
});

test("the editor: add the block, set it up, and see the published posts in the preview", async ({
  page,
  context,
}) => {
  const user = await userWithDraft(context, "latested", undefined, { plan: "pro" });
  const site = { pageId: user.pageId, userId: user.userId };
  const typeId = await enableBlog(user.pageId);
  await addPost(site, typeId, {
    title: "Shown in preview",
    slug: "shown",
    publishedAt: daysBefore(1),
  });
  await addPost(site, typeId, { title: "Older one", slug: "older", publishedAt: daysBefore(2) });
  await addPost(site, typeId, { title: "Never shown", slug: "never", live: false });

  await openEditor(page);
  const { panel } = await addBlock(page, "latest_posts");
  await expect(panel.locator('[data-field="count"]')).toHaveValue("3");
  await expect(panel.locator('[data-field="categoryId"]')).toHaveValue("");
  await panel.locator('[data-field="heading"]').fill("Latest");
  await panel.locator('[data-field="count"]').selectOption("1");
  await expectTapTargets(page, '[id^="block-panel-"]');
  await expectNoHorizontalScroll(page);

  await showView(page, "Preview");
  const preview = previewScreen(page).locator(".hl-latest-posts");
  await expect(preview.locator("h2")).toHaveText("Latest");
  await expect(preview.locator(".pg-latest-item")).toHaveCount(1);
  await expect(preview).toContainText("Shown in preview");
  await expect(preview).not.toContainText("Never shown");
});

test("the latest-posts route answers only the owner, with published posts only", async ({
  page,
  context,
  request,
}) => {
  const user = await userWithDraft(context, "latestrt", undefined, { plan: "pro" });
  const typeId = await enableBlog(user.pageId);
  const site = { pageId: user.pageId, userId: user.userId };
  await addPost(site, typeId, { title: "Live one", slug: "live-one" });
  await addPost(site, typeId, { title: "Secret draft", slug: "secret", live: false });
  const other = await ingestPage("latestother", { plan: "pro" });

  await openEditor(page);
  const app = new URL(page.url()).origin;
  const own = await page.request.get(`${app}/api/pages/${user.pageId}/posts/latest`);
  expect(own.status()).toBe(200);
  expect(own.headers()["cache-control"]).toBe("no-store");
  const body = JSON.stringify(await own.json());
  expect(body).toContain("Live one");
  expect(body).not.toContain("Secret draft");
  // Another account's site and a malformed id are the same 404; signed out is 401.
  expect((await page.request.get(`${app}/api/pages/${other.pageId}/posts/latest`)).status()).toBe(
    404,
  );
  expect((await page.request.get(`${app}/api/pages/not-an-id/posts/latest`)).status()).toBe(404);
  const anonymous = await request.get(`${app}/api/pages/${user.pageId}/posts/latest`);
  expect(anonymous.status()).toBe(401);
});
