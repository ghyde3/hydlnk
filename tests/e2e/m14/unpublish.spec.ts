import { expect, test } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import { pageRow } from "../m2/editor-helpers";
import { ITEMS, locsOf, makeLiveSite } from "../m11/tenant-helpers";
import { chip, clickTab, openTab, publishButton, toolbar } from "../m7/toolbar-helpers";

/**
 * M14-02 (and the unpublish row of M8-04 step 4, which the production-build cache matrix proves in
 * tests/e2e/m8/render-cache.spec.ts): the editor's Unpublish. A published site with a sub-page, a
 * verified custom domain and analytics history is unpublished through the real UI (the More actions
 * menu from 760px up; the Share tab's address card on a phone, where the toolbar menus are not
 * drawn), the live hosts answer from the very next request as an unpublished site, the draft and the
 * analytics stay, and the real Publish button brings it all back. Runs at 390x844 and 1440x900.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 150_000 });

const PLACEHOLDER = "Nothing published here yet.";

test("M14-02 Unpublish takes the site back to its placeholder on every host, keeps the draft and analytics, and Publish brings it back", async ({
  page,
  context,
}, info) => {
  const site = await makeLiveSite("unp", { plan: "pro" });
  const custom = hostnameFor("unp");
  await addDomainRow({ pageId: site.pageId, hostname: custom, status: "verified" });
  const handleHost = `${site.handle}.localhost:3000`;
  const get = (host: string, path = "/") => rawRequest(host, path);
  const admin = adminClient();

  // Analytics history: two views, one on a past day, rolled up.
  const events = await admin.from("events").insert([
    { page_id: site.pageId, type: "view", visitor_hash: "zq-unp", ts: new Date().toISOString() },
    { page_id: site.pageId, type: "view", visitor_hash: "zq-unp", ts: "2026-01-15T12:00:00Z" },
  ]);
  expect(events.error).toBeNull();
  const eventCount = async () =>
    (await admin.from("events").select("id").eq("page_id", site.pageId)).data!.length;
  expect(await eventCount()).toBe(2);

  // Live: Home and the sub-page on both hosts, the sub-page in the sitemap.
  for (const host of [handleHost, custom]) {
    const home = await get(host);
    expect(home.status, host).toBe(200);
    expect(home.body, host).toContain(site.name);
    expect((await get(host, `/${ITEMS.path}`)).status, host).toBe(200);
  }
  const sitemapBefore = await get(handleHost, "/sitemap.xml");
  // The sitemap names the primary custom domain once there is one.
  expect(locsOf(sitemapBefore.body).some((loc) => loc.endsWith(`/${ITEMS.path}`))).toBe(true);

  await signInAs(context, site.user.email);
  const draftBefore = (await pageRow(site.pageId)).draft;

  // Unpublish through the UI. The menu item belongs to the desktop toolbar; a phone uses the Share tab.
  const phone = !desktopOnly(info);
  await openTab(page, phone ? "Share" : "Edit");
  if (phone) {
    await expect(page.getByTestId("address-unpublish")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-testid=address-card]");
    await page.getByTestId("address-unpublish").click();
  } else {
    const more = toolbar(page).getByRole("button", { name: "More actions" });
    await more.click();
    const items = page.getByRole("menu", { name: "More actions" }).getByRole("menuitem");
    await expect(items).toHaveText(["QR code", "Version history", "Unpublish"]);
    await expectTapTargets(page, "[role=menu]");
    await items.filter({ hasText: "Unpublish" }).click();
  }

  // The confirmation names the address and says the draft stays; Cancel changes nothing.
  const dialog = page.getByRole("dialog", { name: "Unpublish this site?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("unpublish-description")).toContainText(
    `${site.handle}.hydlnk.com`,
  );
  await expect(dialog.getByTestId("unpublish-description")).toContainText("Your draft stays");
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, "[data-testid=unpublish-dialog]");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect((await pageRow(site.pageId)).published).not.toBeNull();
  expect((await get(handleHost)).status).toBe(200);

  if (phone) await page.getByTestId("address-unpublish").click();
  else {
    await toolbar(page).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Unpublish" }).click();
  }
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("unpublish-confirm").click();
  await expect(dialog).toBeHidden();

  // The chip says so, and the page row has nothing published, nor does any sub-page.
  await expect(chip(page)).toHaveAttribute("data-publish-status", "not-published");
  const row = await pageRow(site.pageId);
  expect(row.published).toBeNull();
  const subs = await admin
    .from("site_pages")
    .select("published, published_at, live_path")
    .eq("page_id", site.pageId);
  expect(subs.data).toHaveLength(2);
  for (const sub of subs.data!) {
    expect(sub.published).toBeNull();
    expect(sub.published_at).toBeNull();
    expect(sub.live_path).toBeNull();
  }
  // The draft is untouched, and so is the analytics history.
  expect(row.draft).toEqual(draftBefore);
  expect(await eventCount()).toBe(2);

  // The very next request: the placeholder on the handle host, the plain 404 for sub-pages, the
  // unpublished answer of the routing on the verified custom host, the sitemap without the site.
  const placeholder = await get(handleHost);
  expect(placeholder.status).toBe(200);
  expect(placeholder.body).toContain(PLACEHOLDER);
  expect(placeholder.body).not.toContain(site.name);
  const gone = await get(handleHost, `/${ITEMS.path}`);
  expect(gone.status).toBe(404);
  expect(gone.body).not.toContain(site.name);
  expect(gone.body).not.toContain(ITEMS.title);
  const customNow = await get(custom);
  expect(customNow.status).toBe(404);
  expect(customNow.body).not.toContain(site.name);
  expect((await get(custom, `/${ITEMS.path}`)).status).toBe(404);
  expect((await get(handleHost, "/sitemap.xml")).status).toBe(404);

  // The menu no longer offers Unpublish; the Share tab's button goes too.
  if (phone) await expect(page.getByTestId("address-unpublish")).toHaveCount(0);
  else {
    await toolbar(page).getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Unpublish" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  // Publish again brings the whole site back, sub-page included.
  await clickTab(page, "Edit");
  await publishButton(page).first().click();
  await expect.poll(async () => (await pageRow(site.pageId)).published !== null).toBe(true);
  await expect(chip(page)).toHaveAttribute("data-publish-status", "published");
  for (const host of [handleHost, custom]) {
    const home = await get(host);
    expect(home.status, host).toBe(200);
    expect(home.body, host).toContain(site.name);
    expect((await get(host, `/${ITEMS.path}`)).status, host).toBe(200);
  }
  expect(await eventCount()).toBe(2);
  await expectNoHorizontalScroll(page);
});
