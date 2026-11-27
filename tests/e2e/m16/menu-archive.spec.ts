import { expect, test } from "@playwright/test";
import { PAGES_BLOG_TEST_IDS } from "@/lib/blog/test-ids";
import { cleanupUsers } from "../fixtures/data";
import { authCookies, cookieHeader, rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, openEditor, pageRow, previewScreen, statusChip } from "../m2/editor-helpers";
import { seedEntries } from "../m15/entry-helpers";
import { expireBlog, publishNewPost } from "./owner-routes";
import { POSTS_TEST_IDS, POSTS_URL, postTypeId } from "./posts-helpers";

/**
 * M16-08, end to end: add the blog, put it in the menu, publish, and the live Home shows the
 * archive's link (the Post type's plural label), which opens the archive. Turn the blog off and the
 * link is gone and `/blog` is the 404; the stored item is kept, so the link is back with the blog.
 * Runs at phone 390x844 and desktop 1440x900; each run makes its own user and site.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const MENU_LINK = /<a class="pg-menu-item"[^>]*href="\/blog"[^>]*>([^<]*)<\/a>/;

async function liveHome(host: string, check: (body: string) => boolean): Promise<string> {
  let body = "";
  await expect
    .poll(
      async () => {
        const response = await rawRequest(host, "/");
        body = response.body;
        return response.status === 200 && check(body);
      },
      { timeout: 30_000, message: `the live Home of ${host}` },
    )
    .toBe(true);
  return body;
}

test("M16-08 the blog's menu item survives Publish, links to the archive and hides while the blog is off", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "ma", { plan: "pro" });
  await seedEntries(user.pageId);
  const host = `${user.handle}.localhost:3000`;
  const typeId = await postTypeId(user.pageId);

  await openEditor(page);
  await page.getByTestId(PAGES_BLOG_TEST_IDS.addBlog).click();
  await expect(page.getByTestId(PAGES_BLOG_TEST_IDS.blogRow)).toBeVisible();
  await page.getByTestId("pages-blog-menu").click();
  await expect(page.getByTestId("pages-blog-menu-state")).toHaveText("In menu");
  await expect.poll(async () => (await pageRow(user.pageId)).draft.nav?.items).toContain(typeId);
  // The editor's preview draws the item as the live site will (desktop: the preview is on screen).
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await expect(previewScreen(page).locator('nav.pg-menu a[href="/blog"]')).toHaveText("Posts");
  }

  // Publish: the item is stored in the live menu, not stripped.
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  const published = (await pageRow(user.pageId)).published as { nav?: { items: string[] } };
  expect(published.nav?.items).toContain(typeId);
  const home = await liveHome(host, (body) => MENU_LINK.test(body));
  expect(home.match(MENU_LINK)?.[1]).toBe("Posts");

  // The link opens the archive, where it is the current item.
  await page.goto(`http://${host}/`);
  const link = page.locator('nav.pg-menu a[href="/blog"]');
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page);
  await link.click();
  await expect(page).toHaveURL(`http://${host}/blog`);
  await expect(page.locator(".hl-archive")).toBeVisible();
  await expect(page.locator('nav.pg-menu a[href="/blog"]')).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalScroll(page);

  // On a sub-page the item is there and not current; on a post page it is the current item.
  expect((await page.goto(`http://${host}/gallery`))?.status()).toBe(200);
  await expect(page.locator('nav.pg-menu a[href="/blog"]')).toHaveText("Posts");
  await expect(page.locator('nav.pg-menu a[href="/blog"]')).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  const owner = { cookie: cookieHeader(await authCookies(context)), close: async () => {} };
  await publishNewPost(owner, { pageId: user.pageId }, typeId, {
    title: "In the menu",
    slug: "menu-post",
  });
  expect((await page.goto(`http://${host}/blog/menu-post`))?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("In the menu");
  await expect(page.locator('nav.pg-menu a[href="/blog"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('nav.pg-menu a[aria-current="page"]')).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  // Blog off (the Posts screen's own control): the link is gone and /blog is the 404.
  await page.goto(POSTS_URL);
  const settings = page.getByTestId("blog-settings");
  await settings.getByTestId("blog-off").click();
  await settings.getByTestId("blog-off-confirm").click();
  await expect(page.getByTestId(POSTS_TEST_IDS.screen)).toHaveAttribute("data-blog", "off");
  await liveHome(host, (body) => !body.includes('href="/blog"'));
  expect((await rawRequest(host, "/blog")).status).toBe(404);

  // Nothing was deleted: the stored menu still names the type, so the link returns with the blog.
  await page.getByTestId("posts-add-blog").click();
  await expect(page.getByTestId(POSTS_TEST_IDS.screen)).toHaveAttribute("data-blog", "on");
  await liveHome(host, (body) => MENU_LINK.test(body));
  expect((await rawRequest(host, "/blog")).status).toBe(200);
});

test("M16-08 renaming the archive path changes the live Home's menu link on the next request", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "mr", { plan: "pro" });
  await seedEntries(user.pageId);
  const host = `${user.handle}.localhost:3000`;

  await openEditor(page);
  await page.getByTestId(PAGES_BLOG_TEST_IDS.addBlog).click();
  await page.getByTestId("pages-blog-menu").click();
  await expect(page.getByTestId("pages-blog-menu-state")).toHaveText("In menu");
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  await liveHome(host, (body) => MENU_LINK.test(body));
  expect((await rawRequest(host, "/blog")).status).toBe(200);

  // The archive path is renamed through the real route; the menu item (stored by type id) follows.
  const owner = { cookie: cookieHeader(await authCookies(context)), close: async () => {} };
  await expireBlog(owner, user.pageId, "journal");
  const home = await liveHome(host, (body) => body.includes('href="/journal"'));
  expect(home).not.toContain('href="/blog"');
  expect((await rawRequest(host, "/journal")).status).toBe(200);
  expect((await rawRequest(host, "/blog")).status).toBe(404);

  await page.goto(`http://${host}/`);
  const link = page.locator('nav.pg-menu a[href="/journal"]');
  await expect(link).toHaveText("Posts");
  await link.click();
  await expect(page).toHaveURL(`http://${host}/journal`);
  await expect(page.locator(".hl-archive")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
