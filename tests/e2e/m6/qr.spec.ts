import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { emptyUser, openEditor } from "../m2/editor-helpers";
import { addVerifiedDomains } from "../m4/lifecycle-helpers";
import { signInAsUser } from "../m5/admin-helpers";
import { PNG_SIGNATURE, expectQrOf, ihdrOf, rasterizeSvg, readDownload } from "./qr-helpers";
import { publishNow } from "./share-helpers";

/**
 * M6-31: the QR code dialog in the editor header, on the phone (390x844) and desktop (1440x900)
 * projects. The code is made in the browser; these specs open the dialog, download both files and
 * read them back (the module grid of the PNG and of the SVG drawn into a canvas, and jsQR
 * decoding both), and check the states, the focus handling, the network log and the
 * layout. The generator itself is tests/unit/m6-share-qr.test.ts.
 */

// Publish runs a Server Action on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 120_000 });

test.afterAll(cleanupUsers);

const qrButton = (page: Page): Locator =>
  page.getByRole("button", { name: "QR code", exact: true });
const dialog = (page: Page): Locator => page.getByRole("dialog", { name: "QR code for your page" });

async function openDialog(page: Page): Promise<Locator> {
  await qrButton(page).click();
  const box = dialog(page);
  await expect(box).toBeVisible();
  return box;
}

test.describe("M6-31 the button and the dialog", () => {
  test("M6-31 the QR code button sits next to View live page, 44px tall, with no Pro chip", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "qb1" });
    await openEditor(page);

    const button = qrButton(page);
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // Next to View live page: the very next element of the header's action cluster.
    const adjacent = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("header a"))
          .find((a) => a.textContent?.trim() === "View live page")
          ?.nextElementSibling?.textContent?.trim() ?? null,
    );
    expect(adjacent).toBe("QR code");
    // On every plan: nothing in the button or the dialog says Pro.
    await expect(button.getByText("Pro")).toHaveCount(0);
    // The button's own box holds nothing but its label (the header's other controls may say Pro).
    expect((await button.innerText()).trim()).toBe("QR code");
    expect(await button.locator("*").count()).toBe(0);
    // The dialog sits inside the header: it adds no paragraph (the breadcrumb is the header's only <p>, M2-03).
    expect(await page.locator("main > header p").count()).toBe(1);
    await expectTapTargets(page, "header");
  });

  test("M6-31 opens a modal dialog with focus trapped; Escape and Close return focus to the button", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "qb2" });
    await openEditor(page);

    const box = await openDialog(page);
    await expect(box).toHaveAttribute("aria-modal", "true");
    await expect(box).toHaveAttribute("role", "dialog");
    await expect(box.getByRole("heading", { name: "QR code for your page" })).toBeVisible();

    // Tab and Shift+Tab never leave the dialog.
    const insideDialog = () => page.evaluate(() => !!document.activeElement?.closest("dialog"));
    const stops: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      expect(await insideDialog()).toBe(true);
      stops.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
    }
    expect(new Set(stops)).toEqual(new Set(["Download PNG", "Download SVG", "Close"]));
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await insideDialog()).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(qrButton(page)).toBeFocused();

    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(qrButton(page)).toBeFocused();
  });

  test("M6-31 a published page shows the code, its address and the two downloads", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qb3" });
    await openEditor(page);
    const box = await openDialog(page);

    await expect(box.getByTestId("qr-code")).toBeVisible();
    const address = box.getByTestId("qr-address");
    await expect(address).toHaveText(url(user.handle));
    const mono = await address.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
    expect(mono).toContain("mono");
    await expect(box.getByText("Scan it to open your page.")).toBeVisible();
    await expect(box.getByRole("button", { name: "Download PNG", exact: true })).toBeVisible();
    await expect(box.getByRole("button", { name: "Download SVG", exact: true })).toBeVisible();
    // The primary button is charcoal, the secondary white with a border.
    const primary = await box
      .getByRole("button", { name: "Download PNG", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(primary).toBe("rgb(28, 27, 26)");
    const secondary = await box
      .getByRole("button", { name: "Download SVG", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(secondary).toBe("rgb(255, 255, 255)");
    // No input of any kind: nothing in the dialog can change what is encoded.
    await expect(box.locator("input, textarea, select, form")).toHaveCount(0);
    // Copy rules: no please, no exclamation mark, no successfully.
    const text = await box.innerText();
    expect(text).not.toMatch(/please|successfully|!/i);
  });
});

test.describe("M6-31 the states", () => {
  test("M6-31 a page never published says to publish first, with only Close; after the first Publish the same session shows the code", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "qs1");
    await openEditor(page);
    const box = await openDialog(page);
    await expect(
      box.getByText("Publish your page first. Then you can download its QR code."),
    ).toBeVisible();
    await expect(box.getByTestId("qr-code")).toHaveCount(0);
    await expect(box.getByRole("button", { name: /Download/ })).toHaveCount(0);
    await expect(box.getByRole("button")).toHaveCount(1);
    await expect(box.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await box.getByRole("button", { name: "Close", exact: true }).click();
    await expect(box).toBeHidden();

    // No reload: Publish, then open it again.
    await publishNow(page);
    const again = await openDialog(page);
    await expect(again.getByTestId("qr-code")).toBeVisible();
    await expect(again.getByRole("button", { name: "Download PNG", exact: true })).toBeVisible();
    await expect(again.getByText("Publish your page first")).toHaveCount(0);
  });

  test("M6-31 a suspended owner sees that the page isn't available, with no code and no downloads", async ({
    page,
    context,
  }) => {
    await signInAsUser(context, "qs2", { suspended: true });
    await openEditor(page);
    const box = await openDialog(page);
    await expect(box.getByText("This page isn’t available right now.")).toBeVisible();
    await expect(box.getByTestId("qr-code")).toHaveCount(0);
    await expect(box.getByRole("button", { name: /Download/ })).toHaveCount(0);
    await expect(box.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  });
});

test.describe("M6-31 what the files hold", () => {
  test("M6-31 the PNG is 1024x1024, black on white with a quiet zone of 4, and decodes to the page's address", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qf1" });
    await openEditor(page);
    const box = await openDialog(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      box.getByRole("button", { name: "Download PNG", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${user.handle}-qr.png`);
    const png = await readDownload(download);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(ihdrOf(png)).toMatchObject({ width: 1024, height: 1024 });
    await expectQrOf(png, url(user.handle));
  });

  test("M6-31 the SVG downloads as {handle}-qr.svg and, drawn into a canvas, decodes to the same address", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qf2" });
    await openEditor(page);
    const box = await openDialog(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      box.getByRole("button", { name: "Download SVG", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${user.handle}-qr.svg`);
    const svg = readFileSync((await download.path())!, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script|<foreignObject|<image|href|style=|\son\w+=/i);

    const blank = await context.newPage();
    await blank.goto("about:blank");
    const raster = await rasterizeSvg(blank, svg);
    await blank.close();
    await expectQrOf(raster, url(user.handle));
  });

  test("M6-31 the code never changes with the page's theme: it is black on white on a dark page too", async ({
    page,
    context,
  }) => {
    // mara's seed page is dark; so is the copy a signed-in user gets.
    const user = await signedInUser(context, { label: "qf3" });
    await openEditor(page);
    const box = await openDialog(page);
    const colors = await box.getByTestId("qr-code").evaluate((svg) => ({
      rect: svg.querySelector("rect")!.getAttribute("fill"),
      path: svg.querySelector("path")!.getAttribute("fill"),
    }));
    expect(colors).toEqual({ rect: "#ffffff", path: "#000000" });
    expect(user.handle).toBeTruthy();
  });

  test("M6-31 opening the dialog and downloading both files makes no network request", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "qn1" });
    await openEditor(page);
    // Let the editor settle (autosave, previews) before counting.
    await page.waitForTimeout(800);

    const seen: string[] = [];
    page.on("request", (request) => {
      if (!/^(blob|data):/.test(request.url())) seen.push(`${request.method()} ${request.url()}`);
    });
    const box = await openDialog(page);
    await Promise.all([
      page.waitForEvent("download"),
      box.getByRole("button", { name: "Download PNG", exact: true }).click(),
    ]);
    await Promise.all([
      page.waitForEvent("download"),
      box.getByRole("button", { name: "Download SVG", exact: true }).click(),
    ]);
    await page.waitForTimeout(500);
    expect(seen).toEqual([]);
  });

  test("M6-31 there is no QR endpoint: /api/qr and /qr answer 404 on the app host", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const { authCookies, cookieHeader } = await import("../fixtures/http");
    await signedInUser(context, { label: "qn2" });
    const cookie = cookieHeader(await authCookies(context));
    for (const path of ["/api/qr", "/qr", "/api/qr?text=https://evil.example", "/api/qr/mara"]) {
      for (const method of ["GET", "POST"]) {
        const res = await rawRequest("app.localhost:3000", path, { cookie, method });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
  });
});

test.describe("M6-31 a verified custom domain", () => {
  test("M6-31 with a verified custom domain and a reload, the encoded address and the address shown become the domain", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "qd1", plan: "pro" });
    const host = `zq-qd1-${Math.random().toString(36).slice(2, 8)}.example.test`;
    await openEditor(page);
    const before = await openDialog(page);
    await expect(before.getByTestId("qr-address")).toHaveText(url(user.handle));
    await page.keyboard.press("Escape");

    await addVerifiedDomains(user.pageId, [host]);
    await page.reload();
    await openEditor(page);
    const box = await openDialog(page);
    await expect(box.getByTestId("qr-address")).toHaveText(`https://${host}/`);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      box.getByRole("button", { name: "Download PNG", exact: true }).click(),
    ]);
    // The file is still named after the handle.
    expect(download.suggestedFilename()).toBe(`${user.handle}-qr.png`);
    await expectQrOf(await readDownload(download), `https://${host}/`);
  });
});

test.describe("M6-31 phone and desktop layout", () => {
  test("M6-31 at 390x844 the sheet fits, the code is 240px, the buttons stack at 44px and a long domain wraps", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the phone layout is checked on the phone project");
    const user = await signedInUser(context, { label: "ql1", plan: "pro" });
    const host = `zq-ql1-${"a".repeat(48)}.example-long-domain-name.example.test`;
    await addVerifiedDomains(user.pageId, [host]);
    await openEditor(page);

    // The header row wraps and the button keeps 44px.
    expect((await qrButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);

    const box = await openDialog(page);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]")!;
      const rect = dialog.getBoundingClientRect();
      const svg = dialog.querySelector('[data-testid="qr-code"]')!.getBoundingClientRect();
      const buttons = Array.from(dialog.querySelectorAll("button")).map((button) => {
        const r = button.getBoundingClientRect();
        return { text: button.textContent?.trim(), top: r.top, width: r.width, height: r.height };
      });
      const address = dialog.querySelector('[data-testid="qr-address"]')!;
      return {
        dialog: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        svg: { width: svg.width, height: svg.height },
        buttons,
        address: {
          wrap: getComputedStyle(address).overflowWrap,
          right: address.getBoundingClientRect().right,
          height: address.getBoundingClientRect().height,
        },
        view: { width: window.innerWidth, height: window.innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.dialog.left).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.view.width);
    expect(geometry.dialog.top).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.bottom).toBeLessThanOrEqual(geometry.view.height);
    // Centered sheet.
    expect(
      Math.abs(geometry.dialog.left + geometry.dialog.right - geometry.view.width),
    ).toBeLessThanOrEqual(2);
    expect([geometry.svg.width, geometry.svg.height]).toEqual([240, 240]);
    const png = geometry.buttons.find((b) => b.text === "Download PNG")!;
    const svg = geometry.buttons.find((b) => b.text === "Download SVG")!;
    expect(svg.top).toBeGreaterThan(png.top + png.height - 1);
    expect(png.width).toBeGreaterThan(260);
    expect(Math.abs(png.width - svg.width)).toBeLessThanOrEqual(1);
    for (const b of geometry.buttons) expect(b.height).toBeGreaterThanOrEqual(44);
    // The long domain wraps instead of widening the sheet.
    expect(geometry.address.wrap).toBe("anywhere");
    expect(geometry.address.height).toBeGreaterThan(30);
    expect(geometry.address.right).toBeLessThanOrEqual(geometry.dialog.right);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.view.width);
    await expect(box.getByTestId("qr-address")).toHaveText(`https://${host}/`);
    await expectTapTargets(page, "dialog");
  });

  test("M6-31 at 1440x900 the dialog is centered at about 420px, the code is 280px and the downloads sit side by side", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the desktop layout is checked on the desktop project");
    await signedInUser(context, { label: "ql2" });
    await openEditor(page);
    await openDialog(page);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]")!;
      const rect = dialog.getBoundingClientRect();
      const svg = dialog.querySelector('[data-testid="qr-code"]')!.getBoundingClientRect();
      const find = (text: string) =>
        Array.from(dialog.querySelectorAll("button"))
          .find((b) => b.textContent?.trim() === text)!
          .getBoundingClientRect();
      const png = find("Download PNG");
      const svgButton = find("Download SVG");
      return {
        width: rect.width,
        center: [rect.left + rect.width / 2, rect.top + rect.height / 2],
        view: [window.innerWidth, window.innerHeight],
        svg: [svg.width, svg.height],
        png: { top: png.top, right: png.right, height: png.height },
        svgButton: { top: svgButton.top, left: svgButton.left, height: svgButton.height },
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(410);
    expect(geometry.width).toBeLessThanOrEqual(430);
    expect(Math.abs(geometry.center[0]! - geometry.view[0]! / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.center[1]! - geometry.view[1]! / 2)).toBeLessThanOrEqual(2);
    expect(geometry.svg).toEqual([280, 280]);
    expect(Math.abs(geometry.png.top - geometry.svgButton.top)).toBeLessThanOrEqual(1);
    expect(geometry.svgButton.left).toBeGreaterThan(geometry.png.right);
    expect(geometry.png.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
  });
});
