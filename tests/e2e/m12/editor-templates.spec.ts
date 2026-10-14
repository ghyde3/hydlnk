import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { addPageEntry, seedHome, subPageEntries } from "../m15/entry-helpers";
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

/** The site's sub-page entries (Home's '/' entry left out), oldest first. */
const drafts = (siteId: string) => subPageEntries(siteId);

/** Home's blocks, which live in its '/' entry. */
async function homeBlockCount(siteId: string): Promise<number> {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("draft")
    .eq("site_id", siteId)
    .eq("draft->>path", "/")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data?.draft as { blocks?: unknown[] } | undefined)?.blocks ?? []).length;
}

for (const template of TEMPLATES) {
  test(`M12-03 ${template.id}: apply on an empty Home, publish, open all three pages`, async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "tpl");
    await seedHome(user.pageId); // a site starts with its Home entry
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
          JSON.stringify(nav) === JSON.stringify(subs.map((s) => s.id)) &&
          (await homeBlockCount(user.pageId))
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
  await seedHome(user.pageId);
  await addPageEntry(user.pageId, { path: "extra", title: "Extra" });
  await openEditor(page);
  await expect(page.getByTestId("site-templates-limit")).toBeVisible();
  await expect(page.getByTestId("site-template")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("M12-03 a ?template= link applies nothing: it needs a click on the card", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "tpl");
  await page.goto(url("app", "/editor?template=musician"));
  const card = page.getByTestId("site-templates");
  await expect(card).toBeVisible();
  await expect(page).not.toHaveURL(/template=/);
  // Give a wrongly applied template time to land, then prove nothing was written.
  await page.waitForTimeout(1500);
  expect(await drafts(user.pageId)).toHaveLength(0);
  await expect(card).toBeVisible();
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
