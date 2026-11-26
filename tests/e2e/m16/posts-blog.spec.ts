import { expect, test } from "@playwright/test";
import { PAGES_BLOG_TEST_IDS } from "@/lib/blog/test-ids";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, openEditor } from "../m2/editor-helpers";
import { POSTS_TEST_IDS, POSTS_URL, blogUser, expectTargets44 } from "./posts-helpers";

/**
 * M16-02: "Add blog" in the Pages panel turns the site's blog on; the Blog row opens the empty Posts
 * screen. Runs at phone 390x844 and desktop 1440x900.
 */

const TAKEN_MESSAGE =
  "That address is already used by a page of this site, or reserved. Choose another.";

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M16-02 add the blog from the Pages panel, see the Blog row and the empty Posts screen", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "pb");
  await openEditor(page);

  const add = page.getByTestId(PAGES_BLOG_TEST_IDS.addBlog);
  await expect(add).toBeVisible();
  await expect(page.getByTestId(PAGES_BLOG_TEST_IDS.blogRow)).toHaveCount(0);
  await add.click();

  const row = page.getByTestId(PAGES_BLOG_TEST_IDS.blogRow);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Blog");
  await expect(row).toContainText("/blog");
  const type = await adminClient()
    .from("content_types")
    .select("id, enabled, archive_path")
    .eq("site_id", user.pageId)
    .eq("key", "post")
    .single();
  expect(type.data).toMatchObject({ enabled: true, archive_path: "blog" });

  // The offer to put Blog in the menu: the item is the Post type's id, in the draft menu.
  const offer = page.getByTestId("pages-blog-menu");
  await expect(offer).toBeVisible();
  await expectTargets44(page.getByTestId("pages-blog"));
  await offer.click();
  await expect(page.getByTestId("pages-blog-menu-state")).toHaveText("In menu");
  await expect(offer).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await row.click();
  await expect(page).toHaveURL(POSTS_URL);
  const screen = page.getByTestId(POSTS_TEST_IDS.screen);
  await expect(screen).toHaveAttribute("data-blog", "on");
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  await expect(page.getByTestId("posts-empty")).toContainText("No posts yet");
  await expect(page.getByTestId("posts-usage")).toHaveText("0 of 25 posts");
  await expect(page.getByTestId(POSTS_TEST_IDS.newPost)).toBeVisible();
  await expectTargets44(screen);
  await expectNoHorizontalScroll(page);
});

test("M16-02 a site whose page already uses /blog is told so and can choose another address", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "pc");
  const admin = adminClient();
  const pageType = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", user.pageId)
    .eq("key", "page")
    .single();
  const taken = await admin.from("content_entries").insert({
    site_id: user.pageId,
    type_id: pageType.data!.id,
    draft: { path: "blog", title: "Blog page", description: "", blocks: [] } as never,
  });
  expect(taken.error).toBeNull();

  await page.goto(POSTS_URL);
  const screen = page.getByTestId(POSTS_TEST_IDS.screen);
  await expect(screen).toHaveAttribute("data-blog", "off");
  await page.getByTestId("posts-add-blog").click();
  const address = page.getByTestId("blog-address");
  await expect(address).toBeVisible();
  await expect(screen).toContainText("already used by a page");
  await address.fill("journal");
  await page.getByTestId("posts-add-blog").click();
  await expect(screen).toHaveAttribute("data-blog", "on");
  const type = await admin
    .from("content_types")
    .select("enabled, archive_path")
    .eq("site_id", user.pageId)
    .eq("key", "post")
    .single();
  expect(type.data).toEqual({ enabled: true, archive_path: "journal" });

  // The address can be changed; a page's path is refused; turning the blog off deletes nothing.
  const settings = page.getByTestId("blog-settings");
  await settings.getByTestId("blog-address").fill("blog");
  await settings.getByTestId("blog-address-save").click();
  await expect(settings).toContainText("already used by a page");
  await settings.getByTestId("blog-address").fill("notes");
  await settings.getByTestId("blog-address-save").click();
  await expect(settings).toContainText("Saved.");
  await expectTargets44(settings);
  await settings.getByTestId("blog-off").click();
  await settings.getByTestId("blog-off-confirm").click();
  await expect(page.getByTestId(POSTS_TEST_IDS.screen)).toHaveAttribute("data-blog", "off");
  const off = await admin
    .from("content_types")
    .select("enabled, archive_path")
    .eq("site_id", user.pageId)
    .eq("key", "post")
    .single();
  expect(off.data).toEqual({ enabled: false, archive_path: "notes" });
  await expectNoHorizontalScroll(page);
});

test("M16-02 'Add blog' in the Pages panel says when /blog is a page's address, and takes another", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "pt");
  const admin = adminClient();
  const pageType = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", user.pageId)
    .eq("key", "page")
    .single();
  const taken = await admin.from("content_entries").insert({
    site_id: user.pageId,
    type_id: pageType.data!.id,
    draft: { path: "blog", title: "Blog page", description: "", blocks: [] } as never,
  });
  expect(taken.error).toBeNull();

  await openEditor(page);
  await page.getByTestId(PAGES_BLOG_TEST_IDS.addBlog).click();
  const panel = page.getByTestId("pages-blog");
  await expect(panel.getByText(TAKEN_MESSAGE)).toBeVisible();
  // The blog stayed off, and the address field is there, filled with the refused address.
  const address = panel.locator('[data-field="blog-address"]');
  await expect(address).toHaveValue("blog");
  await expect(page.getByTestId(PAGES_BLOG_TEST_IDS.blogRow)).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await address.fill("journal");
  await page.getByTestId(PAGES_BLOG_TEST_IDS.addBlog).click();
  await expect(page.getByTestId(PAGES_BLOG_TEST_IDS.blogRow)).toContainText("/journal");
  const type = await admin
    .from("content_types")
    .select("enabled, archive_path")
    .eq("site_id", user.pageId)
    .eq("key", "post")
    .single();
  expect(type.data).toEqual({ enabled: true, archive_path: "journal" });
});

test("M16-02 with the blog on, the Pages panel does not move when the types arrive", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pbs");
  // Hold `GET types` until the panel has been measured, so the drawing before the answer is seen.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/pages/${user.pageId}/types`, async (route) => {
    await held;
    await route.continue();
  });
  await openEditor(page);
  const onPage = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x: x + scrollX, y: y + scrollY, width, height };
    });
  // Before the answer: the Blog row is already there (from the layout's read), with no count yet.
  await expect(page.getByTestId(PAGES_BLOG_TEST_IDS.blogRow)).toBeVisible();
  await expect(page.getByTestId("pages-blog-count")).toHaveCount(0);
  const before = [await onPage("pages-card"), await onPage("profile-card")];
  release();
  await expect(page.getByTestId("pages-blog-count")).toHaveText("0 posts");
  const after = [await onPage("pages-card"), await onPage("profile-card")];
  expect(after).toEqual(before);
});
