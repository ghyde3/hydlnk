import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { DEV_PORT, expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { emptyUser, openEditor, pageRow, statusChip } from "../m2/editor-helpers";
import { expectOverrides } from "../m3/design-helpers";
import { openHistory, rowFor } from "../m6/versions-helpers";
import { editSubPageHeader, entry, seedEntries } from "./entry-helpers";

/**
 * M15-10 steps 7 and 8: every page publishes on its own. Edit two pages and the theme; Publish page
 * on one, and only it changes live; Publish design changes the theme only; Publish all changes
 * publishes the rest; restore a page revision into its draft; no horizontal scroll, with the publish
 * bar open and closed. At 1440x900 also: History restores the design only, and Undo puts it back.
 * Runs at phone 390x844 and desktop 1440x900; each run makes its own user and site.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 240_000 });

const SURFACE = "#A1B2C3";

async function publishedAt(id: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("published_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data.published_at as string | null;
}

const bar = (page: Page) => page.getByTestId("publish-bar");
const toggle = (page: Page) => page.getByTestId("publish-bar-toggle");
const row = (page: Page, key: string) => page.getByTestId(`publish-row-${key}`);

async function openBar(page: Page): Promise<void> {
  if (await bar(page).isVisible()) return;
  await toggle(page).click();
  await expect(bar(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
}

async function closeBar(page: Page): Promise<void> {
  if (!(await bar(page).isVisible())) return;
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();
}

/** The live page's HTML, asked for until `check` holds (the cache tag expires on publish). */
async function liveBody(host: string, path: string, check: (body: string) => boolean) {
  let body = "";
  await expect
    .poll(
      async () => {
        const response = await rawRequest(host, path);
        body = response.body;
        return response.status === 200 && check(body);
      },
      { timeout: 30_000, message: `the live ${path} of ${host}` },
    )
    .toBe(true);
  return body;
}

test("M15-10 Publish page, Publish design, Publish all changes and a page revision", async ({
  page,
  context,
}, testInfo) => {
  const mark = rand(5);
  const label = `Reserve ${mark}`;
  const header = `Fresh ${mark}`;
  const user = await emptyUser(context, "pp", { plan: "pro" });
  const { homeId, subId } = await seedEntries(user.pageId);
  const host = `${user.handle}.localhost:${DEV_PORT}`;
  const toolbar = page.getByTestId("workspace-toolbar");
  const publish = toolbar.getByRole("button", { name: "Publish", exact: true });
  const hasSurface = (body: string) => body.toLowerCase().includes(SURFACE.toLowerCase());

  // 1. Publish everything once. While the bar is closed, the toolbar's is the only Publish button.
  await openEditor(page);
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(1);
  await publish.click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  await liveBody(host, "/", (body) => body.includes("Book"));
  await liveBody(host, "/gallery", (body) => body.includes("Mine"));
  const first = { home: await publishedAt(homeId), sub: await publishedAt(subId) };
  expect(first.home).not.toBeNull();
  expect(first.sub).not.toBeNull();

  // Edit Home's link label, the sub-page's header and a theme color.
  const link = page.locator('li[data-block-id="lnk-aaaaaaaa"]');
  if ((await page.locator('[data-field="label"]').count()) === 0) await link.click();
  await page.locator('[data-field="label"]').first().fill(label);
  await expect
    .poll(async () => JSON.stringify((await entry(homeId)).draft.blocks))
    .toContain(label);
  await editSubPageHeader(page, header);
  await expect
    .poll(async () => JSON.stringify((await entry(subId)).draft.blocks))
    .toContain(header);
  await page.getByRole("tab", { name: "Design", exact: true }).click();
  await page.getByLabel("Cards and panels hex", { exact: true }).fill(SURFACE);
  await expectOverrides(user.pageId, (overrides) => overrides.surface === SURFACE);
  await expect(statusChip(page)).toHaveText("Unpublished changes");

  // 6. No horizontal scroll with the bar closed and open; every button of the bar is a 44px target.
  await expectNoHorizontalScroll(page);
  await openBar(page);
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="publish-bar"] button');
  await expect(bar(page)).toHaveAttribute("role", "dialog");
  await expect(row(page, "design")).toHaveAttribute("data-state", "changed");
  await expect(row(page, "home")).toHaveAttribute("data-state", "changed");
  await expect(row(page, subId)).toHaveAttribute("data-state", "changed");
  await expect(row(page, subId)).toContainText("Unpublished changes");
  await expect(row(page, subId)).toContainText("/gallery");
  await expect(page.getByTestId("publish-bar-count")).toHaveText("3 changes");
  // For design-verifier: the open bar at this viewport (tmp/ is not committed).
  await page.screenshot({ path: `tmp/screens/publish-bar-${testInfo.project.name}.png` });

  // 2. Publish page on the sub-page: only it changes live.
  await row(page, subId).getByRole("button", { name: "Publish page", exact: true }).click();
  await expect(row(page, subId)).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await expect(row(page, subId)).toContainText("Live");
  await expect(row(page, "home")).toHaveAttribute("data-state", "changed");
  await expect(row(page, "design")).toHaveAttribute("data-state", "changed");
  await liveBody(host, "/gallery", (body) => body.includes(header));
  const homeAfterPage = await liveBody(host, "/", (body) => body.includes("Book"));
  expect(homeAfterPage).not.toContain(label);
  expect(hasSurface(homeAfterPage)).toBe(false);
  expect(await publishedAt(homeId)).toBe(first.home);
  const subPublished = await publishedAt(subId);
  expect(subPublished).not.toBe(first.sub);

  // 3. Publish design: the theme goes live, Home's label does not.
  await row(page, "design").getByRole("button", { name: "Publish design", exact: true }).click();
  await expect(row(page, "design")).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  const homeAfterDesign = await liveBody(host, "/", hasSurface);
  expect(homeAfterDesign).toContain("Book");
  expect(homeAfterDesign).not.toContain(label);
  expect(await publishedAt(homeId)).toBe(first.home);
  expect(await publishedAt(subId)).toBe(subPublished);
  await expect(statusChip(page)).toHaveText("Unpublished changes");
  await expect(page.getByTestId("publish-bar-count")).toHaveText("1 change");

  // 4. Publish all changes: the rest goes live; the page published in step 2 keeps its date.
  await bar(page).getByRole("button", { name: "Publish all changes", exact: true }).click();
  await expect(row(page, "home")).toHaveAttribute("data-state", "live", { timeout: 30_000 });
  await expect(statusChip(page)).toHaveText("Published");
  await expect(page.getByTestId("publish-bar-count")).toHaveText("No changes");
  const homeAfterAll = await liveBody(host, "/", (body) => body.includes(label));
  expect(hasSurface(homeAfterAll)).toBe(true);
  expect(await publishedAt(subId)).toBe(subPublished);
  expect(await publishedAt(homeId)).not.toBe(first.home);

  // The editor still saves Home after Publish page and Publish all moved nothing under it.
  await closeBar(page);
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  // 5. Revisions of the sub-page: restore the first one into the draft. It is not published.
  await openBar(page);
  await row(page, subId).getByRole("button", { name: "Revisions", exact: true }).click();
  const revisions = page.getByTestId("page-revisions");
  await expect(revisions).toBeVisible();
  await expect(revisions.locator("li[data-rev]")).toHaveCount(2);
  await expect(revisions.locator("li[data-rev]").first()).toContainText("Published");
  await expect(bar(page)).toContainText(
    "Restoring changes the draft. It goes live when you publish the page.",
  );
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="publish-bar"] button');
  await page.screenshot({ path: `tmp/screens/page-revisions-${testInfo.project.name}.png` });
  const reloaded = page.waitForEvent("load");
  await revisions
    .locator("li[data-rev]")
    .last()
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await reloaded;
  await expect
    .poll(async () => JSON.stringify((await entry(subId)).draft.blocks), { timeout: 20_000 })
    .toContain("Mine");
  expect(JSON.stringify((await entry(subId)).draft.blocks)).not.toContain(header);

  // The editor shows the old header, the row reads "Unpublished changes", the live page is unchanged.
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.getByTestId("page-row").filter({ hasText: "Gallery" }).click();
  const block = page.locator("li[data-block-id]").first();
  await expect(block).toBeVisible();
  if ((await page.locator('[data-field="text"]').count()) === 0) await block.click();
  await expect(page.locator('[data-field="text"]').first()).toHaveValue("Mine");
  await openBar(page);
  await expect(row(page, subId)).toHaveAttribute("data-state", "changed");
  await expect(row(page, subId)).toContainText("Unpublished changes");
  await expect(row(page, "home")).toHaveAttribute("data-state", "live");
  await expect(row(page, "design")).toHaveAttribute("data-state", "live");
  await closeBar(page);
  const gallery = await liveBody(host, "/gallery", (body) => body.includes(header));
  expect(gallery).not.toContain(">Mine<");
  expect(await publishedAt(subId)).toBe(subPublished);
  await expectNoHorizontalScroll(page);

  // 7. Desktop only: History restores the design, leaves both pages' drafts alone, and Undo puts it back.
  if (testInfo.project.name !== "desktop") return;
  const before = {
    home: (await entry(homeId)).draft,
    sub: (await entry(subId)).draft,
    design: (await pageRow(user.pageId)).draft,
  };
  expect(before.design.theme.overrides).toMatchObject({ surface: SURFACE });
  await openHistory(page);
  await expect(page.getByTestId("history-scope")).toHaveText(
    "Restores the design: theme, menu and profile. Pages are restored from their own revisions.",
  );
  await rowFor(page, 1).getByRole("button", { name: "Restore version 1", exact: true }).click();
  const confirm = rowFor(page, 1).getByTestId("restore-confirm");
  await expect(confirm).toContainText("Restore the design of version 1?");
  await confirm.getByRole("button", { name: "Restore version 1", exact: true }).click();
  const done = rowFor(page, 1).getByTestId("restore-done");
  await expect(done).toContainText("Restored the design of version 1 to your draft.");
  // The theme went back in the draft: version 1 was published before the surface changed.
  const restored = (await pageRow(user.pageId)).draft;
  expect((restored.theme.overrides as { surface?: string }).surface).not.toBe(SURFACE);
  // Both pages' drafts are untouched: Home's new label and the sub-page's restored header.
  expect((await entry(homeId)).draft).toEqual(before.home);
  expect((await entry(subId)).draft).toEqual(before.sub);
  expect(JSON.stringify(before.home.blocks)).toContain(label);

  // Undo brings the theme draft back, and still writes no page.
  await done.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rowFor(page, 1).getByTestId("restore-undone")).toHaveText("Undone.");
  const undone = (await pageRow(user.pageId)).draft;
  expect(undone.theme.overrides).toMatchObject({ surface: SURFACE });
  expect((await entry(homeId)).draft).toEqual(before.home);
  expect((await entry(subId)).draft).toEqual(before.sub);
  await expectNoHorizontalScroll(page);
});
