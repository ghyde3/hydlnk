import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { emptyUser, openEditor, pageRow } from "../m2/editor-helpers";

/**
 * M12-08: each page shows Live, Not published yet or Changes not published; Duplicate page makes a
 * new draft with fresh ids and a free path; the menu pages can be dragged (here by keyboard) as well
 * as moved with the buttons. A Pro account, so there is room for more than Home and two pages. Every
 * test makes its own user and site. Runs at 390x844 and 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const block = (id: string, text: string) => ({ id, type: "header", visible: true, text });
const items = (id: string, a: string, b: string) => ({
  id,
  type: "items",
  visible: true,
  layout: "list",
  heading: "Things",
  items: [
    { id: a, name: "One", price: "$1", description: "", sold: false },
    { id: b, name: "Two", price: "$2", description: "", sold: false },
  ],
});

async function seed(siteId: string) {
  const admin = adminClient();
  const rows = [
    {
      path: "alpha",
      title: "Alpha",
      blocks: [block("alphahdr01", "Alpha"), items("alphaitm01", "alphaone01", "alphatwo01")],
    },
    { path: "beta", title: "Beta", blocks: [block("betahdr001", "Beta")] },
    { path: "gamma", title: "Gamma", blocks: [block("gammahdr01", "Gamma")] },
  ];
  const inserted = await admin
    .from("site_pages")
    .insert(rows.map((r) => ({ page_id: siteId, draft: { ...r, description: "" } })))
    .select("id, draft");
  expect(inserted.error).toBeNull();
  const ids = ["alpha", "beta", "gamma"].map(
    (path) => inserted.data!.find((r) => (r.draft as { path: string }).path === path)!.id as string,
  );
  const draft = (await pageRow(siteId)).draft as unknown as Record<string, unknown>;
  await admin
    .from("pages")
    .update({ draft: { ...draft, nav: { show: true, items: ids } } })
    .eq("id", siteId);
  return ids;
}

const rowTitled = (page: import("@playwright/test").Page, title: string) =>
  page.getByTestId("page-row").filter({ hasText: title }).first();
const stateOf = (page: import("@playwright/test").Page, title: string) =>
  rowTitled(page, title).getByTestId("page-state");

test("M12-08 states, duplicate and drag to reorder", async ({ page, context }) => {
  const user = await emptyUser(context, "pol", { plan: "pro" });
  const ids = await seed(user.pageId);
  await openEditor(page);

  // Nothing is published yet: every page says so.
  for (const title of ["Alpha", "Beta", "Gamma"]) {
    await expect(stateOf(page, title)).toHaveText("Not published yet");
  }
  await expect(page.getByTestId("page-state").first()).toHaveText("Not published yet");
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="pages-card"]');

  // Publish: all Live. An edit to one page is "Changes not published" on that page only.
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect
    .poll(async () => (await pageRow(user.pageId)).published !== null, { timeout: 30_000 })
    .toBe(true);
  for (const title of ["Alpha", "Beta", "Gamma"]) {
    await expect(stateOf(page, title)).toHaveText("Live");
  }
  await expect(page.getByTestId("page-state").first()).toHaveText("Live");
  await rowTitled(page, "Beta").click();
  await page.locator('[data-field="page-title"]').fill("Beta two");
  await expect(stateOf(page, "Beta two")).toHaveText("Changes not published");
  await expect(stateOf(page, "Alpha")).toHaveText("Live");

  // Duplicate Alpha: a new draft, fresh ids, a free path, never published; the original is intact.
  await rowTitled(page, "Alpha").click();
  await page.getByTestId("duplicate-page").click();
  await expect(rowTitled(page, "Alpha copy")).toBeVisible();
  await expect(stateOf(page, "Alpha copy")).toHaveText("Not published yet");
  await expect(rowTitled(page, "Alpha copy")).toContainText("/alpha-copy");
  await expect
    .poll(async () => {
      const { data } = await adminClient()
        .from("site_pages")
        .select("id, draft, published")
        .eq("page_id", user.pageId);
      return data!.length;
    })
    .toBe(4);
  const { data: all } = await adminClient()
    .from("site_pages")
    .select("id, draft, published")
    .eq("page_id", user.pageId);
  const copy = all!.find((r) => (r.draft as { path: string }).path === "alpha-copy")!;
  const original = all!.find((r) => r.id === ids[0])!;
  type Doc = { blocks: { id: string; items?: { id: string }[] }[]; title: string };
  const copyDoc = copy.draft as Doc;
  const originalDoc = original.draft as Doc;
  expect(copy.published).toBeNull();
  expect(copyDoc.blocks.map((b) => b.id)).not.toContain("alphahdr01");
  expect(copyDoc.blocks[1]!.items!.map((i) => i.id)).not.toContain("alphaone01");
  expect(copyDoc.blocks[1]!.items!).toHaveLength(2);
  expect(originalDoc.blocks.map((b) => b.id)).toEqual(["alphahdr01", "alphaitm01"]);
  expect(copyDoc.title).toBe("Alpha copy");

  // Drag, by keyboard: lift the first menu page, move it down one place, drop it.
  const navNow = async () =>
    ((await pageRow(user.pageId)).draft as unknown as { nav: { items: string[] } }).nav.items;
  await expect.poll(navNow).toHaveLength(4);
  const before = await navNow();
  expect(before.slice(0, 3)).toEqual(ids);
  const handle = page.getByTestId("page-drag-handle").first();
  await expect(handle).toBeVisible();
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await expect.poll(navNow).toEqual([before[1], before[0], before[2], before[3]]);
  // The list shows the new order, with Home first.
  await expect(page.getByTestId("page-row").nth(1)).toContainText("Beta two");
  await expect(page.getByTestId("page-row").first()).toContainText("Home");
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="pages-card"]');

  // The up and down buttons still work.
  await rowTitled(page, "Beta two").click();
  await page.getByTestId("menu-down").click();
  await expect.poll(navNow).toEqual([before[0], before[1], before[2], before[3]]);
});

test("M12-08 Duplicate page is not offered at the plan's limit", async ({ page, context }) => {
  const user = await emptyUser(context, "pol");
  const admin = adminClient();
  await admin.from("site_pages").insert([
    { page_id: user.pageId, draft: { path: "one", title: "One", description: "", blocks: [] } },
    { page_id: user.pageId, draft: { path: "two", title: "Two", description: "", blocks: [] } },
  ]);
  await openEditor(page);
  await page.getByTestId("page-row").filter({ hasText: "One" }).first().click();
  await expect(page.getByTestId("duplicate-page-limit")).toBeVisible();
  await expect(page.getByTestId("duplicate-page")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
