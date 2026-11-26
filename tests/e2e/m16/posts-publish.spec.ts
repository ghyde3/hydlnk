import { expect, test } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { ingestPage } from "../m4/analytics-ingest-helpers";
import {
  POSTS_TEST_IDS,
  POSTS_URL,
  POST_TEST_IDS,
  blogUser,
  enableBlog,
  expectSaved,
  expectTargets44,
  openPost,
  postRow,
  seedPost,
  waitForPostEditor,
} from "./posts-helpers";

/**
 * M16-15: publish, unpublish, revisions, trash and restore for one post. Runs at phone 390x844 and
 * desktop 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const chip = (page: import("@playwright/test").Page) =>
  page.getByTestId("post-bar").locator("[data-post-state]");

test("M16-15 publish, edit, publish again, restore the first revision, trash, restore", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pp");
  const id = await seedPost(user.pageId, { title: "First words", slug: "first", body: "One." });
  const other = await seedPost(user.pageId, { title: "Other", slug: "other", body: "Two." });
  await openPost(page, id);
  await expect(chip(page)).toHaveAttribute("data-post-state", "draft");

  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");
  await expect(chip(page)).toHaveText("Live");
  expect((await postRow(id)).published).toMatchObject({ title: "First words" });
  // Only this post went live.
  expect((await postRow(other)).published).toBeNull();
  await expect(page.getByTestId(POST_TEST_IDS.unpublish)).toBeVisible();

  await page.getByTestId(POST_TEST_IDS.title).fill("Second words");
  await expect(chip(page)).toHaveAttribute("data-post-state", "changes");
  await expect(chip(page)).toHaveText("Unpublished changes");
  await expectSaved(page);
  // The live copy is untouched until Publish.
  expect((await postRow(id)).published).toMatchObject({ title: "First words" });

  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");
  expect((await postRow(id)).published).toMatchObject({ title: "Second words" });
  await expectTargets44(page.getByTestId("post-editor"));
  await expectNoHorizontalScroll(page);

  // Revisions: restore the first one into the draft. It goes live only on Publish.
  await page.getByTestId(POST_TEST_IDS.revisions).click();
  const revisions = page.getByTestId("post-revision-list").locator("li");
  await expect(revisions).toHaveCount(2);
  await expect(revisions.first()).toContainText("Published");
  await revisions.last().getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId(POST_TEST_IDS.title)).toHaveValue("First words");
  await expect(chip(page)).toHaveAttribute("data-post-state", "changes");
  const restored = await postRow(id);
  expect(restored.draft.title).toBe("First words");
  expect(restored.published).toMatchObject({ title: "Second words" });
  // Saving goes on at the new rev.
  await page.getByTestId(POST_TEST_IDS.excerpt).fill("After the restore.");
  await expectSaved(page);
  expect((await postRow(id)).draft.excerpt).toBe("After the restore.");

  // Unpublish keeps the draft.
  await page.getByTestId(POST_TEST_IDS.unpublish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "draft");
  const down = await postRow(id);
  expect(down.published).toBeNull();
  expect(down.draft.title).toBe("First words");

  // Trash, then find it under the Trashed filter, then restore it as a draft.
  await page.getByTestId(POST_TEST_IDS.trash).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "trashed");
  await expect(page.getByTestId("post-trashed")).toContainText("counts toward your posts");
  expect((await postRow(id)).deleted_at).not.toBeNull();
  await expect(page.getByTestId(POST_TEST_IDS.title)).toBeDisabled();

  await page.goto(POSTS_URL);
  await expect(page.getByTestId(POSTS_TEST_IDS.row)).toHaveCount(1);
  await page.getByTestId(POSTS_TEST_IDS.filterStatus).selectOption("trashed");
  const row = page.getByTestId(POSTS_TEST_IDS.row);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-post-id", id);
  await row.click();
  await waitForPostEditor(page);
  await page.getByTestId(POST_TEST_IDS.restore).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "draft");
  const back = await postRow(id);
  expect(back.deleted_at).toBeNull();
  expect(back.published).toBeNull();
  await expect(page.getByTestId(POST_TEST_IDS.title)).toBeEnabled();
  await expectNoHorizontalScroll(page);
});

test("M16-15 Publish lists what to fix by field, with a link to the field", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pi");
  const taken = await seedPost(user.pageId, { title: "Taken", slug: "same", body: "x" });
  const id = await seedPost(user.pageId, { title: "", slug: "", body: "Text." });
  await openPost(page, taken);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");

  await openPost(page, id);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  const issues = page.getByTestId("post-issues");
  await expect(issues).toBeVisible();
  await expect(issues.locator('[data-issue-field="title"] a')).toHaveAttribute(
    "href",
    "#post-field-title",
  );
  await expect(issues.locator('[data-issue-field="slug"]')).toHaveCount(1);
  expect((await postRow(id)).published).toBeNull();
  await expectTargets44(issues);

  // A slug another live post uses comes back as the slug field's message.
  await page.getByTestId(POST_TEST_IDS.title).fill("Second");
  await page.getByTestId(POST_TEST_IDS.slug).fill("same");
  await expectSaved(page);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(page.getByTestId("post-issues").locator('[data-issue-field="slug"]')).toBeVisible();
  expect((await postRow(id)).published).toBeNull();
  await expect(chip(page)).toHaveAttribute("data-post-state", "draft");

  await page.getByTestId(POST_TEST_IDS.slug).fill("second");
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");
  expect((await postRow(id)).published).toMatchObject({ slug: "second" });
  await expectNoHorizontalScroll(page);
});

test("M16-15 M16-16 Preview opens the post's private share address, which draws the draft", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pv");
  const id = await seedPost(user.pageId, {
    title: "Preview me",
    slug: "preview-me",
    body: "## A draft heading\n\nOnly the draft says *this*.",
  });
  await openPost(page, id);
  const opened = page.waitForEvent("popup");
  await page.getByTestId(POST_TEST_IDS.preview).click();
  const link = page.getByTestId("post-preview-link");
  await expect(link).toHaveAttribute("href", new RegExp(`/share/[^/]+/entry/${id}$`));
  const popup = await opened;
  await popup.waitForURL(new RegExp(`/share/[^/]+/entry/${id}$`));

  // The page behind the address (M16-16) really draws this never-published draft: its title as the
  // one <h1>, its body, and the share rules (not indexed, never stored).
  expect((await postRow(id)).published).toBeNull();
  await expect(popup.getByRole("heading", { level: 1, name: "Preview me" })).toBeVisible();
  await expect(popup.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(popup.getByRole("heading", { name: "A draft heading" })).toBeVisible();
  await expect(popup.locator(".hl-post-body")).toContainText("Only the draft says this.");
  await expect(popup.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const response = await popup.reload();
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  // `next dev` rewrites a page's Cache-Control to "no-cache, must-revalidate"; the production build
  // (CI) answers the proxy's "no-store". Either way nothing is stored (as in m6/pages-preview).
  expect(headers["cache-control"]).toMatch(/no-store|no-cache/);
  expect(headers["cache-control"]).not.toMatch(/public|s-maxage/);
  expect(headers["x-robots-tag"]).toContain("noindex");
  await expect(popup.getByRole("heading", { level: 1, name: "Preview me" })).toBeVisible();
  await expectNoHorizontalScroll(popup);
});

test("M16-15 a post opened with unpublished changes reads Live again once edited back to the live copy", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pk");
  const id = await seedPost(user.pageId, { title: "Live words", slug: "live", body: "One." });
  await openPost(page, id);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");
  await page.getByTestId(POST_TEST_IDS.title).fill("Changed words");
  await expectSaved(page);
  await expect(chip(page)).toHaveAttribute("data-post-state", "changes");

  // Opened fresh, with the change still unpublished.
  await page.reload();
  await waitForPostEditor(page);
  await expect(chip(page)).toHaveAttribute("data-post-state", "changes");
  // Back to exactly what is live: the chip says Live without a publish.
  await page.getByTestId(POST_TEST_IDS.title).fill("Live words");
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");
  await expect(chip(page)).toHaveText("Live");
  await expectSaved(page);
  await page.getByTestId(POST_TEST_IDS.title).fill("Live words again");
  await expect(chip(page)).toHaveAttribute("data-post-state", "changes");
});

test("M16-15 publishing a post changes no page and no design; trashing it live takes the public URL away at once", async ({
  page,
  context,
}) => {
  const site = await ingestPage("pz", { plan: "pro" });
  await signInAs(context, site.email);
  await enableBlog(site.pageId);
  const pagesBefore = await adminClient()
    .from("content_entries")
    .select("id, rev, published, published_at")
    .eq("site_id", site.pageId)
    .order("id");
  const designBefore = await adminClient()
    .from("pages")
    .select("published, published_at")
    .eq("id", site.pageId)
    .single();
  const homeBefore = (await page.request.get(site.url)).status();

  const id = await seedPost(site.pageId, { title: "Going live", slug: "going-live", body: "Hi." });
  await openPost(page, id);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");

  // Only the post changed: every other entry of the site (Home, its pages) and the design are as they were.
  const pagesAfter = await adminClient()
    .from("content_entries")
    .select("id, rev, published, published_at")
    .eq("site_id", site.pageId)
    .neq("id", id)
    .order("id");
  expect(pagesAfter.data).toEqual(pagesBefore.data);
  const designAfter = await adminClient()
    .from("pages")
    .select("published, published_at")
    .eq("id", site.pageId)
    .single();
  expect(designAfter.data).toEqual(designBefore.data);
  expect((await page.request.get(site.url)).status()).toBe(homeBefore);

  const live = await context.newPage();
  expect((await live.goto(`${site.origin}/blog/going-live`))?.status()).toBe(200);
  await expect(live.locator("h1")).toHaveText("Going live");

  // Trash the LIVE post: the very next request is the 404, and the archive no longer lists it.
  await page.getByTestId(POST_TEST_IDS.trash).click();
  await expect(page.getByTestId("post-trashed")).toBeVisible();
  const gone = await live.goto(`${site.origin}/blog/going-live`);
  expect(gone?.status()).toBe(404);
  expect(await gone?.text()).not.toContain("Going live");
  await live.goto(`${site.origin}/blog`);
  await expect(live.locator(".hl-archive")).not.toContainText("Going live");
  await live.close();
});

test("M16-15 unpublishing a post changes no other post, no page and no design", async ({
  page,
  context,
}) => {
  const site = await ingestPage("pu", { plan: "pro" });
  await signInAs(context, site.email);
  await enableBlog(site.pageId);
  const other = await seedPost(site.pageId, { title: "Stays live", slug: "stays", body: "Hi." });
  const id = await seedPost(site.pageId, { title: "Goes away", slug: "goes", body: "Bye." });
  await openPost(page, other);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");
  await openPost(page, id);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "live");

  const everythingElse = async () =>
    adminClient()
      .from("content_entries")
      .select("id, rev, draft, published, published_at, first_published_at, deleted_at")
      .eq("site_id", site.pageId)
      .neq("id", id)
      .order("id");
  const design = async () =>
    adminClient()
      .from("pages")
      .select("published, published_at, draft")
      .eq("id", site.pageId)
      .single();
  const entriesBefore = await everythingElse();
  const designBefore = await design();
  const homeBefore = (await page.request.get(site.url)).status();
  const live = await context.newPage();
  expect((await live.goto(`${site.origin}/blog/goes`))?.status()).toBe(200);

  await page.getByTestId(POST_TEST_IDS.unpublish).click();
  await expect(chip(page)).toHaveAttribute("data-post-state", "draft");
  expect((await postRow(id)).published).toBeNull();

  // Only this post changed: every other post and page entry, and the design, are as they were.
  const entriesAfter = await everythingElse();
  expect(entriesAfter.data).toEqual(entriesBefore.data);
  expect((await design()).data).toEqual(designBefore.data);
  expect((await page.request.get(site.url)).status()).toBe(homeBefore);
  // The other post is still live, this one is gone from its address and the archive at once.
  expect((await live.goto(`${site.origin}/blog/stays`))?.status()).toBe(200);
  expect((await live.goto(`${site.origin}/blog/goes`))?.status()).toBe(404);
  await live.goto(`${site.origin}/blog`);
  await expect(live.locator(".hl-archive")).toContainText("Stays live");
  await expect(live.locator(".hl-archive")).not.toContainText("Goes away");
  await live.close();
});
