import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { emptyUser, openEditor, pageRow, waitForEditorHydrated } from "../m2/editor-helpers";

/**
 * M15-01: a sub-page save checks the revision the editor loaded (`updated_at`), like Home's `rev`. A
 * change written to the same sub-page elsewhere (here the secret key, as MCP's writer does) is never
 * overwritten by editor autosave: a conflict banner asks for a reload and the other write survives.
 * Runs at phone 390x844 and desktop 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

interface SubRow {
  id: string;
  draft: { title: string; description: string; blocks: Array<Record<string, unknown>> };
}

async function subPage(siteId: string): Promise<SubRow> {
  const { data, error } = await adminClient()
    .from("site_pages")
    .select("id, draft")
    .eq("page_id", siteId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data[0] as unknown as SubRow;
}

async function addPage(page: Page, title: string) {
  await page.getByTestId("add-page").click();
  const form = page.getByTestId("add-page-form");
  await form.locator('[data-field="new-page-title"]').fill(title);
  await form.getByTestId("add-page-submit").click();
  await expect(page.getByTestId("page-row").filter({ hasText: title })).toBeVisible();
}

test("M15-01 an edit made elsewhere to a sub-page is not overwritten by autosave", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "rev");
  await openEditor(page);
  await addPage(page, "Gallery");

  // A first edit saves, and the editor now holds the revision that save returned.
  await page.getByRole("button", { name: "Header", exact: true }).first().click();
  const text = page.locator('[data-field="text"]').first();
  await text.fill("Mine");
  await expect.poll(async () => (await subPage(user.pageId)).draft.blocks[0]?.text).toBe("Mine");
  await expect(page.locator("[data-save-problem]")).toHaveCount(0);

  // Someone else (MCP's writer: the secret key, the draft column) changes the same sub-page.
  const row = await subPage(user.pageId);
  const { error } = await adminClient()
    .from("site_pages")
    .update({ draft: { ...row.draft, description: "From MCP" } })
    .eq("id", row.id);
  expect(error).toBeNull();

  // The next keystroke autosaves against a stale revision: conflict, nothing written.
  await text.fill("Mine, edited after");
  const banner = page.locator('[data-save-problem="conflict"]');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("Reload");
  await expect(banner.getByRole("button", { name: "Reload" })).toBeVisible();

  const after = await subPage(user.pageId);
  expect(after.draft.description).toBe("From MCP");
  expect(after.draft.blocks[0]?.text).toBe("Mine");

  // Saving stays stopped (no retry loop, nothing overwritten later).
  await page.waitForTimeout(2500);
  expect((await subPage(user.pageId)).draft.blocks[0]?.text).toBe("Mine");

  // Reload: the editor takes the stored page, MCP's change included, and saves normally again.
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("pages-card")).toBeVisible();
  await waitForEditorHydrated(page);
  await page.getByTestId("page-row").filter({ hasText: "Gallery" }).click();
  const block = page.locator("li[data-block-id]").first();
  await expect(block).toContainText("Mine");
  if ((await page.locator('[data-field="text"]').count()) === 0) await block.click();
  await page.locator('[data-field="text"]').first().fill("After reload");
  await expect
    .poll(async () => (await subPage(user.pageId)).draft.blocks[0]?.text)
    .toBe("After reload");
  expect((await subPage(user.pageId)).draft.description).toBe("From MCP");
});

test("M15-01 Publish moves updated_at but does not make the next sub-page edit a conflict", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "revp");
  await openEditor(page);
  await addPage(page, "Gallery");
  await page.getByRole("button", { name: "Header", exact: true }).first().click();
  const text = page.locator('[data-field="text"]').first();
  await text.fill("Before publish");
  await expect
    .poll(async () => (await subPage(user.pageId)).draft.blocks[0]?.text)
    .toBe("Before publish");

  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect
    .poll(async () => (await pageRow(user.pageId)).published !== null, { timeout: 30_000 })
    .toBe(true);

  await text.fill("After publish");
  await expect
    .poll(async () => (await subPage(user.pageId)).draft.blocks[0]?.text)
    .toBe("After publish");
  await expect(page.locator("[data-save-problem]")).toHaveCount(0);
});
