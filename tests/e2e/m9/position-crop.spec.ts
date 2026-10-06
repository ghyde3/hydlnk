import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { emptyUser, openEditor } from "../m2/editor-helpers";
import { halves } from "../m6/images-helpers";

/**
 * M9-08: the "Position your photo" dialog's viewfinder is react-easy-crop's. These specs cover what
 * the library adds (pinch, touch drag that leaves the page alone, a wheel that does not zoom,
 * lazy loading, no request and no CSP violation) and what must not change (the dialog's name, the
 * viewfinder's role, the live region, the 44px targets, no axe violation). The crop's output (the
 * red and blue fixtures, the 800px and JPEG or PNG rules) is covered by M6-24 in
 * tests/e2e/m6/images-position.spec.ts, which passes unchanged. Each test makes its own user.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const card = (page: Page) => page.getByTestId("profile-card");
// The Profile card holds two uploads since M9-24 (the photo and the logo): the photo's is in its own row.
const fileInput = (page: Page) =>
  card(page).getByTestId("profile-photo-row").locator('input[type="file"]');
const dialog = (page: Page) => page.getByRole("dialog", { name: "Position your photo" });
const finder = (page: Page) => page.getByTestId("position-viewfinder");
const picture = (page: Page) => page.getByTestId("position-picture");
const slider = (page: Page) => dialog(page).getByRole("slider", { name: "Zoom" });
const live = (page: Page) => page.getByTestId("position-live");

async function pick(page: Page, buffer: Buffer): Promise<void> {
  await fileInput(page).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer });
  await expect(dialog(page)).toBeVisible();
  // The picture is laid out by the library once it has loaded.
  await expect(finder(page)).toHaveAttribute("data-ready", "true");
}

/** Raw touch events through the DevTools protocol: what a finger sends. */
async function touch(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

type Point = { x: number; y: number; id: number };
const send = (
  client: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  touchPoints: Point[],
) => client.send("Input.dispatchTouchEvent", { type, touchPoints });

test.describe("M9-08 the viewfinder is the library's", () => {
  test("M9-08 the viewfinder is a focusable group named Picture position, with the hint, a circular outline and a picture that covers it", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "pc1");
    await openEditor(page);
    await pick(page, await halves(900, 500));

    const vf = finder(page);
    await expect(vf).toBeFocused();
    await expect(vf).toHaveAttribute("role", "group");
    await expect(vf).toHaveAccessibleName("Picture position");
    await expect(vf).toHaveAccessibleDescription(
      "Drag the picture to move it. Use the slider to zoom.",
    );
    await expect(vf).toHaveAttribute("data-shape", "round");
    expect(await vf.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");

    // The outline is the library's crop area, a circle in the UI tokens (surface border, ink dimming).
    const outline = page.getByTestId("position-outline");
    expect(await outline.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toMatch(
      /^(50%|\d{4,}px|3.35544e\+07px)$/,
    );
    expect(await outline.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
      "rgb(255, 255, 255)",
    );
    // It is not a second tab stop and not announced.
    await expect(outline).toHaveAttribute("aria-hidden", "true");
    expect(await outline.evaluate((el) => el.hasAttribute("tabindex"))).toBe(false);

    // The picture is never stretched and covers the viewfinder (900 x 500 in a square).
    const v = (await vf.boundingBox())!;
    const p = (await picture(page).boundingBox())!;
    expect(p.height).toBeCloseTo(v.height, 0);
    expect(p.width / p.height).toBeCloseTo(900 / 500, 1);
    expect(p.x).toBeLessThanOrEqual(v.x + 0.6);
    expect(p.x + p.width).toBeGreaterThanOrEqual(v.x + v.width - 0.6);
  });

  test("M9-08 a wheel over the dialog scrolls the dialog and does not zoom the picture", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a wheel is a desktop input");
    await emptyUser(context, "pc2");
    await openEditor(page);
    await pick(page, await halves(900, 900));
    await expect(live(page)).toHaveText("Zoom 100 percent");
    const v = (await finder(page).boundingBox())!;
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.wheel(0, -400);
    await page.mouse.wheel(0, 400);
    await expect(live(page)).toHaveText("Zoom 100 percent");
    await expect(slider(page)).toHaveValue("1");
  });

  test("M9-08 the dialog loads the library when a file is picked: the editor's first load holds none of it, and the dialog sends and breaks nothing", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "pc3");
    const seen: string[] = [];
    page.on("response", (response) => {
      if (response.url().endsWith(".js") || response.url().includes(".js?"))
        seen.push(response.url());
    });
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        ),
      );
    });
    await openEditor(page);
    await page.waitForLoadState("networkidle");

    // The library has not been evaluated: its stylesheet is injected only when the cropper mounts.
    const injected = () =>
      page
        .locator("style")
        .evaluateAll((els) =>
          els.some((el) => /reactEasyCrop_Container/.test(el.textContent ?? "")),
        );
    expect(await injected()).toBe(false);
    // On a production build the chunk is not even fetched (`next dev` lists every chunk of a client
    // module in the page, so this part needs HL_PROD_PORT, like the M8 budgets).
    if (process.env.HL_PROD_PORT) {
      expect(seen.filter((url) => /easy-crop/i.test(url))).toEqual([]);
      // A copy: each fetch below is itself a response the listener records, so the list would never end.
      for (const url of new Set(seen)) {
        const body = await page.evaluate((u) => fetch(u).then((r) => r.text()), url);
        expect(body.includes("reactEasyCrop_"), url).toBe(false);
      }
    }

    // Picking a file loads it; nothing but the picture's own object URL is requested after that.
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!/^blob:|^data:/.test(request.url()) && !/\/_next\/|__nextjs/.test(request.url())) {
        requests.push(`${request.method()} ${request.url()}`);
      }
    });
    await pick(page, await halves(600, 600));
    await slider(page).fill("2");
    await finder(page).press("ArrowLeft");
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
    // The library's stylesheet is in the page and the app host's policy did not object to it.
    expect(
      await page
        .locator("style")
        .evaluateAll((els) =>
          els.some((el) => /reactEasyCrop_Container/.test(el.textContent ?? "")),
        ),
    ).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });

  test("M9-08 axe finds no serious or critical violation with the dialog open", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "pc4");
    await openEditor(page);
    await pick(page, await halves(800, 500));
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("M9-08 touch", () => {
  test("M9-08 a two-finger pinch zooms from 1x to at least 1.5x in one gesture; the slider and the live region follow", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "pinch is the phone's input");
    await emptyUser(context, "pc5");
    await openEditor(page);
    await pick(page, await halves(900, 900));
    await expect(live(page)).toHaveText("Zoom 100 percent");
    const v = (await finder(page).boundingBox())!;
    const cx = v.x + v.width / 2;
    const cy = v.y + v.height / 2;

    const client = await touch(page);
    const pointsAt = (spread: number): Point[] => [
      { x: cx - spread, y: cy, id: 0 },
      { x: cx + spread, y: cy, id: 1 },
    ];
    await send(client, "touchStart", pointsAt(40));
    for (const spread of [50, 60, 70, 80, 90, 100, 110, 120]) {
      await send(client, "touchMove", pointsAt(spread));
    }
    await send(client, "touchEnd", []);

    // The pinch started 80px apart and ended 240px apart: three times, capped by what the library allows.
    await expect
      .poll(async () => Number(await slider(page).inputValue()))
      .toBeGreaterThanOrEqual(1.5);
    const zoom = Number(await slider(page).inputValue());
    expect(zoom).toBeLessThanOrEqual(4);
    await expect(live(page)).toHaveText(`Zoom ${Math.round(zoom * 100)} percent`);
    await expect(slider(page)).toHaveAttribute(
      "aria-valuetext",
      `${Math.round(zoom * 100)} percent`,
    );
    expect(Number(await picture(page).getAttribute("data-zoom"))).toBeCloseTo(zoom, 5);
  });

  test("M9-08 a touch drag inside the viewfinder moves the picture and leaves the page where it was", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "touch drag is the phone's input");
    await emptyUser(context, "pc6");
    await openEditor(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await pick(page, await halves(900, 900));
    await slider(page).fill("2");
    const v = (await finder(page).boundingBox())!;
    const cx = v.x + v.width / 2;
    const cy = v.y + v.height / 2;
    const before = (await picture(page).boundingBox())!;

    const client = await touch(page);
    await send(client, "touchStart", [{ x: cx, y: cy, id: 0 }]);
    for (const step of [10, 20, 30, 40, 50, 60]) {
      await send(client, "touchMove", [{ x: cx - step, y: cy - step * 1.5, id: 0 }]);
    }
    await send(client, "touchEnd", []);

    await expect
      .poll(async () => (await picture(page).boundingBox())!.x)
      .toBeLessThan(before.x - 20);
    expect((await picture(page).boundingBox())!.y).toBeLessThan(before.y - 20);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    // It still covers the viewfinder.
    const p = (await picture(page).boundingBox())!;
    expect(p.x).toBeLessThanOrEqual(v.x + 0.6);
    expect(p.y).toBeLessThanOrEqual(v.y + 0.6);
    expect(p.x + p.width).toBeGreaterThanOrEqual(v.x + v.width - 0.6);
    expect(p.y + p.height).toBeGreaterThanOrEqual(v.y + v.height - 0.6);
  });

  test("M9-08 at 390x844 the dialog is a full-height sheet, the viewfinder fills the width, nothing scrolls sideways and every control is at least 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await emptyUser(context, "pc7");
    await openEditor(page);
    await pick(page, await halves(800, 500));

    const sheet = (await dialog(page).boundingBox())!;
    expect(Math.round(sheet.height)).toBe(844);
    expect(Math.round(sheet.width)).toBe(390);
    const v = (await finder(page).boundingBox())!;
    expect(v.width).toBeGreaterThanOrEqual(300);
    expect(v.height).toBeCloseTo(v.width, 0);
    await expectNoHorizontalScroll(page);
    for (const control of [
      slider(page),
      dialog(page).getByRole("button", { name: "Reset", exact: true }),
      dialog(page).getByRole("button", { name: "Cancel", exact: true }),
      dialog(page).getByRole("button", { name: "Use photo", exact: true }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M9-08 at 1440x900 the dialog is centered, 440px wide, with a 280px viewfinder", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await emptyUser(context, "pc8");
    await openEditor(page);
    await pick(page, await halves(800, 500));
    const sheet = (await dialog(page).boundingBox())!;
    expect(Math.round(sheet.width)).toBe(440);
    expect(Math.abs(sheet.x + sheet.width / 2 - 720)).toBeLessThanOrEqual(1);
    const v = (await finder(page).boundingBox())!;
    expect([Math.round(v.width), Math.round(v.height)]).toEqual([280, 280]);
  });
});
