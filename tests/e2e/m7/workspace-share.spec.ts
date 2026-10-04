import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { emptyUser, expectDraft, pageRow } from "../m2/editor-helpers";
import { publishNow } from "../m6/share-helpers";
import { openTab, publishButton, tab } from "./workspace-helpers";

/**
 * M7-04: the Share tab. Four cards in a column (address, share card, QR code, private preview
 * links) and, on a phone, version history. The deep checks of the QR files, the share card and the
 * preview links are tests/e2e/m6/qr.spec.ts, share-card.spec.ts and pages-share-dialog.spec.ts,
 * which open /share; these cover what is new on the tab.
 */

// Publish runs a Server Action on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 120_000 });

test.afterAll(cleanupUsers);

const card = (page: Page, name: string): Locator => page.getByRole("region", { name, exact: true });
const address = (page: Page): Locator => page.getByTestId("page-address");

test.describe("M7-04 the cards", () => {
  test("M7-04 the cards in order, each with an h2 (M9-32 and M9-28 add Redirect mode and Link tracking); the Edit tab has no Share card", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    const headings = await page
      .getByRole("tabpanel")
      .getByRole("heading", { level: 2 })
      .allTextContents();
    expect(headings.slice(0, 6)).toEqual([
      "Your page address",
      "Redirect mode",
      "Share card",
      "Link tracking",
      "QR code",
      "Private preview links",
    ]);
    await openTab(page, "Edit");
    await expect(page.getByRole("heading", { level: 2, name: "Share card" })).toHaveCount(0);
    await expect(page.getByTestId("share-card")).toHaveCount(0);
  });

  test("M7-04 the address card: the address the QR code encodes, Copy link, Open page", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "s7" });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url("app") });
    await openTab(page, "Share");
    const expected = `${url(user.handle)}`;
    await expect(address(page)).toHaveText(expected);
    expect(
      await address(page).evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase()),
    ).toContain("mono");
    const copy = card(page, "Your page address").getByRole("button", { name: "Copy link" });
    expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await copy.click();
    await expect(
      card(page, "Your page address").getByRole("button", { name: "Copied" }),
    ).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Link copied." })).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    await expect(copy).toBeVisible({ timeout: 4000 });
    const open = card(page, "Your page address").getByRole("link", { name: "Open page" });
    await expect(open).toHaveAttribute("href", expected);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", /noopener/);
  });

  test("M7-04 a never-published page says so and has no link; the first Publish from the toolbar turns the address on at once", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "s7u");
    await openTab(page, "Share");
    const section = card(page, "Your page address");
    await expect(section).toContainText("Not published yet. Publish to turn this address on.");
    await expect(section.getByRole("link", { name: "Open page" })).toHaveCount(0);
    await expect(card(page, "QR code")).toContainText(
      "Publish your page first. Then you can download its QR code.",
    );
    await expect(page.getByTestId("qr-code")).toHaveCount(0);
    await expect(card(page, "QR code").getByRole("button")).toHaveCount(0);

    await publishNow(page);
    await expect(section).not.toContainText("Not published yet.");
    await expect(section.getByRole("link", { name: "Open page" })).toHaveAttribute(
      "href",
      url(user.handle),
    );
    // The QR card shows the code in the same session, with no reload.
    await expect(page.getByTestId("qr-code")).toBeVisible();
    await expect(card(page, "QR code").getByRole("button", { name: "Download PNG" })).toBeVisible();
  });

  test("M7-04 a suspended owner's QR card says the page isn't available and shows no code", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "s7s" });
    const { error } = await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", user.userId);
    expect(error).toBeNull();
    await openTab(page, "Share");
    await expect(card(page, "QR code")).toContainText("This page isn’t available right now.");
    await expect(page.getByTestId("qr-code")).toHaveCount(0);
    await expect(card(page, "QR code").getByRole("button")).toHaveCount(0);
    // Create link is disabled with the suspension's reason.
    await expect(
      card(page, "Private preview links").getByRole("button", { name: "Create link" }),
    ).toBeDisabled();
  });

  test("M7-04 the QR code is inline: 280px from 760px up, 240px on a phone, black on white", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    const code = page.getByTestId("qr-code");
    await expect(code).toHaveAttribute("role", "img");
    await expect(code).toHaveAttribute("aria-label", "QR code for your page");
    const box = (await code.boundingBox())!;
    expect(Math.round(box.width)).toBe(desktopOnly(info) ? 280 : 240);
    expect(Math.round(box.height)).toBe(Math.round(box.width));
    await expect(card(page, "QR code")).toContainText("Scan it to open your page.");
    await expect(card(page, "QR code").locator("input, textarea, select, form")).toHaveCount(0);
  });

  test("M7-04 downloading the QR files makes no network request", async ({ page, context }) => {
    const user = await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    // Let the tab's own list read finish first: only what the downloads do is counted.
    await page.waitForLoadState("networkidle");
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!/^(blob|data):/.test(request.url()) && !/fonts\.g|__nextjs_font/.test(request.url())) {
        requests.push(request.url());
      }
    });
    const png = page.waitForEvent("download");
    await card(page, "QR code").getByRole("button", { name: "Download PNG" }).click();
    expect((await png).suggestedFilename()).toBe(`${user.handle}-qr.png`);
    const svg = page.waitForEvent("download");
    await card(page, "QR code").getByRole("button", { name: "Download SVG" }).click();
    expect((await svg).suggestedFilename()).toBe(`${user.handle}-qr.svg`);
    expect(requests).toEqual([]);
  });
});

test.describe("M7-04 the toolbar's menus lead to the cards", () => {
  test("M7-04 /share#qr and /share#preview-links focus the first control of their card", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "s7" });
    await page.goto(`${url("app", "/share")}#qr`);
    await expect(card(page, "QR code").getByRole("button", { name: "Download PNG" })).toBeFocused();
    await page.goto(url("app", "/editor"));
    await page.goto(`${url("app", "/share")}#preview-links`);
    await expect(
      card(page, "Private preview links").getByRole("button", { name: "Create link" }),
    ).toBeFocused();
  });

  test("M7-04 the workspace's openShare goes from another tab and focuses the card", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the menus are in the desktop toolbar");
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Design");
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "QR code" }).click();
    await expect(tab(page, "Share")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/share#qr$/);
    await expect(card(page, "QR code").getByRole("button", { name: "Download PNG" })).toBeFocused();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByRole("menuitem", { name: /Private preview link/ }).click();
    await expect(
      card(page, "Private preview links").getByRole("button", { name: "Create link" }),
    ).toBeFocused();
  });
});

test.describe("M7-04 private preview links live on this tab only", () => {
  test("M7-04 the list is read once when the tab opens, and leaving the tab clears a shown address", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "s7" });
    const actions: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actions.push(request.headers()["next-action"]!);
      }
    });
    await openTab(page, "Share");
    await expect.poll(() => actions.length).toBe(1);
    await page.waitForTimeout(500);
    expect(actions).toHaveLength(1);

    const links = card(page, "Private preview links");
    await links.getByRole("button", { name: "Create link" }).click();
    const field = links.getByLabel("Preview link");
    await expect(field).toBeVisible();
    const token = (await field.inputValue()).slice(-43);
    await page.getByRole("tab", { name: "Edit" }).click();
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Share" }).click();
    await expect(links.getByRole("button", { name: "Create link" })).toBeVisible();
    await expect(links.getByLabel("Preview link")).toHaveCount(0);
    expect(await page.content()).not.toContain(token);
    // The link that was just created is listed, without its address.
    await expect(links.locator("[data-preview-link]")).toHaveCount(1);
  });
});

test.describe("M7-04 version history on a phone", () => {
  test("M7-04 a phone gets a 'Version history' card with a link; a Free account sees the Pro chip", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the card is below 760px");
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    const history = card(page, "Version history");
    await expect(history).toBeVisible();
    await expect(history).toContainText("Look back at what you published and restore a version.");
    const link = history.getByRole("link", { name: /^Open version history/ });
    await expect(link).toHaveAttribute("href", "/editor/history");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(link.getByText("Pro")).toBeVisible();
    // A plain click writes pending edits first, then opens the screen.
    await link.click();
    await expect(page).toHaveURL(url("app", "/editor/history"));
  });

  test("M7-04 from 760px up the card is not in the DOM", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "the card is below 760px");
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    await expect(page.getByTestId("history-card")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Version history" })).toHaveCount(0);
  });
});

test.describe("M7-04 safety and layout", () => {
  test("M7-04 a title of markup is drawn as text and runs nothing; the tab calls only the draft save, the upload route and the preview-link actions", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "s7" });
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    const calls: string[] = [];
    page.on("request", (request) => {
      const u = new URL(request.url());
      if (/\/(_next\/|__nextjs)/.test(u.pathname) || /fonts\.g/.test(u.host)) return;
      // A production build prefetches the nav links' routes (`?_rsc=`); they are not the tab's calls.
      if (u.searchParams.has("_rsc")) return;
      calls.push(`${request.method()} ${u.pathname}`);
    });
    await openTab(page, "Share");
    const evil = "<img src=x onerror=alert(1)>";
    await page.getByLabel("Title", { exact: true }).fill(evil);
    await expect(page.getByTestId("share-preview-title")).toHaveText(evil);
    await expectDraft(user.pageId, (draft) => draft.share?.title === evil);
    expect(dialogs).toBe(0);
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    const allowed =
      /^(PATCH \/rest\/v1\/pages|POST \/share|GET \/share|GET \/og|GET \/rest\/v1\/.*|.*\/api\/media.*|OPTIONS .*)$/;
    expect(calls.filter((call) => !allowed.test(call) && !call.includes("_rsc"))).toEqual([]);
    const row = await pageRow(user.pageId);
    expect(row.draft.share?.title).toBe(evil);
  });

  test("M7-04 on a phone the cards stack with 16px gutters, buttons are full width, and nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    await expectNoHorizontalScroll(page);
    for (const name of ["Your page address", "Share card", "QR code", "Private preview links"]) {
      const box = (await card(page, name).boundingBox())!;
      expect(box.x, name).toBe(16);
      expect(Math.round(box.width), name).toBe(390 - 32);
    }
    for (const button of await page
      .getByRole("tabpanel")
      .getByRole("button", { name: /^(Copy link|Download PNG|Download SVG|Create link)$/ })
      .all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.width)).toBeGreaterThanOrEqual(390 - 32 - 34);
    }
    await expectTapTargets(page);
    expect(await address(page).evaluate((el) => getComputedStyle(el).overflowWrap)).toBe(
      "anywhere",
    );
  });

  test("M7-04 at 1440px the cards sit in one column of at most 720px beside the 330px preview", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    const panel = (await page.getByRole("tabpanel").boundingBox())!;
    expect(panel.width).toBeLessThanOrEqual(720);
    const xs = new Set<number>();
    for (const name of ["Your page address", "Share card", "QR code", "Private preview links"]) {
      const box = (await card(page, name).boundingBox())!;
      xs.add(Math.round(box.x));
      expect(box.width).toBeLessThanOrEqual(720);
    }
    expect(xs.size).toBe(1);
    const preview = (await page.getByTestId("workspace-preview").boundingBox())!;
    expect(Math.round(preview.width)).toBe(330);
    expect(preview.x).toBeGreaterThanOrEqual(panel.x + panel.width);
    // 'Download PNG' and 'Download SVG' side by side; the preview-link buttons in one row.
    const png = (await card(page, "QR code")
      .getByRole("button", { name: "Download PNG" })
      .boundingBox())!;
    const svg = (await card(page, "QR code")
      .getByRole("button", { name: "Download SVG" })
      .boundingBox())!;
    expect(Math.round(png.y)).toBe(Math.round(svg.y));
  });

  test("M7-04 axe finds nothing serious on the Share tab", async ({ page, context }) => {
    await signedInUser(context, { label: "s7" });
    await openTab(page, "Share");
    expect(await axeViolations(page)).toEqual([]);
  });
});

void publishButton;
