import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { editSubPageHeader, entry, seedEntries } from "./entry-helpers";
import { cleanupUsers } from "../fixtures/data";
import { option, openDesign } from "../m6/design-helpers";
import {
  emptyUser,
  openEditor,
  pageRow,
  reloadEditor,
  waitForEditorHydrated,
} from "../m2/editor-helpers";

/**
 * 1b1-17 (M15-05): the editor saves through page entries. Home's blocks and each sub-page go to their
 * entries under their own revs, the design (name, theme) to pages.draft under draft->>rev, and a
 * writer's edit between saves shows the existing conflict notice. Runs at 390x844 and 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

async function editHomeLabel(page: Page, label: string) {
  await page.locator('li[data-block-id="lnk-aaaaaaaa"]').click();
  await page.locator('[data-field="label"]').first().fill(label);
}

test("1b1-17 a Home block, the name, a theme value and a sub-page block all persist across a reload", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "ees");
  const seeded = await seedEntries(user.pageId);
  await openEditor(page);

  await editHomeLabel(page, "Book now");
  await page.getByLabel("Display name", { exact: true }).fill("Entries Name");
  await expect
    .poll(async () => (await entry(seeded.homeId)).draft.blocks[0]?.label)
    .toBe("Book now");
  await expect.poll(async () => (await pageRow(user.pageId)).draft.profile.name).toBe("Entries Name");

  // A theme value, on the Design tab: the same pages.draft counter as the name.
  await openDesign(page);
  await option(page, "Corner radius", "20px").click();
  await expect
    .poll(async () => (await pageRow(user.pageId)).draft.theme.overrides.radius)
    .toBe(20);

  await openEditor(page);
  await editSubPageHeader(page, "Gallery edited");
  await expect
    .poll(async () => (await entry(seeded.subId)).draft.blocks[0]?.text)
    .toBe("Gallery edited");
  await expect(page.locator("[data-save-problem]")).toHaveCount(0);

  // The frozen blocks in pages.draft are never written by the editor.
  const row = await pageRow(user.pageId);
  expect((row.draft.blocks ?? []).map((b: { id: string }) => b.id)).not.toContain("lnk-aaaaaaaa");

  await reloadEditor(page);
  expect((await pageRow(user.pageId)).draft.theme.overrides.radius).toBe(20);
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Entries Name");
  await expect(page.locator('li[data-block-id="lnk-aaaaaaaa"]')).toContainText("Book now");
  await page.getByTestId("page-row").filter({ hasText: "Gallery" }).click();
  await expect(page.locator("li[data-block-id]").first()).toContainText("Gallery edited");
});

test("1b1-17 a writer's edit to Home's blocks between saves shows the conflict notice and survives", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "eec");
  const seeded = await seedEntries(user.pageId);
  await openEditor(page);
  await waitForEditorHydrated(page);

  await editHomeLabel(page, "First");
  await expect.poll(async () => (await entry(seeded.homeId)).draft.blocks[0]?.label).toBe("First");

  // Another writer (MCP's: the secret key) moves Home's entry.
  const current = await entry(seeded.homeId);
  const moved = await adminClient()
    .from("content_entries")
    .update({
      draft: {
        ...current.draft,
        blocks: [{ ...current.draft.blocks[0], label: "From MCP" }],
      } as never,
      rev: current.rev + 1,
    })
    .eq("id", seeded.homeId);
  expect(moved.error).toBeNull();

  await page.locator('[data-field="label"]').first().fill("Mine again");
  const banner = page.locator('[data-save-problem="conflict"]');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("Reload");
  expect((await entry(seeded.homeId)).draft.blocks[0]?.label).toBe("From MCP");
});
