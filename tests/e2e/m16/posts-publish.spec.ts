import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import {
  POSTS_TEST_IDS,
  POSTS_URL,
  POST_TEST_IDS,
  blogUser,
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

test("M16-15 Preview opens the post's private share address", async ({ page, context }) => {
  const user = await blogUser(context, "pv");
  const id = await seedPost(user.pageId, { title: "Preview me", slug: "preview-me", body: "Hi." });
  await openPost(page, id);
  const popup = page.waitForEvent("popup");
  await page.getByTestId(POST_TEST_IDS.preview).click();
  const link = page.getByTestId("post-preview-link");
  await expect(link).toHaveAttribute("href", new RegExp(`/share/[^/]+/entry/${id}$`));
  await (await popup).waitForURL(new RegExp(`/share/[^/]+/entry/${id}$`));
});
