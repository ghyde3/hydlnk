import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, url } from "../helpers";
import { addBlock } from "../m2/blocks-helpers";
import { emptyUser, openEditor, pageRow, reloadEditor, statusChip } from "../m2/editor-helpers";
import { addPageEntry, entry, seedHome, subPageEntries } from "./entry-helpers";

/**
 * M15-11 steps 3 and 4: on the live site a menu item and a page link whose page is not live are not
 * drawn, and the HTML names neither that page's title, its path nor its id; publishing the page
 * brings both back. The page is made in the editor and put in the menu, Home gets a page link to
 * it, and the design and Home are published on their own from the publish bar (M15-10), so the new
 * page stays a draft while the menu and the link that point at it are live.
 * Runs at phone 390x844 and desktop 1440x900; each run makes its own user and site.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 240_000 });

/** The publish bar, opened from the status chip when it is not on screen. */
async function openBar(page: Page) {
  const bar = page.getByTestId("publish-bar");
  if (!(await bar.isVisible())) await page.getByTestId("publish-bar-toggle").click();
  await expect(bar).toBeVisible();
  return bar;
}

/** Presses the row's own publish button and waits until the row reads Live. */
async function publishRow(page: Page, rowId: string, button: "Publish design" | "Publish page") {
  await openBar(page);
  const row = page.getByTestId(`publish-row-${rowId}`);
  await expect(row).toHaveAttribute("data-state", /^(changed|draft)$/);
  await row.getByRole("button", { name: button, exact: true }).click();
  // The bar may close after a publish: the state is read with it open.
  await expect(async () => {
    await openBar(page);
    await expect(page.getByTestId(`publish-row-${rowId}`)).toHaveAttribute("data-state", "live");
  }).toPass({ timeout: 30_000 });
}

test("M15-11 a menu item and a page link to a page that is not live are hidden, and come back when it is published", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const title = `Zebra ${mark}`;
  const path = `zebra-${mark}`;
  const linkLabel = `Stripes ${mark}`;
  const homeLine = `Welcome ${mark}`;
  const user = await emptyUser(context, "hid");
  const homeId = await seedHome(user.pageId);
  const host = `${user.handle}.localhost:3000`;
  const toolbar = page.getByTestId("workspace-toolbar");
  await openEditor(page);

  // 1. A published site: Home is live with one block.
  const header = await addBlock(page, "header");
  await header.panel.locator('[data-field="text"]').first().fill(homeLine);
  await expect
    .poll(async () => JSON.stringify((await entry(homeId)).draft.blocks))
    .toContain(homeLine);
  await toolbar.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  await expect.poll(async () => (await rawRequest(host, "/")).body).toContain(homeLine);

  // Add the page "Zebra": it joins the menu. Then a page link to it on Home.
  await page.getByTestId("add-page").click();
  const form = page.getByTestId("add-page-form");
  await form.locator('[data-field="new-page-title"]').fill(title);
  await form.locator('[data-field="new-page-path"]').fill(path);
  await form.getByTestId("add-page-submit").click();
  await expect(page.getByTestId("page-row").filter({ hasText: title })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect.poll(async () => (await subPageEntries(user.pageId)).length).toBe(1);
  const zebra = (await subPageEntries(user.pageId))[0]!;
  expect(zebra.draft).toMatchObject({ path, title });
  expect(zebra.published).toBeNull();
  await expect
    .poll(
      async () =>
        ((await pageRow(user.pageId)).draft as { nav?: { items?: string[] } }).nav?.items ?? [],
    )
    .toEqual([zebra.id]);

  await page.getByTestId("page-row").first().click();
  await expect(page.locator('[data-field="page-title"]')).toHaveCount(0);
  const link = await addBlock(page, "page_link");
  await link.panel.locator('[data-field="target"]').first().selectOption(zebra.id);
  await link.panel.locator('[data-field="label"]').first().fill(linkLabel);
  await expect
    .poll(async () =>
      (await entry(homeId)).draft.blocks
        .filter((block) => block.type === "page_link")
        .map((block) => [block.label, block.target]),
    )
    .toEqual([[linkLabel, zebra.id]]);
  await expectNoHorizontalScroll(page);

  // 2. Publish the design (the menu) and Home (the page link). Zebra stays a draft.
  await publishRow(page, "design", "Publish design");
  await publishRow(page, "home", "Publish page");
  await openBar(page);
  await expect(page.getByTestId(`publish-row-${zebra.id}`)).toHaveAttribute("data-state", "draft");
  await expectNoHorizontalScroll(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("publish-bar")).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // The menu and the link really are in what is live: the design names the page, Home's entry links it.
  const stored = await pageRow(user.pageId);
  expect(
    (stored.published as unknown as { nav?: { items?: string[] } } | null)?.nav?.items,
  ).toEqual([zebra.id]);
  await expect
    .poll(async () => {
      const rows = await subPageEntries(user.pageId);
      return rows[0]!.published;
    })
    .toBeNull();

  // 3. The live site says nothing of the page: not in the HTML, not at its address, not in the sitemap.
  const secrets = [title, "Zebra", path, zebra.id, linkLabel, link.id];
  await expect
    .poll(async () => (await rawRequest(host, "/")).body, { timeout: 20_000 })
    .toContain(homeLine);
  const hiddenHome = await rawRequest(host, "/");
  expect(hiddenHome.status).toBe(200);
  for (const secret of secrets) {
    expect(hiddenHome.body.includes(secret), `live Home must not contain "${secret}"`).toBe(false);
  }
  expect(hiddenHome.body.toLowerCase()).not.toContain("zebra");
  expect(hiddenHome.body).not.toContain("pg-menu");
  expect((await rawRequest(host, `/${path}`)).status).toBe(404);
  const hiddenSitemap = await rawRequest(host, "/sitemap.xml");
  expect(hiddenSitemap.status).toBe(200);
  expect(hiddenSitemap.body.toLowerCase()).not.toContain("zebra");

  const visitor = await context.browser()!.newContext({ viewport: page.viewportSize() });
  try {
    const tab = await visitor.newPage();
    await tab.goto(url(user.handle, "/"));
    await expect(tab.getByText(homeLine)).toBeVisible();
    await expect(tab.getByRole("link", { name: /zebra/i })).toHaveCount(0);
    await expect(tab.getByRole("button", { name: /zebra/i })).toHaveCount(0);
    await expect(tab.getByRole("link", { name: linkLabel })).toHaveCount(0);
    await expect(tab.locator("nav.pg-menu")).toHaveCount(0);
    await expect(tab.locator('[data-block-type="page_link"]')).toHaveCount(0);
    const content = await tab.content();
    for (const secret of secrets) {
      expect(content.includes(secret), `the live DOM must not contain "${secret}"`).toBe(false);
    }
    await expectNoHorizontalScroll(tab);
    const missing = await tab.goto(url(user.handle, `/${path}`));
    expect(missing?.status()).toBe(404);
    expect((await tab.content()).toLowerCase()).not.toContain("zebra");

    // 4. Publish the page: the menu link and the page-link button are back and lead to it.
    await publishRow(page, zebra.id, "Publish page");
    await expectNoHorizontalScroll(page);
    await expect
      .poll(async () => (await subPageEntries(user.pageId))[0]!.live_path, { timeout: 20_000 })
      .toBe(path);
    await expect
      .poll(async () => (await rawRequest(host, `/${path}`)).status, { timeout: 20_000 })
      .toBe(200);
    await expect
      .poll(async () => (await rawRequest(host, "/")).body.split(`href="/${path}"`).length - 1, {
        timeout: 20_000,
      })
      .toBe(2);
    expect((await rawRequest(host, "/sitemap.xml")).body).toContain(`/${path}</loc>`);

    await tab.goto(url(user.handle, "/"));
    const menuLink = tab.locator("nav.pg-menu").getByRole("link", { name: title, exact: true });
    const button = tab.locator(`a[data-block-type="page_link"]`);
    await expect(menuLink).toHaveAttribute("href", `/${path}`);
    await expect(button).toHaveText(linkLabel);
    await expect(button).toHaveAttribute("href", `/${path}`);
    await expectNoHorizontalScroll(tab);
    await menuLink.click();
    await tab.waitForURL(url(user.handle, `/${path}`));
    await expect(tab.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalScroll(tab);
    await tab.goto(url(user.handle, "/"));
    await tab.locator(`a[data-block-type="page_link"]`).click();
    await tab.waitForURL(url(user.handle, `/${path}`));
    await expect(tab.getByRole("heading", { level: 1, name: title })).toBeVisible();
  } finally {
    await visitor.close();
  }
});

/**
 * The same rule with the state written by the database functions the publish bar calls
 * (`publish_design`, `publish_site_page`), so the live site's answer is held whatever the editor
 * looks like: the design and Home go live naming a page that has no live copy, and the first request
 * the tenant host ever gets for this site must already say nothing of it. Publish (all changes) then
 * puts the page live and expires the site's cache.
 */
test("M15-11 the live site hides a page that is only named by the live design and the live Home", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const title = `Zebra ${mark}`;
  const path = `zebra-${mark}`;
  const linkLabel = `Stripes ${mark}`;
  const linkId = `pl-${mark}-0001`;
  const homeLine = `Welcome ${mark}`;
  const admin = adminClient();
  const user = await emptyUser(context, "hdb");
  const homeId = await seedHome(user.pageId);
  const host = `${user.handle}.localhost:3000`;
  const toolbar = page.getByTestId("workspace-toolbar");
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };

  // A published site, through the editor's own Publish.
  await openEditor(page);
  const header = await addBlock(page, "header");
  await header.panel.locator('[data-field="text"]').first().fill(homeLine);
  await expect
    .poll(async () => JSON.stringify((await entry(homeId)).draft.blocks))
    .toContain(homeLine);
  await toolbar.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });

  // A draft page, then the menu (design) and a page link (Home) that name it, drafts first.
  const zebraId = await addPageEntry(user.pageId, {
    path,
    title,
    blocks: [{ id: `hd-${mark}-0001`, type: "header", visible: true, text: `Inside ${mark}` }],
  });
  const site = await admin.from("pages").select("draft, published").eq("id", user.pageId).single();
  fail("reading the site", site.error);
  const nav = { show: true, items: [zebraId] };
  const draftSet = await admin
    .from("pages")
    .update({ draft: { ...(site.data!.draft as object), nav } as never })
    .eq("id", user.pageId);
  fail("writing the draft menu", draftSet.error);
  const home = await admin
    .from("content_entries")
    .select("draft, published")
    .eq("id", homeId)
    .single();
  fail("reading Home", home.error);
  const pageLink = { id: linkId, type: "page_link", visible: true, label: linkLabel, target: zebraId };
  const homeDraft = home.data!.draft as { blocks: unknown[] };
  const homeSet = await admin
    .from("content_entries")
    .update({ draft: { ...homeDraft, blocks: [...homeDraft.blocks, pageLink] } as never })
    .eq("id", homeId);
  fail("writing Home's draft", homeSet.error);

  // Publish the design and Home on their own, as the publish bar does. The page stays a draft.
  const { blocks: _frozen, ...design } = site.data!.published as Record<string, unknown>;
  const designLive = await admin.rpc("publish_design", {
    p_page_id: user.pageId,
    p_owner_id: user.id,
    p_design: { ...design, nav } as never,
  });
  fail("publish_design", designLive.error);
  const homeLive = home.data!.published as { blocks: unknown[] } & Record<string, unknown>;
  const homePublished = await admin.rpc("publish_site_page", {
    p_site_id: user.pageId,
    p_owner_id: user.id,
    p_entry_id: homeId,
    p_expected_rev: (await entry(homeId)).rev,
    p_published: { ...homeLive, blocks: [...homeLive.blocks, pageLink] } as never,
  });
  fail("publish_site_page", homePublished.error);
  expect((await subPageEntries(user.pageId))[0]).toMatchObject({ published: null, live_path: null });

  // The first request this host gets: nothing of the page, anywhere.
  const secrets = [title, "Zebra", path, zebraId, linkLabel, linkId];
  for (const address of ["/", "/sitemap.xml"]) {
    const response = await rawRequest(host, address);
    expect(response.status, address).toBe(200);
    for (const secret of secrets) {
      expect(response.body.includes(secret), `${address} must not contain "${secret}"`).toBe(false);
    }
    expect(response.body.toLowerCase(), address).not.toContain("zebra");
  }
  const hidden = await rawRequest(host, "/");
  expect(hidden.body).toContain(homeLine);
  expect(hidden.body).not.toContain("pg-menu");
  expect(hidden.body).not.toContain('data-block-type="page_link"');
  const gone = await rawRequest(host, `/${path}`);
  expect(gone.status).toBe(404);
  expect(gone.body.toLowerCase()).not.toContain("zebra");

  const visitor = await context.browser()!.newContext({ viewport: page.viewportSize() });
  try {
    const tab = await visitor.newPage();
    await tab.goto(url(user.handle, "/"));
    await expect(tab.getByText(homeLine)).toBeVisible();
    await expect(tab.getByRole("link", { name: /zebra|stripes/i })).toHaveCount(0);
    await expect(tab.getByRole("button", { name: /zebra|stripes/i })).toHaveCount(0);
    await expect(tab.locator("nav.pg-menu")).toHaveCount(0);
    const content = await tab.content();
    for (const secret of secrets) {
      expect(content.includes(secret), `the live DOM must not contain "${secret}"`).toBe(false);
    }
    await expectNoHorizontalScroll(tab);

    // Publishing the page (Publish all changes takes a page never published) brings both back.
    await reloadEditor(page);
    await toolbar.getByRole("button", { name: "Publish", exact: true }).click();
    await expect
      .poll(async () => (await subPageEntries(user.pageId))[0]!.live_path, { timeout: 30_000 })
      .toBe(path);
    await expect
      .poll(async () => (await rawRequest(host, "/")).body.split(`href="/${path}"`).length - 1, {
        timeout: 20_000,
      })
      .toBe(2);
    await tab.goto(url(user.handle, "/"));
    const menuLink = tab.locator("nav.pg-menu").getByRole("link", { name: title, exact: true });
    await expect(menuLink).toHaveAttribute("href", `/${path}`);
    const button = tab.locator('a[data-block-type="page_link"]');
    await expect(button).toHaveText(linkLabel);
    await expect(button).toHaveAttribute("href", `/${path}`);
    await expectNoHorizontalScroll(tab);
    await button.click();
    await tab.waitForURL(url(user.handle, `/${path}`));
    await expect(tab.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expectNoHorizontalScroll(tab);
    // The live page never carries the id of the page it links to, only its path.
    expect((await rawRequest(host, "/")).body).not.toContain(zebraId);
  } finally {
    await visitor.close();
  }
});
