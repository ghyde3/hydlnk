import { expect, test } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { draftWith, emptyUser, saveIndicator } from "../m2/editor-helpers";
import {
  addBlock,
  box,
  draftOf,
  expectDraft,
  openEditor,
  previewScreen,
  rowOf,
  userWithDraft,
} from "../m2/blocks-helpers";
import {
  clickRows,
  collectRequests,
  foreignHosts,
  livePage,
  markupOf,
  settled,
} from "./store-blocks-helpers";
import type { Block } from "@/lib/document";

/**
 * M9-21 on a real page and in the editor: the app store block (an App Store and a Google Play
 * badge). A page published with the secret key, the click redirect for each badge, the editor's
 * rows and the abuse cases through the owner's own JWT and the publishable key.
 */

test.afterAll(cleanupUsers);

// The first request of a route compiles it on the dev server.
test.describe.configure({ timeout: 120_000 });

const BLOCK_ID = "apps-e2e-block1";
const LINKS = [
  { id: "apps-e2e-store01", store: "appstore", url: "https://apps.apple.example/app/id0001" },
  { id: "apps-e2e-play001", store: "googleplay", url: "https://play.google.example/store/apps/x" },
];

const appsOf = (extra: Record<string, unknown> = {}): Block =>
  ({ id: BLOCK_ID, type: "apps", visible: true, links: LINKS, ...extra }) as Block;

test.describe("M9-21 the app store block on a published page", () => {
  test("M9-21 two badges: 48px tall and 150px wide, the page's colors, 44px anchors, no overflow, no third party, no destination in the markup", async ({
    page,
  }, info) => {
    const live = await livePage("ap1", () => [appsOf()]);
    const requests = collectRequests(page);
    await page.goto(live.url);
    await settled(page);
    await expectNoHorizontalScroll(page);

    const block = page.locator(`[data-block-id="${BLOCK_ID}"]`);
    await expect(block).toHaveAttribute("data-block-type", "apps");
    const badges = block.locator("a.pg-app-badge");
    await expect(badges).toHaveCount(2);
    await expect(badges.nth(0)).toHaveAttribute("data-store", "appstore");
    await expect(badges.nth(1)).toHaveAttribute("data-store", "googleplay");
    await expect(badges.nth(0)).toHaveAttribute("aria-label", "Download on the App Store");
    await expect(badges.nth(1)).toHaveAttribute("aria-label", "Get it on Google Play");
    await expect(badges.nth(0)).toHaveAttribute("href", `/r/${live.pageId}/${LINKS[0]!.id}`);
    await expect(badges.nth(1)).toHaveAttribute("href", `/r/${live.pageId}/${LINKS[1]!.id}`);
    await expect(badges.nth(0).locator(".pg-app-small")).toHaveText("Download on the");
    await expect(badges.nth(0).locator(".pg-app-name")).toHaveText("App Store");
    await expect(badges.nth(1).locator(".pg-app-small")).toHaveText("GET IT ON");
    await expect(badges.nth(1).locator(".pg-app-name")).toHaveText("Google Play");

    const rects = [await box(badges.nth(0)), await box(badges.nth(1))];
    for (const rect of rects) {
      expect(rect.height).toBeGreaterThanOrEqual(47.5);
      expect(rect.width).toBeGreaterThanOrEqual(149.5);
    }
    // Side by side or wrapped onto two rows, inside the column.
    const sideBySide = Math.abs(rects[0]!.y - rects[1]!.y) < 4;
    if (desktopOnly(info)) {
      expect(sideBySide).toBe(true);
      // Centered in the column: the pair's middle is the block's middle.
      const column = await box(block);
      expect(column.width).toBeLessThanOrEqual(480);
      const left = Math.min(rects[0]!.x, rects[1]!.x);
      const right = Math.max(rects[0]!.x + rects[0]!.width, rects[1]!.x + rects[1]!.width);
      expect(Math.abs((left + right) / 2 - (column.x + column.width / 2))).toBeLessThanOrEqual(2);
    } else {
      // 2 x 150px and a 10px gap fit in the 342px column at 390px: side by side.
      expect(sideBySide).toBe(true);
      const viewport = page.viewportSize()!;
      for (const rect of rects) expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    }

    // The badge is filled with the text color, lettered in the page color, with a 1px line in the
    // border color: no color of its own.
    const probe = await page.evaluate(() => {
      const root = document.querySelector("[data-page-root]")!;
      const el = document.createElement("i");
      el.style.cssText =
        "background:var(--t-text);color:var(--t-bg);border:1px solid var(--t-border)";
      root.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { fill: cs.backgroundColor, ink: cs.color, line: cs.borderTopColor };
      el.remove();
      return out;
    });
    for (const badge of [badges.nth(0), badges.nth(1)]) {
      const computed = await badge.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          fill: cs.backgroundColor,
          ink: cs.color,
          line: cs.borderTopColor,
          width: cs.borderTopWidth,
          style: cs.borderTopStyle,
        };
      });
      expect(computed).toMatchObject({ ...probe, width: "1px", style: "solid" });
    }
    // The mark is filled with the badge's letter color, one path.
    const mark = badges.nth(0).locator("svg.pg-app-mark");
    expect(await mark.evaluate((el) => getComputedStyle(el).fill)).toBe(probe.ink);
    expect(await mark.locator("path").count()).toBe(1);

    // Every anchor on the page is at least 44px tall.
    for (const anchor of await page.locator("a").all()) {
      if (!(await anchor.isVisible())) continue;
      expect((await box(anchor)).height, await anchor.innerText()).toBeGreaterThanOrEqual(43.5);
    }

    // Each badge's svg is at most 2 KB and the two together at most 4 KB.
    const sizes = await block
      .locator("svg.pg-app-mark")
      .evaluateAll((els) => els.map((el) => new TextEncoder().encode(el.outerHTML).length));
    for (const size of sizes) expect(size).toBeLessThanOrEqual(2048);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(4096);

    // The destinations are not in the markup; the block adds no request and no script.
    const html = await page.content();
    for (const link of LINKS) expect(html).not.toContain(new URL(link.url).host);
    expect(foreignHosts(requests, live.handle)).toEqual([]);
    expect(requests.filter((request) => /apple|google|play/i.test(new URL(request).host))).toEqual(
      [],
    );
    expect(await block.locator("script, iframe, img").count()).toBe(0);
    expect(await page.locator("script").count()).toBe(1); // the one tenant script, as on every page
  });

  test("M9-21 a page without the block carries none of its CSS; a page with it carries it", async ({
    page,
  }) => {
    const plain = await livePage("ap2", () => [
      {
        id: "link-e2e-plain1",
        type: "link",
        visible: true,
        label: "Hello",
        url: "https://example.com/",
      } as Block,
    ]);
    await page.goto(plain.url);
    await settled(page);
    expect((await page.locator("style").allTextContents()).join("")).not.toContain("pg-app");
    expect(await page.content()).not.toContain("pg-app");

    const withApps = await livePage("ap3", () => [appsOf()]);
    await page.goto(withApps.url);
    await settled(page);
    const css = (await page.locator("style").allTextContents()).join("");
    expect(css).toContain(".pg-app-badge");
    expect(css).not.toContain("pg-book");
    expect(css).not.toContain("pg-map");
  });

  test("M9-21 the order is the stored one, the same for every visitor: an iPhone and an Android user agent get the same markup", async ({
    browser,
  }) => {
    const live = await livePage("ap4", () => [appsOf({ links: [LINKS[1]!, LINKS[0]!] })]);
    const markups: string[] = [];
    for (const userAgent of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
    ]) {
      const context = await browser.newContext({ userAgent });
      const page = await context.newPage();
      await page.goto(live.url);
      await settled(page);
      markups.push(await markupOf(page.locator("body"), BLOCK_ID));
      expect(
        await page
          .locator(`[data-block-id="${BLOCK_ID}"] a`)
          .evaluateAll((els) => els.map((el) => el.getAttribute("data-store"))),
      ).toEqual(["googleplay", "appstore"]);
      await context.close();
    }
    expect(new Set(markups).size).toBe(1);
  });
});

test.describe("M9-21 the click redirect for each badge", () => {
  test("M9-21 GET /r/<pageId>/<badge id> is a 302 to the published URL with one click row each; a draft-only or removed id is a 404", async ({
    page,
  }) => {
    const live = await livePage("ap5", () => [appsOf()]);
    const draft = draftOf(live.handle, [
      appsOf({
        links: [
          ...LINKS,
          { id: "apps-e2e-draft1", store: "appstore", url: "https://draft.example/" },
        ],
      }),
    ]);
    const write = await adminClient().from("pages").update({ draft }).eq("id", live.pageId);
    expect(write.error).toBeNull();
    const other = await livePage("ap5b", () => [appsOf()]);
    const userAgent = await page.evaluate(() => navigator.userAgent);

    for (const link of LINKS) {
      const response = await page.request.get(
        `${live.url}r/${live.pageId}/${link.id}?to=https://evil.example`,
        { maxRedirects: 0, headers: { "user-agent": userAgent } },
      );
      expect(response.status(), link.store).toBe(302);
      expect(response.headers().location).toBe(link.url);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(response.headers()["set-cookie"]).toBeUndefined();
      await expect
        .poll(async () => (await clickRows(live.pageId, link.id)).length, { timeout: 15_000 })
        .toBe(1);
      expect((await clickRows(live.pageId, link.id))[0]).toMatchObject({
        type: "click",
        block_id: link.id,
      });
    }
    for (const target of [
      `${live.url}r/${live.pageId}/apps-e2e-draft1`,
      `${live.url}r/${live.pageId}/${BLOCK_ID}`,
      `${live.url}r/${live.pageId}/apps-e2e-nobody`,
      `${other.url}r/${live.pageId}/${LINKS[0]!.id}`,
    ]) {
      const response = await page.request.get(target, {
        maxRedirects: 0,
        headers: { "user-agent": userAgent },
      });
      expect(response.status(), target).toBe(404);
    }
    await page.waitForTimeout(500);
    expect(await clickRows(live.pageId, "apps-e2e-draft1")).toEqual([]);
    expect(await clickRows(live.pageId, BLOCK_ID)).toEqual([]);
  });
});

test.describe("M9-21 the editor", () => {
  test("M9-21 add an app store block: two rows at most, Move up and Move down, 44px controls at 16px, Color and Corner radius, then Publish and the page matches the preview", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "ap6");
    await openEditor(page);
    const { row, panel, id } = await addBlock(page, "apps");

    // One row at the start: App Store, an empty address.
    const rows = panel.getByRole("group");
    await expect(rows).toHaveCount(1);
    const stores = () =>
      panel
        .getByRole("combobox", { name: "Store" })
        .evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).value));
    expect(await stores()).toEqual(["appstore"]);
    expect(
      await panel
        .getByRole("combobox", { name: "Store" })
        .first()
        .locator("option")
        .allTextContents(),
    ).toEqual(["App Store", "Google Play"]);
    await rows.nth(0).locator('input[data-field="url"]').fill(LINKS[0]!.url);

    const add = panel.getByRole("button", { name: "Add store" });
    await add.click();
    await expect(rows).toHaveCount(2);
    expect(await stores()).toEqual(["appstore", "googleplay"]);
    await expect(add).toBeDisabled();
    await expect(panel.getByText("You can add up to 2 stores.")).toBeVisible();
    await rows.nth(1).locator('input[data-field="url"]').fill(LINKS[1]!.url);

    // A repeated store is named on its row before Publish says so.
    await rows.nth(1).getByRole("combobox", { name: "Store" }).selectOption("appstore");
    await expect(rows.nth(1).getByText("Each store can be added once.")).toBeVisible();
    await rows.nth(1).getByRole("combobox", { name: "Store" }).selectOption("googleplay");
    await expect(panel.getByText("Each store can be added once.")).toHaveCount(0);

    // Move down, then up: the stored order follows.
    await rows.nth(0).getByRole("button", { name: "Move down" }).click();
    expect(await stores()).toEqual(["googleplay", "appstore"]);
    await rows.nth(1).getByRole("button", { name: "Move up" }).click();
    expect(await stores()).toEqual(["appstore", "googleplay"]);
    await expect(rows.nth(0).getByRole("button", { name: "Move up" })).toBeDisabled();
    await expect(rows.nth(1).getByRole("button", { name: "Move down" })).toBeDisabled();

    // The row names the stores and counts them.
    await expect(row).toContainText("App Store, Google Play");
    await expect(row).toContainText("2 stores");

    // The style group: Color and Corner radius, and no Button style.
    const style = panel.getByTestId("override-controls");
    await expect(style.getByText("Style this block")).toBeVisible();
    const labels = await style.locator("label").allTextContents();
    expect(labels.map((label) => label.trim())).toEqual(["Color", "Corner radius"]);

    // Every control is at least 44px tall; inputs are 16px.
    const sizes = await panel.locator("button, input:not([type=file]), select").evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({
          h: el.getBoundingClientRect().height,
          font: getComputedStyle(el).fontSize,
          tag: el.tagName,
          name:
            (el as HTMLElement).innerText ||
            el.getAttribute("data-field") ||
            el.getAttribute("aria-label"),
        })),
    );
    expect(sizes.length).toBeGreaterThan(6);
    for (const size of sizes) {
      expect(size.h, `${size.tag} ${size.name}`).toBeGreaterThanOrEqual(43.5);
      if (size.tag !== "BUTTON") expect(size.font, `${size.tag} ${size.name}`).toBe("16px");
    }
    await expectNoHorizontalScroll(page);

    const draft = await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) =>
          b.id === id &&
          b.type === "apps" &&
          b.links.length === 2 &&
          b.links.every((l) => l.url !== ""),
      ),
    );
    const stored = draft.blocks.find((b) => b.id === id) as Extract<Block, { type: "apps" }>;
    expect(stored.links.map((l) => l.store)).toEqual(["appstore", "googleplay"]);
    expect(new Set([id, ...stored.links.map((l) => l.id)]).size).toBe(3);

    const inPreview = desktopOnly(info) ? await markupOf(previewScreen(page), id) : null;
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect
      .poll(
        async () =>
          (await adminClient().from("pages").select("published_at").eq("id", user.pageId).single())
            .data?.published_at,
        { timeout: 20_000 },
      )
      .not.toBeNull();
    await page.goto(url(user.handle));
    await settled(page);
    await expect(page.locator(`[data-block-id="${id}"] a.pg-app-badge`)).toHaveCount(2);
    if (inPreview !== null) expect(await markupOf(page.locator("body"), id)).toBe(inPreview);
  });

  test("M9-21 an address at a blocked site shows 'That site is blocked' under that badge's row and is not saved", async ({
    page,
    context,
  }) => {
    const domain = `ap-${rand(8)}.example`;
    const inserted = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
    expect(inserted.error).toBeNull();
    try {
      await emptyUser(context, "ap7", { draft: draftWith("x", [appsOf()]) });
      await openEditor(page);
      await rowOf(page, BLOCK_ID).locator("button[aria-expanded]").first().click();
      const item = rowOf(page, BLOCK_ID).locator(`[data-item-id="${LINKS[1]!.id}"]`);
      const field = item.locator('input[data-field="url"]');
      await field.fill(`https://play.${domain}/x`);
      await expect(item.getByText("That site is blocked. Use a different link.")).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        rowOf(page, BLOCK_ID).getByText("That site is blocked. Use a different link."),
      ).toHaveCount(1);
      await field.fill(`https://ok-${rand(4)}.example/x`);
      await expect(
        rowOf(page, BLOCK_ID).getByText("That site is blocked. Use a different link."),
      ).toHaveCount(0, { timeout: 15_000 });
      await expect(saveIndicator(page)).not.toHaveAttribute("data-save-status", "blocked");
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", domain);
    }
  });
});

test.describe("M9-21 abuse: a draft written as raw JSON with the owner's own JWT", () => {
  test("M9-21 store 'huawei', javascript: and //host are refused at Publish, each badge is named, nothing is published and no anchor is drawn", async ({
    page,
    context,
  }) => {
    const links = [
      { id: "apps-evil-lnk01", store: "huawei", url: "//evil.example" },
      { id: "apps-evil-lnk02", store: "appstore", url: "javascript:alert(1)" },
    ];
    const user = await userWithDraft(context, "ap8", (handle) =>
      draftOf(handle, [appsOf({ links })]),
    );
    // The publishable key and the owner's JWT, as curl would use them: RLS lets the owner write it.
    const client = userClient(await accessTokenFor(user.email));
    const write = await client
      .from("pages")
      .update({ draft: draftOf(user.handle, [appsOf({ links })]) })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "before publishing" })).toBeVisible();
    for (const link of links) {
      await expect(rowOf(page, BLOCK_ID).locator(`[data-item-id="${link.id}"]`)).toHaveAttribute(
        "data-invalid",
        "true",
      );
    }
    await expect(rowOf(page, BLOCK_ID).getByText("Pick App Store or Google Play.")).toBeVisible();
    const stored = await adminClient()
      .from("pages")
      .select("published, published_at")
      .eq("id", user.pageId)
      .single();
    expect(stored.data).toEqual({ published: null, published_at: null });
    const body = await (await page.request.get(url(user.handle))).text();
    expect(body).not.toContain("pg-app");
    expect(body).not.toContain("evil.example");
    expect(body).not.toContain("javascript:");
  });
});
