import { expect, test } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { ingestPage } from "../m4/analytics-ingest-helpers";
import {
  POST_TEST_IDS,
  blogUser,
  enableBlog,
  expectSaved,
  expectTargets44,
  openPost,
  postRow,
  seedPost,
} from "./posts-helpers";

/**
 * M16-14: categories (one level of nesting) and tags are created, renamed and deleted from the post
 * editor's pickers, and go live with the post. Runs at phone 390x844 and desktop 1440x900. (That
 * they show on the live post and on their archive pages is the public spec's part.)
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M16-14 add a category and two tags to a post, publish, rename and delete", async ({
  page,
  context,
}) => {
  const user = await blogUser(context, "pt");
  const id = await seedPost(user.pageId, { title: "Tagged", slug: "tagged", body: "Words." });
  await openPost(page, id);
  const categories = page.getByTestId(POST_TEST_IDS.categories);
  const tags = page.getByTestId(POST_TEST_IDS.tags);

  await categories.locator('[data-field="new-category"]').fill("Field notes");
  await page.getByTestId("add-category").click();
  await expect(categories.getByLabel("Field notes")).toBeChecked();
  // One level of nesting: a child under the category just made.
  await categories.locator('[data-field="new-category"]').fill("Coast");
  await categories.getByLabel("Inside").selectOption({ label: "Field notes" });
  await page.getByTestId("add-category").click();
  await expect(categories.getByLabel("Coast")).toBeChecked();
  await categories.getByLabel("Coast").uncheck();

  for (const name of ["slow", "travel"]) {
    await tags.locator('[data-field="new-tag"]').fill(name);
    await page.getByTestId("add-tag").click();
    await expect(tags.getByLabel(name, { exact: true })).toBeChecked();
  }
  // The same name again is refused by the server, with its message.
  await tags.locator('[data-field="new-tag"]').fill("slow");
  await page.getByTestId("add-tag").click();
  await expect(page.getByTestId("tag-error")).toContainText("already exists");

  await expectSaved(page);
  const admin = adminClient();
  const terms = await admin
    .from("content_terms")
    .select("id, taxonomy, name, slug, parent_id")
    .eq("site_id", user.pageId);
  const byName = new Map((terms.data ?? []).map((term) => [term.name as string, term]));
  expect(byName.get("Field notes")).toMatchObject({ taxonomy: "category", slug: "field-notes" });
  expect(byName.get("Coast")?.parent_id).toBe(byName.get("Field notes")?.id);
  const draft = (await postRow(id)).draft;
  expect(draft.terms?.categories).toEqual([byName.get("Field notes")?.id]);
  expect([...(draft.terms?.tags ?? [])].sort()).toEqual(
    [byName.get("slow")?.id, byName.get("travel")?.id].sort(),
  );

  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(page.locator("[data-post-state]").first()).toHaveAttribute(
    "data-post-state",
    "live",
  );
  const links = await admin.from("content_entry_terms").select("term_id").eq("entry_id", id);
  expect((links.data ?? []).map((link) => link.term_id).sort()).toEqual(
    [byName.get("Field notes")?.id, byName.get("slow")?.id, byName.get("travel")?.id].sort(),
  );

  // Rename a tag, then delete one: the post keeps its text and the tag leaves its draft.
  await tags.getByRole("button", { name: "Rename or delete" }).click();
  await expectTargets44(tags);
  await tags.getByRole("button", { name: "Rename slow" }).click();
  await tags.getByLabel("New name for slow").fill("slower");
  await tags.getByRole("button", { name: "Save name" }).click();
  await expect(tags.getByLabel("slower", { exact: true })).toBeChecked();
  await tags.getByRole("button", { name: "Delete travel" }).click();
  await tags.getByRole("button", { name: "Delete tag" }).click();
  await expect(tags.getByLabel("travel", { exact: true })).toHaveCount(0);
  await expectSaved(page);
  const after = await postRow(id);
  expect(after.draft.terms?.tags).toEqual([byName.get("slow")?.id]);
  expect(after.draft.body).toBe("Words.");
  const left = await admin.from("content_terms").select("name").eq("site_id", user.pageId);
  expect((left.data ?? []).map((term) => term.name).sort()).toEqual([
    "Coast",
    "Field notes",
    "slower",
  ]);
  await expectTargets44(categories);
  await expectNoHorizontalScroll(page);
});

test("M16-14 a term made, renamed and deleted in the editor shows on, and drops out of, the live post and its archive", async ({
  page,
  context,
}) => {
  // A published site (the live pages need one), signed in.
  const site = await ingestPage("pw", { plan: "pro" });
  await signInAs(context, site.email);
  await enableBlog(site.pageId);
  const id = await seedPost(site.pageId, { title: "Termed", slug: "termed", body: "Words." });
  await openPost(page, id);
  const categories = page.getByTestId(POST_TEST_IDS.categories);
  const tags = page.getByTestId(POST_TEST_IDS.tags);
  await categories.locator('[data-field="new-category"]').fill("Field notes");
  await page.getByTestId("add-category").click();
  await expect(categories.getByLabel("Field notes")).toBeChecked();
  for (const name of ["slow", "travel"]) {
    await tags.locator('[data-field="new-tag"]').fill(name);
    await page.getByTestId("add-tag").click();
    await expect(tags.getByLabel(name, { exact: true })).toBeChecked();
  }
  await expectSaved(page);
  await page.getByTestId(POST_TEST_IDS.publish).click();
  await expect(page.locator("[data-post-state]").first()).toHaveAttribute(
    "data-post-state",
    "live",
  );

  const live = await context.newPage();
  const termsOnPost = () => live.locator(".pg-post-terms .pg-post-term");
  await live.goto(`${site.origin}/blog/termed`);
  await expect(termsOnPost()).toHaveText(["Field notes", "slow", "travel"]);
  for (const [path, heading] of [
    ["/blog/category/field-notes", "Field notes"],
    ["/blog/tag/slow", "slow"],
    ["/blog/tag/travel", "travel"],
  ] as const) {
    expect((await live.goto(`${site.origin}${path}`))?.status(), path).toBe(200);
    await expect(live.locator("h1")).toHaveText(heading);
    await expect(live.locator(".hl-archive-card")).toHaveCount(1);
  }

  // Rename a tag: the live post and its archive show the new name on the next request.
  await tags.getByRole("button", { name: "Rename or delete" }).click();
  await tags.getByRole("button", { name: "Rename slow" }).click();
  await tags.getByLabel("New name for slow").fill("slower");
  await tags.getByRole("button", { name: "Save name" }).click();
  await expect(tags.getByLabel("slower", { exact: true })).toBeChecked();
  await live.goto(`${site.origin}/blog/termed`);
  await expect(termsOnPost()).toHaveText(["Field notes", "slower", "travel"]);
  const renamedHref = await termsOnPost().nth(1).getAttribute("href");
  expect((await live.goto(`${site.origin}${renamedHref}`))?.status()).toBe(200);
  await expect(live.locator("h1")).toHaveText("slower");

  // Delete a tag: it leaves the live post and its archive answers 404.
  await tags.getByRole("button", { name: "Delete travel" }).click();
  await tags.getByRole("button", { name: "Delete tag" }).click();
  await expect(tags.getByLabel("travel", { exact: true })).toHaveCount(0);
  await live.goto(`${site.origin}/blog/termed`);
  await expect(termsOnPost()).toHaveText(["Field notes", "slower"]);
  expect((await live.goto(`${site.origin}/blog/tag/travel`))?.status()).toBe(404);
  await live.close();
  await expectNoHorizontalScroll(page);
});
