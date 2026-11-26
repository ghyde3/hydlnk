import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, signIn } from "../fixtures/data";
import { POST_TEST_IDS, blogUser, openPost, seedPost } from "./posts-helpers";

/**
 * M16-16 step 1: Preview on a post makes a private share link only when the site has none. A second
 * Preview from a browser that remembers nothing (a fresh context) adds no link row; it says where
 * the existing link is. Runs at phone 390x844 and desktop 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

async function linkRows(pageId: string) {
  const found = await adminClient()
    .from("preview_links")
    .select("id")
    .eq("page_id", pageId)
    .is("revoked_at", null);
  if (found.error) throw new Error(found.error.message);
  return found.data.length;
}

test("M16-16 Preview makes a link when the site has none, and never another from a fresh browser", async ({
  page,
  context,
  browser,
}) => {
  const user = await blogUser(context, "pl");
  const id = await seedPost(user.pageId, {
    title: "Preview once",
    slug: "preview-once",
    body: "Hi.",
  });
  expect(await linkRows(user.pageId)).toBe(0);

  await openPost(page, id);
  const opened = page.waitForEvent("popup");
  await page.getByTestId(POST_TEST_IDS.preview).click();
  const popup = await opened;
  await popup.waitForURL(new RegExp(`/share/[^/]+/entry/${id}$`));
  await expect(popup.getByRole("heading", { level: 1, name: "Preview once" })).toBeVisible();
  expect(await linkRows(user.pageId)).toBe(1);

  // The same tab again reuses its remembered address.
  const again = page.waitForEvent("popup");
  await page.getByTestId(POST_TEST_IDS.preview).click();
  await (await again).waitForURL(new RegExp(`/share/[^/]+/entry/${id}$`));
  expect(await linkRows(user.pageId)).toBe(1);

  // A fresh browser (no sessionStorage) cannot recover the address: no new link, a pointer instead.
  for (let round = 0; round < 2; round += 1) {
    const fresh = await browser.newContext(
      test.info().project.use.viewport ? { viewport: test.info().project.use.viewport } : {},
    );
    try {
      await signIn(fresh, user.email);
      const tab = await fresh.newPage();
      await openPost(tab, id);
      await tab.getByTestId(POST_TEST_IDS.preview).click();
      await expect(tab.getByTestId("post-notice")).toContainText("Share tab");
      expect(await linkRows(user.pageId)).toBe(1);
    } finally {
      await fresh.close();
    }
  }
});
