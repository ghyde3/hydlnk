import { expect, test } from "@playwright/test";
import { cleanupUsers, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { DEV_PORT, expectNoHorizontalScroll, url } from "../helpers";
import { addBlock } from "../m2/blocks-helpers";
import { emptyUser, openEditor, statusChip } from "../m2/editor-helpers";
import { entry, seedHome, subPageEntries } from "./entry-helpers";

/**
 * M15-07 steps 7 and 8, last part: add a page in the editor, press Publish, and the new page is live
 * on the tenant host. The page is made through the editor's own form (the server writer), its block
 * is saved to its page entry by the autosave, and Publish goes through publish_site over entries.
 * Runs at phone 390x844 and desktop 1440x900; each run makes its own user and site.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

test("M15-07 add a page and Publish, and it is live on the tenant host", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const title = `Menu ${mark}`;
  const headline = `Fresh ${mark}`;
  const homeLine = `Welcome ${mark}`;
  const user = await emptyUser(context, "app");
  const homeId = await seedHome(user.pageId);
  const host = `${user.handle}.localhost:${DEV_PORT}`;
  await openEditor(page);

  // Nothing is live yet.
  expect((await rawRequest(host, "/menu")).status).toBe(404);

  // A block on Home, so the site has something to publish.
  const home = await addBlock(page, "header");
  await home.panel.locator('[data-field="text"]').first().fill(homeLine);
  await expect
    .poll(async () => JSON.stringify((await entry(homeId)).draft.blocks))
    .toContain(homeLine);

  // Add a page through the form; it opens, and its block goes to its own entry.
  await page.getByTestId("add-page").click();
  const form = page.getByTestId("add-page-form");
  await form.locator('[data-field="new-page-title"]').fill(title);
  await form.locator('[data-field="new-page-path"]').fill("menu");
  await form.getByTestId("add-page-submit").click();
  const row = page.getByTestId("page-row").filter({ hasText: title });
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect.poll(async () => (await subPageEntries(user.pageId)).length).toBe(1);
  const made = (await subPageEntries(user.pageId))[0]!;
  expect(made.draft).toMatchObject({ path: "menu", title });
  expect(made.published).toBeNull();

  const sub = await addBlock(page, "header");
  await sub.panel.locator('[data-field="text"]').first().fill(headline);
  await expect
    .poll(async () => JSON.stringify((await entry(made.id)).draft.blocks))
    .toContain(headline);
  // Still a draft: the address is not served before Publish.
  expect((await rawRequest(host, "/menu")).status).toBe(404);

  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });

  // The entry is published, and the tenant host serves the new page and links to it from Home.
  await expect
    .poll(async () => (await subPageEntries(user.pageId))[0]!.live_path, { timeout: 20_000 })
    .toBe("menu");
  await expect
    .poll(async () => (await rawRequest(host, "/menu")).status, { timeout: 20_000 })
    .toBe(200);
  const live = await rawRequest(host, "/menu");
  expect(live.body).toContain(headline);
  expect(live.body).toContain(title);
  const liveHome = await rawRequest(host, "/");
  expect(liveHome.status).toBe(200);
  expect(liveHome.body).toContain(homeLine);
  expect(liveHome.body).toContain('href="/menu"');

  // In a browser, from Home's menu.
  const visitor = await context.browser()!.newContext({ viewport: page.viewportSize() });
  try {
    const tab = await visitor.newPage();
    await tab.goto(url(user.handle, "/"));
    await tab.locator("nav.pg-menu").getByRole("link", { name: title, exact: true }).click();
    await tab.waitForURL(url(user.handle, "/menu"));
    await expect(tab.getByText(headline)).toBeVisible();
    await expectNoHorizontalScroll(tab);
  } finally {
    await visitor.close();
  }
});
