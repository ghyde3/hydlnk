import { expect, test, type Page } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, phoneOnly, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { draftWith, emptyUser, saveIndicator } from "../m2/editor-helpers";
import {
  addBlock,
  box,
  draftOf,
  expectDraft,
  openEditor,
  previewScreen,
  rowOf,
  showView,
  userWithDraft,
} from "../m2/blocks-helpers";
import {
  eventsOf,
  ingestPage,
  randomIp,
  settledCount,
  waitForClicks,
} from "../m4/analytics-ingest-helpers";
import type { Block } from "@/lib/document";
import {
  publishFromEditor,
  publishedOf,
  settled,
  trackDialogs,
  trackViolations,
} from "./blocks-fcd-helpers";

/**
 * M9-19 on a real page: the discount-code block as the live page draws it (published with the secret
 * key), tap to copy with the one tenant script, the fallbacks (no Clipboard API, no JavaScript), the
 * shop link through /r, the editor form with the blocklist, and the abuse cases through the owner's JWT.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const ID = "discount-blk-live";
const CODE = "SAVE10";
const SHOP = "https://shop.example.test/prints";

function discount(extra: Record<string, unknown> = {}): Block {
  return {
    id: ID,
    type: "discount",
    visible: true,
    code: CODE,
    description: "10% off your first print",
    url: SHOP,
    ...extra,
  } as Block;
}

const link: Block = {
  id: "link-dsc-00001",
  type: "link",
  visible: true,
  label: "Book a session",
  url: "https://example.com/book",
};

const block = (page: Page) => page.locator(`[data-block-id="${ID}"]`);

test.describe("M9-19 the live page", () => {
  test("M9-19 a 32-character code wraps and stays selectable; Copy and Shop now are 44px tall; no sideways scroll; layout shift at most 0.05", async ({
    page,
    context,
  }, info) => {
    const code = "ABCDEFGHIJ-0123456789-KLMNOPQR-12".slice(0, 32);
    const description =
      "A hundred characters of description that sits on a few lines and wraps inside the block ok".padEnd(
        100,
        ".",
      );
    expect(code).toHaveLength(32);
    expect(description).toHaveLength(100);
    const p = await ingestPage("dc1", { blocks: [discount({ code, description }), link] });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          hadRecentInput: boolean;
          value: number;
        }[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(p.url);
    await settled(page);
    await expect(block(page)).toHaveAttribute("data-js", "");
    await expectNoHorizontalScroll(page);

    const codeEl = block(page).locator(".pg-discount-code");
    expect(await codeEl.evaluate((el) => getComputedStyle(el).overflowWrap)).toBe("anywhere");
    expect(await codeEl.evaluate((el) => getComputedStyle(el).userSelect)).toBe("all");
    const wrapper = await box(block(page));
    const codeBox = await box(codeEl);
    expect(codeBox.x + codeBox.width).toBeLessThanOrEqual(wrapper.x + wrapper.width + 0.5);
    // One tap on the code selects all of it.
    await codeEl.click();
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(code);

    for (const selector of [".pg-discount-copy", ".pg-discount-shop"]) {
      expect((await box(block(page).locator(selector))).height, selector).toBeGreaterThanOrEqual(
        43.5,
      );
    }
    await expectTapTargets(page);
    const shift = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(shift).toBeLessThanOrEqual(0.05);

    if (desktopOnly(info)) {
      expect(wrapper.width).toBeLessThanOrEqual(480);
      expect(wrapper.width).toBeGreaterThan(300);
    } else {
      expect(wrapper.width).toBeLessThanOrEqual(390);
    }
  });

  test("M9-19 tapping Copy puts the code on the clipboard, shows Copied on the button and in the status, and restores Copy after 2 seconds; no request, no event", async ({
    page,
    context,
  }) => {
    const p = await ingestPage("dc2", { blocks: [discount(), link] });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: p.origin });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url);
    await settled(page);
    const copy = block(page).locator(".pg-discount-copy");
    const status = block(page).locator(".pg-discount-status");
    await expect(copy).toBeVisible();
    await expect(copy).toHaveText("Copy");
    const eventsBefore = (await eventsOf(p.pageId)).length;
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await copy.click();
    await expect(copy).toHaveText("Copied");
    await expect(status).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
    await expect(copy).toHaveText("Copy", { timeout: 4000 });
    await expect(status).toHaveText("");
    expect(requests).toEqual([]);
    expect(await settledCount(p.pageId, 500)).toBe(eventsBefore);
  });

  test("M9-19 a double tap still copies, and the button reads Copied once and then Copy", async ({
    page,
    context,
  }) => {
    const p = await ingestPage("dc3", { blocks: [discount()] });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: p.origin });
    await page.goto(p.url);
    await settled(page);
    const copy = block(page).locator(".pg-discount-copy");
    await copy.dblclick();
    await expect(copy).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
    await expect(copy).toHaveText("Copy", { timeout: 4000 });
  });

  test("M9-19 without navigator.clipboard the code's text becomes selected and the status says what to do", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    const p = await ingestPage("dc4", { blocks: [discount()] });
    await page.goto(p.url);
    await settled(page);
    await block(page).locator(".pg-discount-copy").click();
    await expect(block(page).locator(".pg-discount-status")).toHaveText(
      "Select and copy the code.",
    );
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(CODE);
  });

  test("M9-19 Shop now goes through /r under the block's id, is counted, and the destination is not in the page", async ({
    page,
    context,
  }) => {
    const p = await ingestPage("dc5", { blocks: [discount(), link] });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url);
    await settled(page);
    const shop = block(page).locator(".pg-discount-shop");
    await expect(shop).toHaveAttribute("href", `/r/${p.pageId}/${ID}`);
    await expect(shop).toHaveText("Shop now");
    expect(await page.content()).not.toContain("shop.example.test");
    // The browser follows the 302 to the published address (nothing is fetched from it: the request is
    // only observed, and the host does not need to exist).
    await Promise.all([page.waitForRequest(SHOP), shop.click()]);
    const clicks = await waitForClicks(p.pageId, 1);
    expect(clicks.map((c) => c.block_id)).toEqual([ID]);
    const redirect = await rawRequest(p.host, `/r/${p.pageId}/${ID}`, {
      headers: {
        "x-forwarded-for": randomIp(),
        "user-agent": "Mozilla/5.0 (Macintosh) Chrome/131",
      },
    });
    expect(redirect.status).toBe(302);
    expect(redirect.location).toBe(SHOP);
  });

  test("M9-19 with no shop link there is no Shop now, and /r for the block's id is a 404", async ({
    page,
  }) => {
    const p = await ingestPage("dc6", { blocks: [discount({ url: "" })] });
    await page.goto(p.url);
    await settled(page);
    await expect(block(page).locator(".pg-discount-shop")).toHaveCount(0);
    await expect(block(page).locator(".pg-discount-code")).toHaveText(CODE);
    const res = await rawRequest(p.host, `/r/${p.pageId}/${ID}`, {
      headers: { "x-forwarded-for": randomIp() },
    });
    expect(res.status).toBe(404);
  });

  test('M9-19 a code of "><svg/onload=alert(1)> is accepted and written as text and as the data-copy value: no extra element, no dialog, no violation', async ({
    page,
    context,
  }) => {
    const dialogs = trackDialogs(page);
    const violations = await trackViolations(page);
    const code = '"><svg/onload=alert(1)>';
    const p = await ingestPage("dc7", { blocks: [discount({ code }), link] });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: p.origin });
    await page.goto(p.url);
    await settled(page);
    await expect(block(page).locator(".pg-discount-code")).toHaveText(code);
    await expect(block(page).locator(".pg-discount-copy")).toHaveAttribute("data-copy", code);
    await expect(block(page).locator("svg")).toHaveCount(0);
    expect(
      await block(page)
        .locator("*")
        .evaluateAll((els) => els.map((el) => el.tagName.toLowerCase())),
    ).toEqual(["p", "code", "button", "span", "a"]);
    await block(page).locator(".pg-discount-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await page.waitForTimeout(400);
    expect(dialogs).toEqual([]);
    expect(await violations()).toEqual([]);
  });
});

test.describe("M9-19 with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("M9-19 the code is visible and selectable, the Copy button is not shown, and Shop now still goes through /r", async ({
    page,
    context,
  }) => {
    const p = await ingestPage("dc8", { blocks: [discount(), link] });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url);
    await expect(block(page).locator(".pg-discount-code")).toBeVisible();
    await expect(block(page)).not.toHaveAttribute("data-js", "");
    await expect(block(page).locator(".pg-discount-copy")).toBeHidden();
    expect((await box(block(page).locator(".pg-discount-copy"))).width).toBeGreaterThan(40);
    // A tap selects the whole code (user-select: all), with no script.
    await block(page).locator(".pg-discount-code").click();
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(CODE);
    await Promise.all([
      page.waitForRequest(SHOP),
      block(page).locator(".pg-discount-shop").click(),
    ]);
  });
});

// The editor ---------------------------------------------------------------------------------------------------

test.describe("M9-19 the editor", () => {
  test("M9-19 the form: a mono code input, counters, the inline sentence for a space, the optional shop link; 44px and 16px", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "de1");
    await openEditor(page);
    const { row, panel } = await addBlock(page, "discount");
    const code = panel.getByLabel("Code", { exact: true });
    const description = panel.getByLabel("Description", { exact: true });
    const shop = panel.getByLabel("Shop link (optional)", { exact: true });
    await expect(panel).toContainText("0 / 32");
    await expect(panel).toContainText("0 / 100");
    for (const field of [code, description, shop]) {
      expect((await box(field)).height).toBeGreaterThanOrEqual(43.5);
      expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    }
    expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);

    await code.fill("SAVE 10");
    await expect(panel.getByText("Enter a code with no spaces.")).toBeVisible();
    await expectDraft(user.pageId, (d) => JSON.stringify(d).includes("SAVE 10"));
    await code.fill("SAVE10");
    await expect(panel.getByText("Enter a code with no spaces.")).toHaveCount(0);
    await expect(row).toContainText("SAVE10");
    await expect(row).toContainText("Discount code");
    await description.fill("10% off");
    await expect(row).toContainText("10% off");
    await expect(panel).toContainText("6 / 32");
    await expect(panel).toContainText("7 / 100");
    await shop.fill("javascript:alert(1)");
    await shop.blur();
    await expect(
      panel.getByText("Enter a full web address, like https://example.com."),
    ).toBeVisible();
    await shop.fill("https://shop.example.test/x");
    await expect(
      panel.getByText("Enter a full web address, like https://example.com."),
    ).toHaveCount(0);
    // The style group: Color, Corner radius and Border thickness.
    const style = panel.getByTestId("override-controls");
    for (const label of ["Color", "Corner radius", "Border thickness"])
      await expect(style.getByText(label, { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect((await box(panel)).width).toBeLessThanOrEqual(phoneOnly(info) ? 390 : 720);
  });

  test("M9-19 a shop link at a blocked site shows 'That site is blocked' under the field, keeps Publish off, and clears when changed", async ({
    page,
    context,
  }) => {
    const domain = `dc-${rand(8)}.example`;
    const inserted = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
    expect(inserted.error).toBeNull();
    try {
      const user = await emptyUser(context, "de2", {
        draft: draftWith("x", [discount({ url: "https://ok.example/start" })]),
      });
      await openEditor(page);
      await rowOf(page, ID).locator("button[aria-expanded]").first().click();
      const shop = rowOf(page, ID).getByLabel("Shop link (optional)", { exact: true });
      await shop.fill(`https://${domain}/x`);
      await expect(
        rowOf(page, ID).getByText("That site is blocked. Use a different link."),
      ).toBeVisible({ timeout: 15_000 });
      await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "blocked");
      await expect(
        page.getByRole("button", { name: "Publish", exact: true }).first(),
      ).toBeDisabled();
      await shop.fill("https://ok.example/fixed");
      await expect(
        rowOf(page, ID).getByText("That site is blocked. Use a different link."),
      ).toHaveCount(0);
      await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saved", {
        timeout: 15_000,
      });
      await expectDraft(
        user.pageId,
        (d) => (d.blocks[0] as { url?: string }).url === "https://ok.example/fixed",
      );
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", domain);
    }
  });

  test("M9-19 Publish re-checks the link: a domain listed after the draft was saved stops it, names the host, and the live page is left alone", async ({
    page,
    context,
  }) => {
    const late = `dl-${rand(8)}.example`;
    try {
      const user = await emptyUser(context, "de3", {
        draft: draftWith("x", [discount({ url: `https://${late}/x` })]),
      });
      await openEditor(page);
      await adminClient().from("blocked_domains").insert({ domain: late, reason: "e2e" });
      await page.getByRole("button", { name: "Publish", exact: true }).first().click();
      await expect(
        page.getByText(
          `Can’t publish. 1 link points to a blocked site: ${late}. Remove or change it.`,
        ),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        rowOf(page, ID).getByText("That site is blocked. Use a different link."),
      ).toBeVisible();
      expect(await publishedOf(user.pageId)).toEqual({ published: null, published_at: null });
    } finally {
      await adminClient().from("blocked_domains").delete().eq("domain", late);
    }
  });

  test("M9-19 after Publish the live block is the preview's, markup for markup, and the preview shows no Copy button", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "de4", (handle) =>
      draftOf(handle, [discount(), { ...link, id: "link-dsc-00002" }]),
    );
    await openEditor(page);
    await showView(page, "Preview");
    const preview = previewScreen(page);
    await expect(preview.locator(`[data-block-id="${ID}"] .pg-discount-code`)).toHaveText(CODE);
    // Not interactive for copy: the block is never marked data-js in the preview, so the button is hidden.
    await expect(preview.locator(`[data-block-id="${ID}"]`)).not.toHaveAttribute("data-js", "");
    await expect(preview.locator(`[data-block-id="${ID}"] .pg-discount-copy`)).toBeHidden();
    const inEditor = await preview
      .locator(`[data-block-id="${ID}"]`)
      .evaluate((el) => el.outerHTML);
    await showView(page, "Blocks");
    await publishFromEditor(page, user.pageId);
    // The document as the server wrote it (the script marks the live block `data-js` once it runs).
    const html = await (await page.request.get(url(user.handle))).text();
    const written = await page.evaluate(
      ({ html, id }) =>
        new DOMParser().parseFromString(html, "text/html").querySelector(`[data-block-id="${id}"]`)!
          .outerHTML,
      { html, id: ID },
    );
    expect(written).toBe(inEditor);
    if (desktopOnly(info)) {
      await page.goto(url(user.handle));
      await settled(page);
      await expect(block(page)).toHaveAttribute("data-js", "");
      await expect(block(page).locator(".pg-discount-copy")).toBeVisible();
    }
  });
});

// Abuse through the owner's JWT and the publishable key -------------------------------------------------------

test.describe("M9-19 the abuse cases", () => {
  test("M9-19 a code with a space (an HTML payload), a javascript: shop link and a 33-character code are refused at Publish, the field named", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "da1");
    const client = userClient(await accessTokenFor(user.email));
    const write = await client
      .from("pages")
      .update({
        draft: draftOf(user.handle, [
          discount({ id: "discount-bad-code", code: '"><img src=x onerror=alert(1)>', url: "" }),
          discount({ id: "discount-bad-link", url: "javascript:alert(1)" }),
          discount({ id: "discount-bad-long", code: "a".repeat(33), url: "" }),
        ]),
      })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Enter a code with no spaces.");
    // Only the first failing block opens; the others open on a tap and carry their own message.
    const badLink = rowOf(page, "discount-bad-link");
    await badLink.locator("button[aria-expanded]").first().click();
    await expect(
      badLink.getByText("Enter a full web address, like https://example.com."),
    ).toBeVisible();
    await expect(badLink.getByLabel("Shop link (optional)", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await publishedOf(user.pageId)).toEqual({ published: null, published_at: null });
    const body = await (await page.request.get(url(user.handle))).text();
    for (const text of ["pg-discount", "javascript:", "onerror"]) expect(body).not.toContain(text);
  });

  test("M9-19 a hidden discount block with a bad code and link does not stop Publish", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "da2");
    const client = userClient(await accessTokenFor(user.email));
    const write = await client
      .from("pages")
      .update({
        draft: draftOf(user.handle, [
          discount({
            id: "discount-hidden-1",
            visible: false,
            code: "a b",
            url: "javascript:alert(1)",
          }),
          { id: "header-dsc-00001", type: "header", visible: true, text: "Hello" },
        ]),
      })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();
    await openEditor(page);
    await publishFromEditor(page, user.pageId);
    expect(JSON.stringify((await publishedOf(user.pageId)).published)).not.toContain(
      "discount-hidden-1",
    );
  });
});
