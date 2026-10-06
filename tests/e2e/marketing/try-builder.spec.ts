import { expect, test, type Locator, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";

/**
 * The try-it builder on an audience page (#try; the TikTok page, preset: Kai Brennan, Ember). It left the
 * home page in M11-01 but is still the same component: a live phone preview drawn by the real page renderer,
 * with themes to tap, style choices and blocks to add. One smoke per viewport (phone 390x844 and
 * desktop 1440x900): a theme tap restyles the preview, a block added shows up in it, nothing
 * scrolls sideways. Nothing is saved, so no test needs an account.
 */

const SIGNUP = url("app", "/signup");
const PAGE_PATH = "/link-in-bio/tiktok";

async function openBuilder(page: Page) {
  await page.goto(url(null, PAGE_PATH));
  await page.locator("#try").scrollIntoViewIfNeeded();
  // The builder's code loads as the section nears the screen; dev mode compiles it on first use.
  await expect(page.getByTestId("try-builder")).toHaveAttribute("data-try-ready", "true", {
    timeout: 45_000,
  });
}

const root = (page: Page) => page.locator("#try [data-page-root]");

async function tokens(page: Page) {
  return root(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      accent: style.getPropertyValue("--t-accent").trim(),
    };
  });
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const choice = (page: Page, label: string) =>
  page.locator("#try .try-choice").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
const blockIds = (page: Page) =>
  root(page).locator("[data-block-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
const blockTypes = (page: Page) =>
  root(page)
    .locator("[data-block-type]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-block-type")));

async function firstLinkColor(page: Page, locator: Locator = root(page).locator(".pg-link").first()) {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.describe("audience page try-it builder", () => {
  test("the first view is the phone, drawn on the server, and the builder loads on approach", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(url(null, PAGE_PATH));
    // Before the section is near the screen: the sample page is there (no JavaScript needed), the
    // controls are not.
    await expect(page.getByTestId("try-phone")).toHaveCount(1);
    await expect(root(page).locator(".pg-name")).toHaveText("Kai Brennan");
    await expect(page.getByTestId("try-builder")).toHaveCount(0);

    await page.locator("#try").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("try-builder")).toHaveAttribute("data-try-ready", "true", {
      timeout: 45_000,
    });
    await expect(page.getByTestId("try-phone")).toHaveCount(1);

    // The page inside is inert and hidden from assistive technology; only the screen takes focus.
    const page_ = page.locator("#try .try-page");
    await expect(page_).toHaveAttribute("inert", "");
    await expect(page_).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("try-screen")).toHaveAttribute("tabindex", "0");
    // The sample links cannot be tabbed to or followed.
    await page.getByTestId("try-screen").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("[data-page-root]"))).toBeNull();

    // No Supabase traffic and nothing from another host: fonts are self-hosted.
    const origin = new URL(url()).host;
    expect(requests.filter((u) => /supabase|:54321/i.test(u))).toEqual([]);
    expect(requests.map((u) => new URL(u).host).filter((host) => host !== origin)).toEqual([]);
  });

  test("tapping a theme restyles the preview", async ({ page }) => {
    await openBuilder(page);
    expect((await tokens(page)).background).not.toBe("rgb(22, 18, 14)"); // Ember, not Noir yet

    await choice(page, "Noir").click();
    await expect(page.getByTestId("try-status")).toHaveText("Noir theme applied.");
    const noir = await tokens(page);
    expect(noir.background).toBe("rgb(22, 18, 14)");
    expect(noir.accent).toBe("#C9A86A");
    // Noir's heading font is Instrument Serif, served from this site.
    expect(await root(page).locator(".pg-name").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
      /Instrument/,
    );

    await choice(page, "Ivory").click();
    expect((await tokens(page)).background).toBe("rgb(243, 238, 228)");

    // A gradient theme paints a gradient, not a flat color.
    await choice(page, "Midnight").click();
    expect((await tokens(page)).backgroundImage).toMatch(/linear-gradient/);

    await choice(page, "Paper").click();
    expect(await firstLinkColor(page)).toBe("rgb(47, 75, 154)");
    await expect(choice(page, "Paper").locator("input")).toBeChecked();
  });

  test("style choices change accent, fonts, buttons and background", async ({ page }) => {
    await openBuilder(page);
    await choice(page, "Paper").click();
    await tab(page, "Style").click();
    await expect(page.locator("#try [role='tabpanel']:not([hidden])")).toContainText("Accent color");

    await choice(page, "Red").click();
    expect(await firstLinkColor(page)).toBe("rgb(179, 38, 30)");
    expect((await tokens(page)).accent).toBe("#B3261E");

    await choice(page, "Classic").click();
    expect(await root(page).locator(".pg-name").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
      /Playfair/,
    );

    await choice(page, "Pill").click();
    await expect(root(page).locator(".pg-link").first()).toHaveCSS("border-top-left-radius", "999px");
    await choice(page, "Square").click();
    await expect(root(page).locator(".pg-link").first()).toHaveCSS("border-top-left-radius", "0px");

    await choice(page, "Gradient").click();
    expect((await tokens(page)).backgroundImage).toMatch(/linear-gradient/);

    // Taking a choice back to Default returns the theme's own look.
    await tab(page, "Style").click();
    await choice(page, "Default").first().click();
    expect(await firstLinkColor(page)).toBe("rgb(47, 75, 154)");
  });

  test("tapping a block adds it to the preview; it can move and be removed", async ({ page }) => {
    await openBuilder(page);
    await tab(page, "Blocks").click();
    const start = await blockTypes(page);
    expect([...start].sort()).toEqual(["card", "link", "link", "social"]);

    await page.locator("[data-try-add='divider']").click();
    await page.locator("[data-try-add='text']").click();
    await expect(page.getByTestId("try-status")).toContainText("Added Text. 6 blocks on the page.");
    expect(await blockTypes(page)).toEqual([...start, "divider", "text"]);
    await expect(page.getByTestId("try-count")).toHaveText("6 of 12");
    await expect(root(page).locator(".pg-text")).toBeAttached();

    // The preview follows the block just added.
    const screen = page.getByTestId("try-screen");
    await expect.poll(() => screen.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Move the first link below the second.
    const ids = await blockIds(page);
    await page.locator(`[data-try-down='${ids[1]}']`).click();
    expect(await blockIds(page)).toEqual([ids[0], ids[2], ids[1], ...ids.slice(3)]);
    await expect(page.getByTestId("try-status")).toContainText("Moved Link down. It is now 3 of 6.");
    // Moving the first row up does nothing but say so.
    // (aria-disabled, not disabled, so the button keeps focus and still answers; hence the force.)
    await page.locator(`[data-try-up='${ids[0]}']`).click({ force: true });
    expect(await blockIds(page)).toEqual([ids[0], ids[2], ids[1], ...ids.slice(3)]);
    await expect(page.getByTestId("try-status")).toHaveText(`${start[0]![0]!.toUpperCase()}${start[0]!.slice(1)} is already first.`);

    // Remove the divider: gone from the preview, and keyboard focus stays in the list.
    const divider = (await blockIds(page)).find((id) => id?.startsWith("try-divider"))!;
    await page.locator(`[data-try-remove='${divider}']`).click();
    expect(await blockTypes(page)).not.toContain("divider");
    await expect(page.getByTestId("try-count")).toHaveText("5 of 12");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-try-remove"))).not.toBeNull();

    // An image shows the renderer's placeholder, since the sample has no uploads.
    await page.locator("[data-try-add='image']").click();
    await expect(root(page).locator(".pg-placeholder")).toHaveText("Image");

    // Take every block off: focus lands on the "On your page" label, not on the page.
    while ((await blockIds(page)).length > 0) {
      await page.locator("[data-try-remove]").first().click();
    }
    await expect(page.locator("#try .try-empty")).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-try-rows-label"))).toBe(true);

    await page.getByRole("button", { name: "Start over" }).click();
    expect(await blockTypes(page)).toEqual(start);
  });

  test("a block can be added with the keyboard", async ({ page }) => {
    await openBuilder(page);
    await tab(page, "Blocks").focus();
    await page.keyboard.press("Enter");
    const grid = page.locator("[data-try-add='grid']");
    await grid.focus();
    await page.keyboard.press("Enter");
    await expect(root(page).locator("[data-block-type='grid']")).toHaveCount(1);
    // Arrow keys move between tabs.
    await tab(page, "Blocks").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Style")).toBeFocused();
    await expect(tab(page, "Style")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tab(page, "Themes")).toBeFocused();
  });

  test("the name goes on the page and into the claim link", async ({ page }) => {
    await openBuilder(page);
    const cta = page.locator("#try").getByRole("link", { name: "Claim your name to keep building" });
    await expect(cta).toHaveAttribute("href", SIGNUP);
    const field = page.locator("#try").getByLabel("Your name");
    await field.fill("Wren Haven");
    await expect(root(page).locator(".pg-name")).toHaveText("Wren Haven");
    await expect(cta).toHaveAttribute("href", `${SIGNUP}?handle=wrenhaven`);
    await field.fill("");
    await expect(root(page).locator(".pg-name")).toHaveText("Kai Brennan");
    await expect(cta).toHaveAttribute("href", SIGNUP);
  });

  test("no horizontal scroll, 44px targets and no accessibility violations on every tab", async ({
    page,
  }) => {
    await openBuilder(page);
    for (const name of ["Themes", "Style", "Blocks"]) {
      await tab(page, name).click();
      if (name === "Blocks") {
        for (const kind of ["header", "grid", "embed", "social", "card", "text"]) {
          await page.locator(`[data-try-add='${kind}']`).click();
        }
      }
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "#try");
      expect(await axeViolations(page), name).toEqual([]);
    }
  });

  test("phone: the preview sits above the controls, wide enough for the regular layout", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "phone project only");
    await openBuilder(page);
    const phone = (await page.getByTestId("try-phone").boundingBox())!;
    const tabs = (await page.getByRole("tablist").boundingBox())!;
    expect(phone.y).toBeLessThan(tabs.y);
    expect(phone.width).toBeLessThanOrEqual(390 - 24);
    // The screen is wide enough for the renderer's regular layout (320px and up).
    expect((await page.getByTestId("try-screen").boundingBox())!.width).toBeGreaterThanOrEqual(320);
  });

  test("desktop: the phone is a column to the right of the controls", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop project only");
    await openBuilder(page);
    const phone = (await page.getByTestId("try-phone").boundingBox())!;
    const tabs = (await page.getByRole("tablist").boundingBox())!;
    expect(phone.x).toBeGreaterThan(tabs.x + tabs.width);
    expect(Math.abs(phone.y - (await page.locator("#try .try-panel").boundingBox())!.y)).toBeLessThan(2);
  });
});
