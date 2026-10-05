import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient, userClient } from "../fixtures/auth";
import { axeViolations } from "../fixtures/a11y";
import {
  addPage,
  cleanupUsers,
  desktopOnly,
  phoneOnly,
  rand,
  setPlan,
  setPublished,
  signedInUser,
} from "../fixtures/data";
import { sessionOf } from "../fixtures/http";

/**
 * M1-16 .. M1-19: the signed-in app shell (sidebar, phone top bar and tab bar, page switcher, plan
 * card, user block) and the four placeholder screens. Phone project = 390x844, desktop = 1440x900;
 * tests that need a particular width are desktop-only and set their own viewport.
 */

test.afterAll(cleanupUsers);

// M7-01: the sidebar holds Editor (which covers the Design and Share tabs), Analytics and Domains;
// Settings & billing is in the account menu. The phone bar has Editor, Stats, Domains and Account.
const ROUTES = [
  { path: "/editor", label: "Editor", tab: "Editor", title: "Editor — HYDLNK" },
  { path: "/analytics", label: "Analytics", tab: "Stats", title: "Analytics — HYDLNK" },
  { path: "/domains", label: "Domains", tab: "Domains", title: "Domains — HYDLNK" },
] as const;

/** Every screen of the shell and the tab-bar item that is current on it (the sidebar's differs only on /settings). */
const SCREENS = [
  { path: "/editor", tab: "Editor" },
  { path: "/design", tab: "Editor" },
  { path: "/share", tab: "Editor" },
  { path: "/analytics", tab: "Stats" },
  { path: "/domains", tab: "Domains" },
  { path: "/settings", tab: "Account" },
] as const;

const TAB_LINKS = [
  { path: "/editor", tab: "Editor" },
  { path: "/analytics", tab: "Stats" },
  { path: "/domains", tab: "Domains" },
  { path: "/settings", tab: "Account" },
] as const;

/**
 * The shell's own <main>. The editor's live preview renders a second <main> (the renderer's block
 * list) inside it, so a bare "main" is ambiguous on /editor.
 */
const SHELL_MAIN = "body > div > main";

const INK = "rgb(28, 27, 26)";
const BRASS = "rgb(184, 145, 79)";
const LINE = "rgb(226, 223, 217)";

const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** The switcher button that is visible at the current width (the other placement is display:none). */
const switcher = (page: Page) => page.getByRole("button", { name: /^Switch site, current:/ });

/** Click a tab/link away from the left edge, where Next's dev indicator can sit over the first tab. */
async function tap(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("nothing to tap");
  await locator.click({ position: { x: box.width - 8, y: box.height / 2 } });
}

test.describe("M1-16 app shell: desktop sidebar and screen frame", () => {
  test("M1-16 sidebar geometry, logo, Page label, nav and current link", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const user = await signedInUser(context, { label: "sh" });
    await page.goto(url("app", "/editor"));

    const aside = page.getByRole("complementary");
    await expect(aside).toBeVisible();
    const box = (await aside.boundingBox())!;
    expect(box.width).toBe(240);
    expect(await css(aside, "background-color")).toBe(INK);
    expect(parseFloat(await css(aside, "min-height"))).toBeGreaterThanOrEqual(900);
    expect(box.height).toBeGreaterThanOrEqual(900);

    const logo = aside.getByRole("link", { name: "HYDLNK home" });
    await expect(logo).toHaveAttribute("href", "http://localhost:3000/");
    expect((await logo.boundingBox())!.height).toBe(44);
    const diamond = logo.locator("span").first();
    expect(await diamond.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(8);
    expect(await css(diamond, "background-color")).toBe(BRASS);
    const word = logo.getByText("HYDLNK", { exact: true });
    expect(await css(word, "font-size")).toBe("14px");
    expect(await css(word, "font-weight")).toBe("700");

    const label = aside.getByText("Page", { exact: true });
    expect(await css(label, "font-size")).toBe("11px");
    expect(await css(label, "text-transform")).toBe("uppercase");
    expect(await css(label, "font-family")).toMatch(/Geist.?Mono/);

    const nav = page.getByRole("navigation", { name: "App", exact: true });
    const links = nav.getByRole("link");
    await expect(links).toHaveText(ROUTES.map((r) => r.label));
    for (const [index, route] of ROUTES.entries()) {
      const link = links.nth(index);
      await expect(link).toHaveAttribute("href", route.path);
      expect((await link.boundingBox())!.height).toBe(44);
      expect((await link.locator("svg").boundingBox())!.width).toBe(16);
    }
    const current = nav.locator("a[aria-current='page']");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Editor");
    expect(await css(current, "color")).toBe("rgb(255, 255, 255)");
    expect(await css(current, "font-weight")).toBe("600");
    expect(await css(current, "background-color")).toBe("rgb(46, 44, 41)");
    for (const route of ROUTES.slice(1)) {
      expect(await css(nav.getByRole("link", { name: route.label }), "color")).toBe(
        "rgb(185, 180, 171)",
      );
    }
    expect(user.handle).toBeTruthy();
  });

  test("M1-16 main column header, canvas and navigation between screens", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedInUser(context, { label: "sh" });
    // The workspace's toolbar (M7-05) replaced the editor's header bar; Analytics keeps the screen header.
    await page.goto(url("app", "/analytics"));

    const header = page.locator("main > header");
    expect(await css(header, "background-color")).toBe("rgb(255, 255, 255)");
    expect(await css(header, "border-bottom-width")).toBe("1px");
    expect(await css(header, "border-bottom-color")).toBe(LINE);
    const crumb = header.locator("p");
    expect(await css(crumb, "font-size")).toBe("12px");
    expect(await css(crumb, "font-family")).toMatch(/Geist.?Mono/);
    const h1 = header.getByRole("heading", { level: 1 });
    expect(await css(h1, "font-size")).toBe("22px");
    expect(await css(h1, "font-weight")).toBe("700");
    expect(await css(page.locator("body"), "background-color")).toBe("rgb(244, 243, 240)");

    const nav = page.getByRole("navigation", { name: "App", exact: true });

    // The current link is matched by route, so it survives a redirect: "/" lands on /editor.
    await page.goto(url("app", "/"));
    await expect(page).toHaveURL(url("app", "/editor"));
    await expect(nav.locator("a[aria-current='page']")).toHaveText("Editor");
    await expect(nav.locator("a[aria-current='page']")).toHaveCount(1);

    for (const route of ROUTES) {
      await nav.getByRole("link", { name: route.label }).click();
      await expect(page).toHaveURL(url("app", route.path));
      await expect(page).toHaveTitle(route.title);
      await expect(nav.locator("a[aria-current='page']")).toHaveText(route.label);
      await expect(nav.locator("a[aria-current='page']")).toHaveCount(1);
    }

    // M7-01: Editor is current on every workspace tab and on version history; nothing is on /settings.
    for (const path of ["/design", "/share", "/editor/history"]) {
      await page.goto(url("app", path));
      await expect(nav.locator("a[aria-current='page']")).toHaveText("Editor");
      await expect(nav.locator("a[aria-current='page']")).toHaveCount(1);
    }
    await page.goto(url("app", "/settings"));
    await expect(nav.locator("a[aria-current='page']")).toHaveCount(0);
  });

  test("M1-16 breakpoint: sidebar at 760px, phone shell at 759px", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "sets its own viewport");
    await signedInUser(context, { label: "sh" });
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto(url("app", "/editor"));
    await expect(page.getByRole("complementary")).toBeVisible();
    expect(await css(page.getByRole("complementary"), "display")).not.toBe("none");
    await expect(page.getByRole("navigation", { name: "App sections" })).toBeHidden();

    await page.setViewportSize({ width: 759, height: 900 });
    expect(await css(page.locator("aside"), "display")).toBe("none");
    await expect(page.getByRole("navigation", { name: "App sections" })).toBeVisible();
  });

  test("M1-16 keyboard: nav links in order, brass focus ring, axe clean", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedInUser(context, { label: "sh" });
    await page.goto(url("app", "/editor"));

    const nav = page.getByRole("navigation", { name: "App", exact: true });
    const names = ROUTES.map((r) => r.label);
    const focusedLabel = () =>
      page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "",
      );
    let guard = 0;
    while ((await focusedLabel()) !== "Editor" && guard++ < 12) await page.keyboard.press("Tab");
    expect(await focusedLabel()).toBe("Editor");
    const focus = nav.getByRole("link", { name: "Editor" });
    expect(await css(focus, "outline-style")).toBe("solid");
    expect(await css(focus, "outline-width")).toBe("2px");
    expect(await css(focus, "outline-color")).toBe(BRASS);
    expect(await css(focus, "outline-offset")).toBe("2px");
    for (const name of names.slice(1)) {
      await page.keyboard.press("Tab");
      expect(await focusedLabel()).toBe(name);
    }

    expect(await axeViolations(page)).toEqual([]);
    await page.goto(url("app", "/settings"));
    expect(await axeViolations(page)).toEqual([]);
  });

  test("M1-16 phone: no sidebar, no horizontal scroll, 44px targets", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "sh" });
    await page.goto(url("app", "/editor"));
    await expect(page.getByRole("complementary")).toBeHidden();
    expect(await css(page.locator("aside"), "display")).toBe("none");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });

  test("M1-16 desktop: sidebar and main fill the viewport without horizontal scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedInUser(context, { label: "sh" });
    await page.goto(url("app", "/editor"));
    await expectNoHorizontalScroll(page);
    const side = (await page.getByRole("complementary").boundingBox())!;
    const main = (await page.locator(SHELL_MAIN).boundingBox())!;
    expect(side.x).toBe(0);
    expect(main.x).toBe(240);
    expect(Math.round(main.x + main.width)).toBe(1440);
  });
});

test.describe("M1-17 app shell: phone top bar and bottom tab bar", () => {
  test("M1-17 top bar and tab bar on every screen", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "sh" });

    for (const route of SCREENS) {
      await page.goto(url("app", route.path));
      await expect(page.getByRole("complementary")).toBeHidden();

      const bar = page.locator("body > div > header");
      const barBox = (await bar.boundingBox())!;
      expect(barBox.height).toBe(56);
      expect(await css(bar, "background-color")).toBe(INK);
      const logo = bar.getByRole("link", { name: "HYDLNK home" });
      const logoBox = (await logo.boundingBox())!;
      expect(logoBox.height).toBeGreaterThanOrEqual(44);
      expect(
        await logo
          .locator("span")
          .first()
          .evaluate((el) => (el as HTMLElement).offsetWidth),
      ).toBe(8);
      expect(await css(logo.getByText("HYDLNK", { exact: true }), "font-size")).toBe("13px");
      const chip = switcher(page);
      const chipBox = (await chip.boundingBox())!;
      expect(chipBox.height).toBeGreaterThanOrEqual(44);
      expect(chipBox.x).toBeGreaterThan(logoBox.x + logoBox.width);
      expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(390);

      const tabs = page.getByRole("navigation", { name: "App sections" });
      expect(await css(tabs, "position")).toBe("fixed");
      expect(await css(tabs, "bottom")).toBe("0px");
      expect(await css(tabs, "background-color")).toBe("rgb(255, 255, 255)");
      expect(await css(tabs, "border-top-width")).toBe("1px");
      expect(await css(tabs, "border-top-color")).toBe(LINE);
      const links = tabs.getByRole("link");
      await expect(links).toHaveText(TAB_LINKS.map((r) => r.tab));
      for (const [index, r] of TAB_LINKS.entries()) {
        const link = links.nth(index);
        await expect(link).toHaveAttribute("href", r.path);
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(56);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(await css(link, "font-size")).toBe("11px");
        await expect(link.locator("svg")).toHaveCount(1);
      }
      const current = tabs.locator("a[aria-current='page']");
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(route.tab);
      expect(await css(current, "font-weight")).toBe("600");
      expect(await css(current, "color")).toBe(INK);
      const marker = await css(current, "box-shadow");
      expect(marker).toContain(BRASS);
      expect(marker).toContain("0px 2px 0px");
      expect(marker).toContain("inset");
    }
  });

  test("M1-17 tab bar is fixed, respects the safe area, and content clears it", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "sh" });
    await page.setViewportSize({ width: 390, height: 420 });
    await page.goto(url("app", "/settings"));

    const tabs = page.getByRole("navigation", { name: "App sections" });
    // The tab bar itself pads its bottom edge by the safe-area inset (a notch or home indicator),
    // and the viewport meta asks for the full screen so the inset is non-zero on such devices.
    const tabBarSafeArea = await tabs.evaluate((el) => {
      const matching: string[] = [];
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            if (el.matches(rule.selectorText) && rule.style.paddingBottom.includes("env(")) {
              matching.push(rule.style.paddingBottom);
            }
          } else if ("cssRules" in rule) {
            visit((rule as CSSGroupingRule).cssRules);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          visit(sheet.cssRules);
        } catch {
          // cross-origin sheet: not ours
        }
      }
      return matching;
    });
    expect(tabBarSafeArea).toContain("env(safe-area-inset-bottom)");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
    expect(
      parseFloat(await css(page.locator(SHELL_MAIN), "padding-bottom")),
    ).toBeGreaterThanOrEqual(84);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const tabsBox = (await tabs.boundingBox())!;
    expect(Math.round(tabsBox.y + tabsBox.height)).toBe(420);
    const lastButton = page.locator("main button:visible").last();
    const buttonBox = (await lastButton.boundingBox())!;
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(tabsBox.y);
  });

  test("M1-17 tapping each tab navigates and moves the marker", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "sh" });
    await page.goto(url("app", "/editor"));
    const tabs = page.getByRole("navigation", { name: "App sections" });
    for (const route of TAB_LINKS) {
      await tap(tabs.getByRole("link", { name: route.tab }));
      await expect(page).toHaveURL(url("app", route.path));
      await expect(tabs.locator("a[aria-current='page']")).toHaveText(route.tab);
      await expect(tabs.locator("a[aria-current='page']")).toHaveCount(1);
    }
  });

  test("M1-17 phone: no horizontal scroll and 44px targets on every screen", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "sh" });
    for (const route of SCREENS) {
      await page.goto(url("app", route.path));
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page);
    }
  });

  test("M1-17 desktop hides the top bar and tab bar and shows the sidebar", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await signedInUser(context, { label: "sh" });
    await page.goto(url("app", "/editor"));
    expect(await css(page.locator("body > div > header"), "display")).toBe("none");
    expect(await css(page.locator("nav[aria-label='App sections']"), "display")).toBe("none");
    await expect(page.getByRole("complementary")).toBeVisible();
  });

  test("M1-17 phone landscape (844x390) uses the sidebar layout without a tab bar", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "sets its own viewport");
    await signedInUser(context, { label: "sh" });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(url("app", "/editor"));
    await expect(page.getByRole("complementary")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "App sections" })).toBeHidden();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M1-18 page switcher, current page, plan meter and user block", () => {
  test("M1-18 switcher button: label, state, dot colors and typography", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, {
      label: "sw",
      handle: `zq-sw-${rand(2)}`,
    });
    await setPublished(user.pageId, false);
    await page.goto(url("app", "/editor"));

    const button = switcher(page);
    await expect(button).toHaveAttribute(
      "aria-label",
      `Switch site, current: ${user.handle}.hydlnk.com`,
    );
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const dot = button.locator("[data-published]");
    expect((await dot.boundingBox())!.width).toBeCloseTo(7, 0);
    expect(await css(dot, "background-color")).toBe("rgb(169, 164, 155)");
    const text = button.locator("span").nth(1);
    expect(await css(text, "font-family")).toMatch(/Geist.?Mono/);
    expect(await css(text, "font-size")).toBe(desktopOnly(info) ? "13px" : "12px");
    if (desktopOnly(info)) {
      expect((await button.boundingBox())!.height).toBe(44);
      await expect(page.getByText("Page", { exact: true })).toBeVisible();
    } else {
      expect(await css(page.locator("body > div > header"), "background-color")).toBe(INK);
    }

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await setPublished(user.pageId, true);
    await page.reload();
    expect(await css(switcher(page).locator("[data-published]"), "background-color")).toBe(
      "rgb(111, 191, 142)",
    );
  });

  test("M1-18 menu: lists own pages, 44px items, keyboard, Escape and outside click", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "mn", plan: "pro" });
    const secondHandle = `zq-mn2-${rand()}`;
    await addPage(user.userId, secondHandle);
    await page.goto(url("app", "/editor"));

    const button = switcher(page);
    await button.click();
    const menu = page.getByRole("menu", { name: "Sites" });
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitemradio");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(items.nth(1)).toHaveAttribute("aria-checked", "false");
    await expect(items.nth(0)).toContainText(`${user.handle}.hydlnk.com`);
    await expect(items.nth(1)).toContainText(`${secondHandle}.hydlnk.com`);
    await expectTapTargets(page, "[role='menu']");

    // Arrow keys move between items; the current item has focus when the menu opens. Below the
    // pages the menu offers "New page" (M4-18; M1-18 allows it), which is part of the same cycle.
    const newPage = menu.getByRole("menuitem", { name: "New site" });
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(newPage).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(newPage).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.nth(1)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // Enter on the current item closes the menu and keeps the page.
    await button.click();
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute(
      "aria-label",
      `Switch site, current: ${user.handle}.hydlnk.com`,
    );

    // Outside click closes the menu and returns focus to the button.
    await button.click();
    await expect(menu).toBeVisible();
    // Click somewhere inert: a fixed coordinate can land on a button or an input of the real editor
    // (which then takes the focus), depending on the page's content and fonts. Scan below the menu
    // and right of the sidebar for a point whose element is not interactive.
    const inert = await page.evaluate(() => {
      const interactive =
        'a, button, input, textarea, select, label, summary, [tabindex], [role="menu"], [contenteditable]';
      for (let y = 300; y < window.innerHeight - 8; y += 24) {
        for (let x = 260; x < window.innerWidth - 8; x += 24) {
          const el = document.elementFromPoint(x, y);
          if (el && !el.closest(interactive)) return { x, y };
        }
      }
      return null;
    });
    expect(inert, "an inert point to click").not.toBeNull();
    await page.mouse.click(inert!.x, inert!.y);
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("M1-18 choosing a page sets the host-only hl-page cookie and every screen follows", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "cp", plan: "pro" });
    const secondHandle = `zq-cp2-${rand()}`;
    const secondId = await addPage(user.userId, secondHandle);
    await page.goto(url("app", "/editor"));
    // The workspace's toolbar (M7-05) shows the page's address above its name.
    const shown = (handle: string) =>
      page
        .locator("main")
        .getByText(`${handle}.hydlnk.com`, { exact: true })
        .filter({ visible: true });
    await expect(shown(user.handle).first()).toBeVisible();

    const button = switcher(page);
    await button.click();
    await page.getByRole("menuitemradio", { name: new RegExp(secondHandle) }).click();
    await expect(button).toHaveAttribute(
      "aria-label",
      `Switch site, current: ${secondHandle}.hydlnk.com`,
    );
    await expect(shown(secondHandle).first()).toBeVisible();
    await expect(shown(user.handle)).toHaveCount(0);

    const cookie = (await context.cookies(url("app"))).find((c) => c.name === "hl-page")!;
    expect(cookie.value).toBe(secondId);
    expect(cookie.domain).toBe("app.localhost");
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.path).toBe("/");
    // Never sent to tenant hosts or the root host.
    expect((await context.cookies(url(secondHandle))).map((c) => c.name)).not.toContain("hl-page");
    expect((await context.cookies(url())).map((c) => c.name)).not.toContain("hl-page");

    // The other page-scoped screen resolves the same page.
    await page.goto(url("app", "/settings"));
    await expect(page.locator("main dd", { hasText: secondHandle })).toBeVisible();
    await expect(switcher(page)).toHaveAttribute(
      "aria-label",
      `Switch site, current: ${secondHandle}.hydlnk.com`,
    );
  });

  test("M1-18 a garbage or foreign hl-page falls back to the user's own oldest page", async ({
    page,
    context,
    browser,
  }) => {
    const user = await signedInUser(context, { label: "fb", plan: "pro" });
    await addPage(user.userId, `zq-fb2-${rand()}`);
    const otherContext = await browser.newContext();
    const other = await signedInUser(otherContext, { label: "fo" });
    await otherContext.close();

    const own = `Switch site, current: ${user.handle}.hydlnk.com`;
    for (const value of ["not-a-uuid", other.pageId, "00000000-0000-4000-8000-0000000000ff"]) {
      await context.addCookies([{ name: "hl-page", value, url: url("app") }]);
      await page.goto(url("app", "/editor"));
      await expect(switcher(page)).toHaveAttribute("aria-label", own);
    }
  });

  test("M1-18 plan card follows accounts.plan and the page count", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the plan card is in the desktop sidebar");
    const user = await signedInUser(context, { label: "pl" });
    await page.goto(url("app", "/editor"));

    const card = page.getByRole("region", { name: "Plan" });
    expect(await css(card, "border-top-width")).toBe("1px");
    expect(await css(card, "border-top-color")).toBe("rgb(58, 55, 51)");
    expect(await css(card, "border-top-left-radius")).toBe("6px");
    const name = card.getByText("Free plan");
    expect(await css(name, "font-size")).toBe("13px");
    expect(await css(name, "font-weight")).toBe("600");
    const manage = card.getByRole("link", { name: "Manage" });
    await expect(manage).toHaveAttribute("href", "/settings");
    expect(await css(manage, "color")).toBe("rgb(217, 184, 119)");
    const count = card.getByText("1 of 1 sites");
    expect(await css(count, "font-size")).toBe("12px");
    expect(await css(count, "color")).toBe("rgb(169, 164, 155)");
    const track = card.locator("[data-meter-fill]").locator("..");
    expect((await track.boundingBox())!.height).toBe(4);
    expect(await css(track, "background-color")).toBe("rgb(58, 55, 51)");
    const fill = card.locator("[data-meter-fill]");
    expect(await css(fill, "background-color")).toBe(BRASS);
    expect(await fill.evaluate((el) => (el as HTMLElement).style.width)).toBe("100%");

    await setPlan(user.userId, "pro");
    await page.reload();
    await expect(card.getByText("Pro plan")).toBeVisible();
    await expect(card.getByText("1 of 3 sites")).toBeVisible();
    expect(await fill.evaluate((el) => (el as HTMLElement).style.width)).toBe("33%");

    await setPlan(user.userId, "studio");
    await page.reload();
    await expect(card.getByText("Studio plan")).toBeVisible();
    await expect(card.getByText("1 of 15 sites")).toBeVisible();
  });

  test("M1-18 the UI's plan limits match plan_limits() in the database", async () => {
    const admin = adminClient();
    const { PLAN_INFO } = await import("../../../src/lib/pages/plans");
    for (const plan of ["free", "pro", "studio"] as const) {
      const { data, error } = await admin.rpc("plan_limits", { p_plan: plan });
      expect(error).toBeNull();
      expect((data as { max_pages: number }[])[0]!.max_pages).toBe(PLAN_INFO[plan].maxPages);
    }
  });

  test("M1-18 user block: initials, email, and a 60-character email truncates", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "the user block is in the desktop sidebar");
    const user = await signedInUser(context, { label: "sh" });
    expect(user.email.startsWith("e2e-")).toBe(true);
    await page.goto(url("app", "/editor"));
    const aside = page.getByRole("complementary");
    const circle = aside.getByText("E2", { exact: true });
    const circleBox = (await circle.boundingBox())!;
    expect(circleBox.width).toBe(30);
    expect(circleBox.height).toBe(30);
    expect(parseFloat(await css(circle, "border-top-left-radius"))).toBeGreaterThanOrEqual(15);
    const email = aside.getByText(user.email, { exact: true });
    expect(await css(email, "font-size")).toBe("12px");
    expect(await css(email, "color")).toBe("rgb(169, 164, 155)");
    // The email sits beneath the name line, to the right of the circle.
    const name = aside.getByText(user.email.split("@")[0]!, { exact: true });
    expect(await css(name, "font-size")).toBe("13px");
    const emailBox = (await email.boundingBox())!;
    const nameBox = (await name.boundingBox())!;
    expect(emailBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);
    expect(emailBox.x).toBeGreaterThan(circleBox.x + circleBox.width);

    const longContext = await browser.newContext();
    const longPage = await longContext.newPage();
    const longEmail = `e2e-${"x".repeat(60 - "e2e-".length - "@example.com".length)}@example.com`;
    expect(longEmail).toHaveLength(60);
    const longUser = await signedInUser(longContext, { label: "lg", email: longEmail });
    await longPage.goto(url("app", "/editor"));
    const longAside = longPage.getByRole("complementary");
    const longText = longAside.getByText(longUser.email, { exact: true });
    expect(await css(longText, "text-overflow")).toBe("ellipsis");
    expect(await longText.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const textBox = (await longText.boundingBox())!;
    expect(textBox.x + textBox.width).toBeLessThanOrEqual(240);
    expect(await longAside.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await longContext.close();
  });

  test("M1-18 two users with different plans each see only their own plan, page and email", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "reads the desktop sidebar");
    const a = await signedInUser(context, { label: "ra" });
    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const otherPage = await otherContext.newPage();
    const b = await signedInUser(otherContext, { label: "rb", plan: "pro" });

    await page.goto(url("app", "/editor"));
    await otherPage.goto(url("app", "/editor"));
    const sideA = page.getByRole("complementary");
    const sideB = otherPage.getByRole("complementary");
    await expect(sideA.getByText("Free plan")).toBeVisible();
    await expect(sideA.getByText(a.email)).toBeVisible();
    await expect(sideA).not.toContainText(b.email);
    await expect(sideA).not.toContainText(b.handle);
    await expect(sideB.getByText("Pro plan")).toBeVisible();
    await expect(sideB.getByText(b.email)).toBeVisible();
    await expect(sideB).not.toContainText(a.email);

    // Under RLS with the publishable key and A's own JWT, only A's rows exist.
    const session = await sessionOf(context);
    const mine = userClient(session.access_token);
    const pages = await mine.from("pages").select("id, owner_id");
    expect(pages.error).toBeNull();
    expect(pages.data!.map((p) => p.id)).toEqual([a.pageId]);
    const accounts = await mine.from("accounts").select("id, plan");
    expect(accounts.data).toEqual([{ id: a.userId, plan: "free" }]);
    await otherContext.close();
  });

  test("M1-18 phone: 30-character handle truncates in the chip, the logo stays, no sidebar", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const handle = `zq-ph-${rand()}`.padEnd(30, "a");
    expect(handle).toHaveLength(30);
    await signedInUser(context, { handle });
    await page.goto(url("app", "/editor"));
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const chip = switcher(page);
    const text = chip.locator("span").nth(1);
    expect(await css(text, "text-overflow")).toBe("ellipsis");
    expect(await text.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const logo = (await page.getByRole("link", { name: "HYDLNK home" }).boundingBox())!;
    expect(logo.x).toBeGreaterThanOrEqual(0);
    expect(logo.x + logo.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(page.getByRole("region", { name: "Plan" })).toBeHidden();
    // The user block (name line and email) is part of the hidden sidebar.
    for (const line of await page.getByText(/^e2e-/).all()) await expect(line).toBeHidden();
  });

  test("M1-18 desktop: full handle in the button, menu anchored under it, plan card above user block", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const handle = `zq-dk-${rand()}`.padEnd(30, "a");
    await signedInUser(context, { handle });
    await page.goto(url("app", "/editor"));
    const button = switcher(page);
    const text = button.locator("span").nth(1);
    await expect(text).toHaveText(`${handle}.hydlnk.com`);
    expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await button.click();
    const menu = page.getByRole("menu", { name: "Sites" });
    const buttonBox = (await button.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(240);
    await page.keyboard.press("Escape");

    const aside = page.getByRole("complementary");
    const planBox = (await aside.getByRole("region", { name: "Plan" }).boundingBox())!;
    const userBox = (await aside.getByText("E2", { exact: true }).boundingBox())!;
    expect(planBox.y + planBox.height).toBeLessThanOrEqual(userBox.y);
    expect(userBox.y + userBox.height).toBeGreaterThan(900 - 40);
  });
});

// M1-19 placeholder screens: every shell screen is a real one now (/editor in Milestone 2, /design in
// Milestone 3, /analytics and /domains in Milestone 4; /settings since M1-20), so the placeholder
// checks that lived here have no screen left to run against. Each screen's own specs cover its layout.
