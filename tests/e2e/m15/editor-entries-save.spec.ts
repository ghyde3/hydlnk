import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
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

interface Seeded {
  homeId: string;
  subId: string;
}

/** The moved layout of a new site: a '/' entry holding a link block, and one sub-page with a header. */
async function seedEntries(siteId: string): Promise<Seeded> {
  const admin = adminClient();
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "page")
    .single();
  if (type.error) throw new Error(type.error.message);
  const insert = async (draft: unknown) => {
    const made = await admin
      .from("content_entries")
      .insert({ site_id: siteId, type_id: type.data.id, draft: draft as never })
      .select("id")
      .single();
    if (made.error) throw new Error(made.error.message);
    return made.data.id as string;
  };
  const homeId = await insert({
    path: "/",
    title: "",
    description: "",
    blocks: [
      {
        id: "lnk-aaaaaaaa",
        type: "link",
        visible: true,
        label: "Book",
        url: "https://example.com/book",
      },
    ],
  });
  const subId = await insert({
    path: "gallery",
    title: "Gallery",
    description: "",
    blocks: [{ id: "hdr-aaaaaaaa", type: "header", visible: true, text: "Mine" }],
  });
  return { homeId, subId };
}

async function entry(id: string) {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("rev, draft")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return {
    rev: Number(data.rev),
    draft: data.draft as { blocks: Array<Record<string, unknown>> } & Record<string, unknown>,
  };
}

async function editSubPageHeader(page: Page, text: string) {
  await page.getByTestId("page-row").filter({ hasText: "Gallery" }).click();
  const block = page.locator("li[data-block-id]").first();
  await expect(block).toBeVisible();
  if ((await page.locator('[data-field="text"]').count()) === 0) await block.click();
  await page.locator('[data-field="text"]').first().fill(text);
}

async function editHomeLabel(page: Page, label: string) {
  await page.locator('li[data-block-id="lnk-aaaaaaaa"]').click();
  await page.locator('[data-field="label"]').first().fill(label);
}

test("1b1-17 a Home block, the name and a sub-page block all persist across a reload", async ({
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

  await editSubPageHeader(page, "Gallery edited");
  await expect
    .poll(async () => (await entry(seeded.subId)).draft.blocks[0]?.text)
    .toBe("Gallery edited");
  await expect(page.locator("[data-save-problem]")).toHaveCount(0);

  // The frozen blocks in pages.draft are never written by the editor.
  const row = await pageRow(user.pageId);
  expect((row.draft.blocks ?? []).map((b: { id: string }) => b.id)).not.toContain("lnk-aaaaaaaa");

  await reloadEditor(page);
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

test("1b1-17 a writer's edit to a sub-page between saves shows the conflict notice", async ({
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

test("1b1-17 Publish does not make the next sub-page edit a conflict", async ({ page, context }) => {
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
