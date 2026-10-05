import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { emptyUser, openEditor, pageRow } from "../m2/editor-helpers";

/**
 * M12-03: the site templates. Each is applied on an empty Home of a Free account, makes exactly two
 * draft pages and publishes nothing; Publish then puts all three pages live. Every test makes its
 * own user and site; mara's rows are never touched. Runs at 390x844 and 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const TEMPLATES = [
  { id: "garage-sale", pages: ["Items", "Directions"], word: "oak side table" },
  { id: "small-business", pages: ["Menu or services", "Visit"], word: "consultation" },
  { id: "musician", pages: ["Shows", "Merch"], word: "t-shirt" },
] as const;

async function drafts(siteId: string) {
  const { data, error } = await adminClient()
    .from("site_pages")
    .select("id, draft, published, live_path")
    .eq("page_id", siteId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data as unknown as {
    id: string;
    draft: { path: string; title: string; blocks: unknown[] };
    published: unknown;
    live_path: string | null;
  }[];
}

for (const template of TEMPLATES) {
  test(`M12-03 ${template.id}: apply on an empty Home, publish, open all three pages`, async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "tpl");
    await openEditor(page);

    const card = page.getByTestId("site-templates");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("site-template")).toHaveCount(3);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="site-templates"]');

    await card.locator(`[data-template="${template.id}"]`).click();
    // Home is filled and the card gives way: the page has blocks now.
    await expect(page.getByTestId("site-templates")).toHaveCount(0);
    await expect(page.getByTestId("page-row")).toHaveCount(3);

    // Two sub-pages exist as drafts; nothing is published, and Home's draft has the menu.
    await expect.poll(async () => (await drafts(user.pageId)).length).toBe(2);
    const subs = await drafts(user.pageId);
    expect(subs.map((s) => s.draft.title)).toEqual([...template.pages]);
    for (const sub of subs) {
      expect(sub.published).toBeNull();
      expect(sub.draft.blocks.length).toBeGreaterThan(0);
    }
    await expect
      .poll(async () => {
        const row = await pageRow(user.pageId);
        const nav = (row.draft as { nav?: { items?: string[] } }).nav?.items ?? [];
        return (
          JSON.stringify(nav) === JSON.stringify(subs.map((s) => s.id)) && row.draft.blocks.length
        );
      })
      .toBeGreaterThan(0);
    expect((await pageRow(user.pageId)).published).toBeNull();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="pages-card"]');

    // Publish puts the whole site live.
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect
      .poll(async () => (await pageRow(user.pageId)).published !== null, { timeout: 30_000 })
      .toBe(true);

    const live = await context.newPage();
    for (const path of ["/", ...subs.map((s) => `/${s.draft.path}`)]) {
      const response = await live.goto(url(user.handle, path));
      expect(response?.status(), path).toBe(200);
      await expect(live.locator("body")).not.toContainText("couldn’t");
    }
    await live.goto(url(user.handle, `/${subs[0]!.draft.path}`));
    await expect(live.locator("body")).toContainText("Sample");
    await expectNoHorizontalScroll(live);
  });
}

test("M12-03 the template is only offered on an empty Home, and the Free limit is told", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "tpl");
  // A Free site already at two pages has no room for a template's two.
  const admin = adminClient();
  await admin.from("site_pages").insert({
    page_id: user.pageId,
    draft: { path: "extra", title: "Extra", description: "", blocks: [] },
  });
  await openEditor(page);
  await expect(page.getByTestId("site-templates-limit")).toBeVisible();
  await expect(page.getByTestId("site-template")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("M12-03 the new-site flow offers the templates", async ({ page, context }) => {
  const user = await emptyUser(context, "tpn", { plan: "pro" });
  await page.goto(url("app", "/pages/new"));
  const group = page.getByTestId("new-site-templates");
  await expect(group).toBeVisible();
  await expect(group.getByTestId("new-site-template")).toHaveCount(4);
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="new-site-templates"] label');

  const handle = `zq-n${rand(6)}`;
  await page.locator("#np-handle").fill(handle);
  await group.locator('label:has-text("Musician")').click();
  await page.getByRole("button", { name: "Create site" }).click();
  await page.waitForURL(/\/editor/);
  const site = await adminClient().from("pages").select("id").eq("handle", handle).single();
  expect(site.error).toBeNull();
  await expect
    .poll(async () => (await drafts(site.data!.id)).map((s) => s.draft.title))
    .toEqual(["Shows", "Merch"]);
  expect((await pageRow(site.data!.id)).published).toBeNull();
  expect(user.pageId).not.toBe(site.data!.id);
  await expect(page).not.toHaveURL(/template=/);
});
