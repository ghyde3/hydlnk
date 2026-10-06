import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { makeVersions, openHistory, pageState, rowFor } from "../m6/versions-helpers";

/**
 * M12-04: whole-site versions. A pro site publishes twice with two sub-pages (the items page
 * changes between the two); the history screen previews the old version across its pages behind a
 * page switcher, then restores it: Home's draft and the draft of the page that still exists are
 * written, the page deleted since is listed as not restored, and nothing is published. At 390x844
 * and 1440x900: no sideways scroll, every control 44px tall.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });
test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

const subDoc = (path: string, title: string, blockId: string, label: string) => ({
  path,
  title,
  description: `About ${title}`,
  blocks: [{ id: blockId, type: "link", visible: true, label, url: "https://example.com/open" }],
});

interface Site {
  pageId: string;
  itemsId: string;
  directionsId: string;
}

/** Version 1: items "Items one" + directions; version 2: the items page renamed "Items two". */
async function siteWithTwoVersions(context: BrowserContext, label: string): Promise<Site> {
  const user = await signedInUser(context, { label, plan: "pro" });
  const admin = adminClient();
  const publish = async (path: string, doc: ReturnType<typeof subDoc>) => {
    const { data, error } = await admin
      .from("site_pages")
      .insert({
        page_id: user.pageId,
        draft: doc,
        published: doc,
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(`sub-page ${path} failed: ${error.message}`);
    return data.id as string;
  };
  const itemsId = await publish(
    "items",
    subDoc("items", "Items one", "vsItemsLink01", "Open items one"),
  );
  const directionsId = await publish(
    "directions",
    subDoc("directions", "Find the studio", "vsDirLink0001", "Open directions"),
  );
  const nav = { show: true, items: [itemsId, directionsId] };
  await makeVersions(user.pageId, 1, { label: "First", extra: () => ({ nav }) });

  const second = subDoc("items", "Items two", "vsItemsLink01", "Open items two");
  const edit = await admin
    .from("site_pages")
    .update({ draft: second, published: second, published_at: new Date().toISOString() })
    .eq("id", itemsId);
  if (edit.error) throw new Error(`items page edit failed: ${edit.error.message}`);
  await makeVersions(user.pageId, 1, {
    label: "Second",
    firstAt: new Date(Date.now() - 1800_000).toISOString(),
    extra: () => ({ nav }),
  });
  return { pageId: user.pageId, itemsId, directionsId };
}

async function closeSheetIfOpen(page: Page): Promise<void> {
  const sheet = page.getByTestId("version-sheet");
  if (await sheet.isVisible()) {
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();
  }
}

test("M12-04 each version is recorded with its pages, and only the one that matches the whole site is Live now", async ({
  page,
  context,
}) => {
  const site = await siteWithTwoVersions(context, "vs0");
  const { data, error } = await adminClient()
    .from("page_versions")
    .select("version_no, sub_pages")
    .eq("page_id", site.pageId)
    .order("version_no");
  expect(error).toBeNull();
  const titles = (data ?? []).map((row) =>
    (row.sub_pages as { title: string }[]).map((p) => p.title).sort(),
  );
  expect(titles).toEqual([
    ["Find the studio", "Items one"],
    ["Find the studio", "Items two"],
  ]);

  await openHistory(page);
  await expect(rowFor(page, 2)).toContainText("Live now");
  await expect(rowFor(page, 1)).not.toContainText("Live now");
  await expectNoHorizontalScroll(page);
});

test("M12-04 preview shows Home and each page of an old version behind a page switcher", async ({
  page,
  context,
}) => {
  await siteWithTwoVersions(context, "vs1");
  await openHistory(page);
  await rowFor(page, 1).getByRole("button", { name: "Preview version 1", exact: true }).click();

  const switcher = page.getByTestId("version-page-switch");
  await expect(switcher).toBeVisible();
  const chips = switcher.getByTestId("version-page-chip");
  await expect(chips).toHaveText(["Home", "Find the studio", "Items one"]);
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  // Home shows no page title; each sub-page shows its own, as of version 1
  await expect(page.getByTestId("version-page").locator("h1.pg-pagetitle")).toHaveCount(0);

  await chips.nth(2).click();
  await expect(chips.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("version-page")).toContainText("Items one");
  await expect(page.getByTestId("version-page")).toContainText("Open items one");
  await chips.nth(1).click();
  await expect(page.getByTestId("version-page")).toContainText("Open directions");
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="version-page-switch"]');

  // version 2 shows its own page titles and starts on Home again
  await closeSheetIfOpen(page);
  await rowFor(page, 2).getByRole("button", { name: "Preview version 2", exact: true }).click();
  const chips2 = page.getByTestId("version-page-switch").getByTestId("version-page-chip");
  await expect(chips2).toHaveText(["Home", "Find the studio", "Items two"]);
  await expect(chips2.first()).toHaveAttribute("aria-pressed", "true");
  await chips2.nth(2).click();
  await expect(page.getByTestId("version-page")).toContainText("Open items two");
  await closeSheetIfOpen(page);
});

test("M12-04 restore writes Home and the page that still exists, lists the deleted page, and publishes nothing", async ({
  page,
  context,
}) => {
  const site = await siteWithTwoVersions(context, "vs2");
  const admin = adminClient();
  const liveBefore = await pageState(site.pageId);

  // after the second publish: the items page is edited, the directions page is deleted
  const edited = subDoc("items", "Items edited", "vsItemsLink01", "Open items edited");
  await admin.from("site_pages").update({ draft: edited }).eq("id", site.itemsId);
  const gone = await admin.from("site_pages").delete().eq("id", site.directionsId);
  expect(gone.error).toBeNull();

  await openHistory(page);
  await rowFor(page, 1).getByRole("button", { name: "Restore version 1", exact: true }).click();
  const confirm = rowFor(page, 1).getByTestId("restore-confirm");
  await expect(confirm.getByTestId("restore-pages")).toHaveText(
    "The drafts of its 2 other pages are replaced too.",
  );
  await confirm.getByRole("button", { name: "Restore version 1", exact: true }).click();

  const done = rowFor(page, 1).getByTestId("restore-done");
  await expect(done).toContainText("Restored version 1 and 1 other page to your draft.");
  const notRestored = rowFor(page, 1).getByTestId("restore-not-restored");
  await expect(notRestored).toContainText("1 page was not restored:");
  await expect(notRestored).toContainText("Find the studio (/directions) was deleted since");
  // Undo only snapshots Home: it is not offered once another page was written
  await expect(done.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(rowFor(page, 1).getByTestId("restore-no-undo")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="restore-done"]');

  // the drafts: Home as of version 1 (bio and menu), the items page as of version 1
  const after = await pageState(site.pageId);
  expect((after.draft.profile as { bio: string }).bio).toBe("First number 1");
  expect((after.draft.nav as { items: string[] }).items).toEqual([site.itemsId, site.directionsId]);
  const items = await admin
    .from("site_pages")
    .select("draft, published")
    .eq("id", site.itemsId)
    .single();
  expect((items.data!.draft as { title: string }).title).toBe("Items one");
  // nothing is published: Home's live document and the page's live form are as they were
  expect(after.published).toEqual(liveBefore.published);
  expect(after.published_at).toBe(liveBefore.published_at);
  expect((items.data!.published as { title: string }).title).toBe("Items two");
  // the deleted page was not brought back
  const rows = await admin.from("site_pages").select("id").eq("page_id", site.pageId);
  expect(rows.data!.map((r) => r.id)).toEqual([site.itemsId]);
});

test("M12-04 restore writes two sub-page drafts when both pages still exist, and publishes nothing", async ({
  page,
  context,
}) => {
  const site = await siteWithTwoVersions(context, "vs3");
  const admin = adminClient();
  const liveBefore = await pageState(site.pageId);

  // after the second publish both pages are edited in the draft only
  const itemsEdit = subDoc("items", "Items edited", "vsItemsLink01", "Open items edited");
  const dirEdit = subDoc("directions", "Directions edited", "vsDirLink0001", "Open dir edited");
  await admin.from("site_pages").update({ draft: itemsEdit }).eq("id", site.itemsId);
  await admin.from("site_pages").update({ draft: dirEdit }).eq("id", site.directionsId);

  await openHistory(page);
  await rowFor(page, 1).getByRole("button", { name: "Restore version 1", exact: true }).click();
  const confirm = rowFor(page, 1).getByTestId("restore-confirm");
  await confirm.getByRole("button", { name: "Restore version 1", exact: true }).click();
  const done = rowFor(page, 1).getByTestId("restore-done");
  await expect(done).toContainText("Restored version 1 and 2 other pages to your draft.");
  await expect(rowFor(page, 1).getByTestId("restore-not-restored")).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // both drafts are version 1's, and nothing was published
  const rows = await admin
    .from("site_pages")
    .select("id, draft, published")
    .eq("page_id", site.pageId);
  const byId = new Map((rows.data ?? []).map((r) => [r.id as string, r]));
  expect((byId.get(site.itemsId)!.draft as { title: string }).title).toBe("Items one");
  expect((byId.get(site.directionsId)!.draft as { title: string }).title).toBe("Find the studio");
  expect((byId.get(site.itemsId)!.published as { title: string }).title).toBe("Items two");
  expect((byId.get(site.directionsId)!.published as { title: string }).title).toBe(
    "Find the studio",
  );
  const after = await pageState(site.pageId);
  expect(after.published).toEqual(liveBefore.published);
  expect(after.published_at).toBe(liveBefore.published_at);
});
