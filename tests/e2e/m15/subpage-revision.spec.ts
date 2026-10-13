import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { emptyUser, openEditor, pageRow, waitForEditorHydrated } from "../m2/editor-helpers";
import { editSubPageHeader, entry, seedEntries } from "./entry-helpers";

/**
 * M15-01, on page entries (1b1-17): a sub-page save checks the entry rev the editor loaded, like
 * Home's rev. A change written to the same sub-page elsewhere (here the secret key, as MCP's writer
 * does) is never overwritten by editor autosave: a conflict banner asks for a reload and the other
 * write survives. Publish does not move the rev. Runs at phone 390x844 and desktop 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

test("M15-01 a writer's edit to a sub-page between saves shows the conflict notice", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "eed");
  const seeded = await seedEntries(user.pageId);
  await openEditor(page);

  await editSubPageHeader(page, "Mine");
  await expect.poll(async () => (await entry(seeded.subId)).draft.blocks[0]?.text).toBe("Mine");
  await expect(page.locator("[data-save-problem]")).toHaveCount(0);

  const current = await entry(seeded.subId);
  const moved = await adminClient()
    .from("content_entries")
    .update({ draft: { ...current.draft, description: "From MCP" } as never, rev: current.rev + 1 })
    .eq("id", seeded.subId);
  expect(moved.error).toBeNull();

  await page.locator('[data-field="text"]').first().fill("Mine, edited after");
  const banner = page.locator('[data-save-problem="conflict"]');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const after = await entry(seeded.subId);
  expect(after.draft.description).toBe("From MCP");
  expect(after.draft.blocks[0]?.text).toBe("Mine");

  // Reload: the editor takes the stored page and saves normally again.
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect(banner).toHaveCount(0);
  await waitForEditorHydrated(page);
  await editSubPageHeader(page, "After reload");
  await expect
    .poll(async () => (await entry(seeded.subId)).draft.blocks[0]?.text)
    .toBe("After reload");
  expect((await entry(seeded.subId)).draft.description).toBe("From MCP");
});

test("M15-01 Publish does not make the next sub-page edit a conflict", async ({ page, context }) => {
  const user = await emptyUser(context, "eep");
  const seeded = await seedEntries(user.pageId);
  await openEditor(page);
  await editSubPageHeader(page, "Before publish");
  await expect
    .poll(async () => (await entry(seeded.subId)).draft.blocks[0]?.text)
    .toBe("Before publish");

  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect
    .poll(async () => (await pageRow(user.pageId)).published !== null, { timeout: 30_000 })
    .toBe(true);

  await page.locator('[data-field="text"]').first().fill("After publish");
  await expect
    .poll(async () => (await entry(seeded.subId)).draft.blocks[0]?.text)
    .toBe("After publish");
  await expect(page.locator("[data-save-problem]")).toHaveCount(0);
});
