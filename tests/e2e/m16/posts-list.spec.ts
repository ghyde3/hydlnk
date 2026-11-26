import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import {
  POSTS_TEST_IDS,
  POSTS_URL,
  blogUser,
  expectTargets44,
  postRow,
  postsOf,
  seedPost,
  waitForPostEditor,
} from "./posts-helpers";

/**
 * M16-12: the Posts screen lists the site's posts with their state, filters them, and "New post"
 * opens a new draft. At the plan's limit the button gives way to the limit notice. Runs at phone
 * 390x844 and desktop 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M16-12 list, filter, search and New post", async ({ page, context }) => {
  const user = await blogUser(context, "pl");
  const draftId = await seedPost(user.pageId, { title: "Quiet draft", slug: "quiet", body: "" });
  const trashedId = await seedPost(user.pageId, { title: "Old news", slug: "old", body: "" });
  await seedPost(user.pageId, { title: "Loud draft", slug: "loud", body: "" });
  const gone = await adminClient()
    .from("content_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", trashedId);
  expect(gone.error).toBeNull();

  await page.goto(POSTS_URL);
  const screen = page.getByTestId(POSTS_TEST_IDS.screen);
  await expect(screen).toHaveAttribute("data-blog", "on");
  const rows = page.getByTestId(POSTS_TEST_IDS.row);
  // The trash is counted in the header and kept out of the list.
  await expect(page.getByTestId("posts-usage")).toHaveText("3 of 25 posts");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Draft");
  await expectTargets44(screen);
  await expectNoHorizontalScroll(page);

  await page.getByTestId(POSTS_TEST_IDS.filterStatus).selectOption("trashed");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Old news");
  await expect(rows.first()).toContainText("Trashed");
  await page.getByTestId(POSTS_TEST_IDS.filterStatus).selectOption("");
  await expect(rows).toHaveCount(2);

  await page.getByTestId(POSTS_TEST_IDS.search).fill("quiet");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-post-id", draftId);
  await page.getByTestId(POSTS_TEST_IDS.search).fill("nothing like this");
  await expect(page.getByTestId("posts-empty")).toContainText("No posts match");
  await page.getByTestId(POSTS_TEST_IDS.search).fill("");
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId(POSTS_TEST_IDS.filterCategory)).toBeVisible();

  await page.getByTestId(POSTS_TEST_IDS.newPost).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);
  await waitForPostEditor(page);
  const made = (await postsOf(user.pageId)).length;
  expect(made).toBe(4);
  const id = page.url().split("/").pop()!;
  expect((await postRow(id)).draft).toMatchObject({ title: "", slug: "", body: "" });
  await expectNoHorizontalScroll(page);
});

test("M16-12 at the plan's posts the button gives way to the limit notice", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pm");
  const rows = Array.from({ length: 25 }, (_, n) => ({
    site_id: user.pageId,
    type_id: user.typeId,
    draft: { title: `Post ${n + 1}`, slug: "", body: "" } as never,
  }));
  const filled = await adminClient().from("content_entries").insert(rows);
  expect(filled.error).toBeNull();

  await page.goto(POSTS_URL);
  await expect(page.getByTestId("posts-usage")).toHaveText("25 of 25 posts");
  const notice = page.getByTestId(POSTS_TEST_IDS.limit);
  await expect(notice).toContainText("Free includes 25 posts");
  await expect(notice.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
    "href",
    "/settings#plans",
  );
  await expect(page.getByTestId(POSTS_TEST_IDS.newPost)).toHaveCount(0);
  // 20 at a time.
  await expect(page.getByTestId(POSTS_TEST_IDS.row)).toHaveCount(20);
  await page.getByTestId("posts-more").click();
  await expect(page.getByTestId(POSTS_TEST_IDS.row)).toHaveCount(25);

  // Whatever the client sends, the server refuses the 26th.
  const refused = await page.evaluate(async (siteId) => {
    const response = await fetch(`/api/pages/${siteId}/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "One more" }),
    });
    return { status: response.status, body: (await response.json()) as { kind: string } };
  }, user.pageId);
  expect(refused.status).toBe(403);
  expect(refused.body.kind).toBe("limit");
  expect((await postsOf(user.pageId)).length).toBe(25);
  await expectNoHorizontalScroll(page);
});
