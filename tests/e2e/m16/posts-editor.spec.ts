import { expect, test } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { ingestPage } from "../m4/analytics-ingest-helpers";
import { makePng } from "../m2/publish-helpers";
import {
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
 * M16-13: the post editor's fields, the Markdown body, autosave and the conflict notice. Runs at
 * phone 390x844 and desktop 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

test("M16-13 write a post with every field, reload, everything is still there", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pe");
  const id = await seedPost(user.pageId, { title: "", slug: "", body: "" });
  await openPost(page, id);
  const editor = page.getByTestId("post-editor");

  await page.getByTestId(POST_TEST_IDS.title).fill("My first post");
  // The slug follows the title until it is edited.
  await expect(page.getByTestId(POST_TEST_IDS.slug)).toHaveValue("my-first-post");

  const body = page.getByTestId(POST_TEST_IDS.body);
  await body.click();
  await page.keyboard.type("Hello from the body.");
  await page.keyboard.press("Enter");
  await page.locator('[data-tool="h2"]').click();
  await page.keyboard.type("A heading");
  await page.keyboard.press("Enter");
  await page.locator('[data-tool="bullets"]').click();
  await page.keyboard.type("first point");
  await expect(body.locator("h2")).toHaveText("A heading");
  await expect(body.locator("li")).toHaveText("first point");

  // An image of the owner's uploads, from the toolbar.
  await page.locator('[data-tool="image"]').click();
  const panel = page.locator('[data-body-panel="image"]');
  await panel.locator('[data-field="post-image-alt"]').fill("A red square");
  await panel
    .locator('input[type="file"]')
    .setInputFiles({ name: "square.png", mimeType: "image/png", buffer: makePng(300, 200) });
  await expect(body.locator("img[data-body-image]")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId(POST_TEST_IDS.excerpt).fill("A short summary.");
  await page
    .getByTestId(POST_TEST_IDS.featuredImage)
    .locator('input[type="file"]')
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: makePng(400, 200) });
  await expect
    .poll(async () => (await postRow(id)).draft.featuredImage?.path ?? null, { timeout: 30_000 })
    .not.toBeNull();

  await page
    .getByTestId(POST_TEST_IDS.categories)
    .locator('[data-field="new-category"]')
    .fill("Notes");
  await page.getByTestId("add-category").click();
  await expect(page.getByTestId(POST_TEST_IDS.categories).getByLabel("Notes")).toBeChecked();
  await page.getByTestId(POST_TEST_IDS.tags).locator('[data-field="new-tag"]').fill("first");
  await page.getByTestId("add-tag").click();
  await expect(page.getByTestId(POST_TEST_IDS.tags).getByLabel("first")).toBeChecked();

  await page.getByTestId(POST_TEST_IDS.seoTitle).fill("Search title");
  await page.getByTestId(POST_TEST_IDS.seoDescription).fill("Search description.");
  await page.getByTestId(POST_TEST_IDS.noindex).click();
  await expect(page.getByTestId(POST_TEST_IDS.noindex)).toHaveAttribute("aria-pressed", "true");

  await expectSaved(page);
  const stored = (await postRow(id)).draft;
  expect(stored).toMatchObject({
    title: "My first post",
    slug: "my-first-post",
    excerpt: "A short summary.",
    seo: { title: "Search title", description: "Search description.", noindex: true },
  });
  // The body is Markdown; the image is the stored Storage address of the owner's upload.
  expect(stored.body).toContain("Hello from the body.");
  expect(stored.body).toContain("## A heading");
  expect(stored.body).toContain("- first point");
  expect(stored.body).toMatch(
    new RegExp(`!\\[A red square\\]\\(\\S+/storage/v1/object/public/page-media/${user.id}/\\S+\\)`),
  );
  expect(stored.terms?.categories).toHaveLength(1);
  expect(stored.terms?.tags).toHaveLength(1);

  await expectTargets44(editor);
  await expectNoHorizontalScroll(page);

  await page.reload();
  await waitForPostEditor(page);
  await expect(page.getByTestId(POST_TEST_IDS.title)).toHaveValue("My first post");
  await expect(page.getByTestId(POST_TEST_IDS.slug)).toHaveValue("my-first-post");
  await expect(page.getByTestId(POST_TEST_IDS.body).locator("h2")).toHaveText("A heading");
  await expect(page.getByTestId(POST_TEST_IDS.body).locator("img[data-body-image]")).toBeVisible();
  await expect(page.getByTestId(POST_TEST_IDS.excerpt)).toHaveValue("A short summary.");
  await expect(page.getByTestId(POST_TEST_IDS.featuredImage).locator("img")).toBeVisible();
  await expect(page.getByTestId(POST_TEST_IDS.categories).getByLabel("Notes")).toBeChecked();
  await expect(page.getByTestId(POST_TEST_IDS.tags).getByLabel("first")).toBeChecked();
  await expect(page.getByTestId(POST_TEST_IDS.seoTitle)).toHaveValue("Search title");
  await expect(page.getByTestId(POST_TEST_IDS.seoDescription)).toHaveValue("Search description.");
  await expect(page.getByTestId(POST_TEST_IDS.noindex)).toHaveAttribute("aria-pressed", "true");
  // Opening the post wrote nothing.
  const before = await postRow(id);
  await page.waitForTimeout(2500);
  expect((await postRow(id)).rev).toBe(before.rev);
  await expectNoHorizontalScroll(page);
});

test("M16-13 a body the rich editor cannot hold opens as plain Markdown and is saved as typed", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "ps");
  const table = "| a | b |\n| - | - |\n| 1 | 2 |\n\n<div>raw</div>";
  const id = await seedPost(user.pageId, { title: "Table", slug: "table", body: table });
  await openPost(page, id);
  const source = page.getByTestId(POST_TEST_IDS.bodySource);
  await expect(source).toHaveValue(table);
  await expect(page.getByTestId(POST_TEST_IDS.body)).toHaveCount(0);
  const before = await postRow(id);
  await source.fill(`${table}\n\n| x |`);
  await expectSaved(page);
  const after = await postRow(id);
  expect(after.draft.body).toBe(`${table}\n\n| x |`);
  expect(after.rev).toBe(before.rev + 1);
  await expectNoHorizontalScroll(page);
});

test("M16-13 a direct database edit of the entry shows the conflict notice and nothing is overwritten", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "px");
  const id = await seedPost(user.pageId, { title: "Mine", slug: "mine", body: "Start." });
  await openPost(page, id);
  await page.getByTestId(POST_TEST_IDS.title).fill("Mine, edited");
  await expectSaved(page);

  const current = await postRow(id);
  const moved = await adminClient()
    .from("content_entries")
    .update({
      draft: { ...current.draft, excerpt: "From elsewhere" } as never,
      rev: current.rev + 1,
    })
    .eq("id", id);
  expect(moved.error).toBeNull();

  await page.getByTestId(POST_TEST_IDS.title).fill("Mine, edited again");
  const notice = page.getByTestId(POST_TEST_IDS.conflict);
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText("changed somewhere else");
  const after = await postRow(id);
  expect(after.draft.excerpt).toBe("From elsewhere");
  expect(after.draft.title).toBe("Mine, edited");
  await expect(page.getByTestId(POST_TEST_IDS.publish)).toBeDisabled();
  await expectNoHorizontalScroll(page);

  await notice.getByRole("button", { name: "Reload" }).click();
  await waitForPostEditor(page);
  await expect(page.getByTestId(POST_TEST_IDS.conflict)).toHaveCount(0);
  await expect(page.getByTestId(POST_TEST_IDS.excerpt)).toHaveValue("From elsewhere");
  await page.getByTestId(POST_TEST_IDS.title).fill("After reload");
  await expectSaved(page);
  expect((await postRow(id)).draft).toMatchObject({
    title: "After reload",
    excerpt: "From elsewhere",
  });
});

test("M16-13 a line typed like Markdown syntax is saved escaped and reopens in the rich editor", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "px");
  const id = await seedPost(user.pageId, { title: "Escapes", slug: "escapes", body: "" });
  await openPost(page, id);
  const body = page.getByTestId(POST_TEST_IDS.body);
  await body.click();
  // "# " makes no heading here (the body has levels 2 to 4), so this is a paragraph of text.
  await page.keyboard.type("# not a heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Plain after.");
  await expectSaved(page);
  expect((await postRow(id)).draft.body).toBe("\\# not a heading\n\nPlain after.");

  await page.reload();
  await waitForPostEditor(page);
  await expect(page.getByTestId(POST_TEST_IDS.bodySource)).toHaveCount(0);
  await expect(page.getByTestId(POST_TEST_IDS.body).locator("p").first()).toHaveText(
    "# not a heading",
  );
  await expect(page.getByTestId(POST_TEST_IDS.body).locator("h1, h2")).toHaveCount(0);
});

test("M16-13 a video URL typed in the rich editor is stored as typed, plays live as an embed and reopens rich", async ({
  page,
  context,
}) => {
  const VIDEO = "https://www.youtube.com/watch?v=a_bcdEFG_12";
  // A published site (the live post needs one), signed in.
  const user = await ingestPage("pu", { plan: "pro" });
  await signInAs(context, user.email);
  await enableBlog(user.pageId);
  const id = await seedPost(user.pageId, { title: "Watch", slug: "watch", body: "" });
  await openPost(page, id);
  await page.getByTestId(POST_TEST_IDS.body).click();
  await page.keyboard.type(VIDEO);
  await expectSaved(page);
  // No backslashes before the underscores.
  expect((await postRow(id)).draft.body).toBe(VIDEO);

  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(page.getByTestId("post-bar").locator("[data-post-state]")).toHaveAttribute(
    "data-post-state",
    "live",
  );
  const live = await page.context().newPage();
  const response = await live.goto(`${user.origin}/blog/watch`);
  expect(response?.status()).toBe(200);
  await expect(live.locator("article .pg-embed[data-embed-provider='youtube']")).toHaveCount(1);
  await expect(live.locator("article")).not.toContainText("\\_");
  await live.close();

  await page.reload();
  await waitForPostEditor(page);
  await expect(page.getByTestId(POST_TEST_IDS.bodySource)).toHaveCount(0);
  await expect(page.getByTestId(POST_TEST_IDS.body)).toContainText(VIDEO);
});

test("M16-13 the link tool takes http and https only; a body over 512 KiB is refused on screen before any request", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pq");
  const id = await seedPost(user.pageId, { title: "Links", slug: "links", body: "" });
  await openPost(page, id);
  const body = page.getByTestId(POST_TEST_IDS.body);
  await body.click();
  await page.keyboard.type("Read this");
  await page.keyboard.press("Shift+Home");
  await page.locator('[data-tool="link"]').click();
  const href = page.locator('[data-field="post-link-href"]');
  for (const bad of [
    "javascript:alert(1)",
    "ftp://files.example/x",
    "mailto:a@b.example",
    "example.com",
  ]) {
    await href.fill(bad);
    await page.getByRole("button", { name: "Apply link" }).click();
    await expect(
      page.getByText("Use a full address that starts with https:// or http://."),
    ).toBeVisible();
    await expect(body.locator("a")).toHaveCount(0);
  }
  await href.fill("https://ok.example/page");
  await page.getByRole("button", { name: "Apply link" }).click();
  await expect(body.locator("a")).toHaveAttribute("href", "https://ok.example/page");
  await expectSaved(page);
  expect((await postRow(id)).draft.body).toBe("[Read this](https://ok.example/page)");

  // Over 512 KiB: the size shows in red, the field says why, and no save request leaves the page.
  const saves: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(`/entries/${id}/draft`))
      saves.push(request.url());
  });
  const before = (await postRow(id)).rev;
  await body.click();
  await page.keyboard.press("End");
  await page.evaluate(
    async (text) => {
      // A paste of 513 KiB of text, as a person would make it.
      const target = document.querySelector("[data-testid='post-body']") as HTMLElement;
      const data = new DataTransfer();
      data.setData("text/plain", text);
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    "x".repeat(513 * 1024),
  );
  await expect(page.getByTestId("post-body-size")).toHaveClass(/text-bad/);
  await expect(
    page.getByText("The body is over 512 KiB, so it isn’t being saved. Shorten it."),
  ).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(saves).toEqual([]);
  expect((await postRow(id)).rev).toBe(before);
});
