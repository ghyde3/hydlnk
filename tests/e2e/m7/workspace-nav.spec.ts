import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { authCookies, appRaw, cookieHeader, sessionOf } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin } from "../m5/admin-helpers";

/**
 * M7-01: one 'Editor' item in the sidebar (Edit, Design and Share are tabs of it), Settings & billing
 * and Sign out in the account menu at the bottom of the sidebar, and a four-tab phone bar.
 */

test.afterAll(cleanupUsers);

const nav = (page: Page) => page.getByRole("navigation", { name: "App", exact: true });
const accountButton = (page: Page) => page.getByRole("button", { name: "Account menu" });
const accountMenu = (page: Page) => page.getByRole("menu", { name: "Account" });
const current = (page: Page) => nav(page).locator("a[aria-current='page']");

test.describe("M7-01 sidebar: one Editor item", () => {
  test("M7-01 the sidebar holds Editor, Analytics and Domains, and Editor covers the workspace", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the sidebar is the desktop layout");
    await signedInUser(context, { label: "n7" });
    await page.goto(url("app", "/editor"));
    const links = nav(page).getByRole("link");
    await expect(links).toHaveText(["Editor", "Analytics", "Domains"]);
    for (const [index, href] of ["/editor", "/analytics", "/domains"].entries()) {
      await expect(links.nth(index)).toHaveAttribute("href", href);
      expect((await links.nth(index).boundingBox())!.height).toBe(44);
      expect((await links.nth(index).locator("svg").boundingBox())!.width).toBe(16);
    }
    await expect(nav(page).getByRole("link", { name: "Design" })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Settings & billing" })).toHaveCount(0);

    for (const path of ["/editor", "/design", "/share", "/editor/history"]) {
      await page.goto(url("app", path));
      await expect(current(page)).toHaveText("Editor");
      await expect(current(page)).toHaveCount(1);
    }
    for (const [path, label] of [
      ["/analytics", "Analytics"],
      ["/domains", "Domains"],
    ] as const) {
      await page.goto(url("app", path));
      await expect(current(page)).toHaveText(label);
    }
    await page.goto(url("app", "/settings"));
    await expect(current(page)).toHaveCount(0);

    // The current item keeps the look of M1-16: white 600 text on #2E2C29 and a brass icon.
    await page.goto(url("app", "/design"));
    const editor = nav(page).getByRole("link", { name: "Editor" });
    const style = await editor.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        color: computed.color,
        weight: computed.fontWeight,
        background: computed.backgroundColor,
        icon: getComputedStyle(el.querySelector("span")!).color,
      };
    });
    expect(style).toEqual({
      color: "rgb(255, 255, 255)",
      weight: "600",
      background: "rgb(46, 44, 41)",
      icon: "rgb(184, 145, 79)",
    });
  });

  test("M7-01 the sidebar's order from top to bottom, 240px wide, with no scroll at 900px", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the sidebar is the desktop layout");
    await signedInUser(context, { label: "n7" });
    await page.goto(url("app", "/editor"));
    const aside = page.getByRole("complementary");
    expect((await aside.boundingBox())!.width).toBe(240);
    const ys = {
      logo: (await aside.getByRole("link", { name: "HYDLNK home" }).boundingBox())!.y,
      switcher: (await aside.getByRole("button", { name: /^Switch site/ }).boundingBox())!.y,
      nav: (await nav(page).boundingBox())!.y,
      plan: (await aside.getByRole("region", { name: "Plan" }).boundingBox())!.y,
      user: (await accountButton(page).boundingBox())!.y,
    };
    expect(ys.logo).toBeLessThan(ys.switcher);
    expect(ys.switcher).toBeLessThan(ys.nav);
    expect(ys.nav).toBeLessThan(ys.plan);
    expect(ys.plan).toBeLessThan(ys.user);
    expect(await aside.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expect(page.getByRole("navigation", { name: "App sections" })).toBeHidden();
  });
});

test.describe("M7-01 account menu", () => {
  test("M7-01 the user block is one button; Enter, Space and the arrows open the menu above it", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the account menu is in the desktop sidebar");
    const user = await signedInUser(context, { label: "n7" });
    await page.goto(url("app", "/editor"));
    const button = accountButton(page);
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(button).toContainText(user.email);
    await expect(button.getByText("E2", { exact: true })).toBeVisible();

    for (const key of ["Enter", "Space", "ArrowDown", "ArrowUp"]) {
      await button.focus();
      await page.keyboard.press(key);
      const menu = accountMenu(page);
      await expect(menu, key).toBeVisible();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      const items = menu.getByRole("menuitem");
      await expect(items).toHaveText(["Settings & billing", "Sign out"]);
      // The menu sits above the block, fully inside the viewport, with 44px items.
      const menuBox = (await menu.boundingBox())!;
      const buttonBox = (await button.boundingBox())!;
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(buttonBox.y + 1);
      expect(menuBox.y).toBeGreaterThanOrEqual(0);
      for (const item of await items.all()) {
        expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(items.nth(key === "ArrowUp" ? 1 : 0)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(button).toBeFocused();
    }
  });

  test("M7-01 arrows, Home and End move; Tab stays in the menu; a click outside closes", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the account menu is in the desktop sidebar");
    await signedInUser(context, { label: "n7" });
    await page.goto(url("app", "/editor"));
    const button = accountButton(page);
    await button.click();
    const items = accountMenu(page).getByRole("menuitem");
    // M9-05: a pointer open leaves focus on the menu itself; the first arrow enters it.
    await expect(accountMenu(page)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(items.nth(0)).toBeFocused();
    // M9-05: Radix keeps focus in an open menu, so Tab does not leave it; Escape closes it.
    await page.keyboard.press("Tab");
    await expect(accountMenu(page)).toBeVisible();
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(accountMenu(page)).toBeHidden();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();

    await button.click();
    await expect(accountMenu(page)).toBeVisible();
    // A press outside closes it. Radix arms its outside-press handler a few milliseconds after the
    // menu is drawn (M9-05), so the press is made on an element (actionability waits a frame or
    // two), not a raw mouse click issued the instant the menu appears.
    await page.getByRole("heading", { name: "Profile" }).click();
    await expect(accountMenu(page)).toBeHidden();
  });

  test("M7-01 the menu stays inside a short viewport and opening it sends no request", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the account menu is in the desktop sidebar");
    await signedInUser(context, { label: "n7" });
    await page.setViewportSize({ width: 1440, height: 500 });
    await page.goto(url("app", "/editor"));
    await accountButton(page).scrollIntoViewIfNeeded();
    // Let the page settle first (fonts, the preview): only what opening the menu does is counted.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!/__nextjs|\/_next\/|fonts\.g/.test(request.url())) requests.push(request.url());
    });
    await accountButton(page).click();
    const box = (await accountMenu(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(500);
    await page.keyboard.press("Escape");
    expect(requests).toEqual([]);
  });

  test("M7-01 Settings & billing opens the settings screen and marks itself and the block as selected", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the account menu is in the desktop sidebar");
    await signedInUser(context, { label: "n7" });
    await page.goto(url("app", "/editor"));
    await expect(accountButton(page)).not.toHaveCSS("background-color", "rgb(46, 44, 41)");
    await accountButton(page).click();
    await accountMenu(page).getByRole("menuitem", { name: "Settings & billing" }).click();
    await expect(page).toHaveURL(url("app", "/settings"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings & billing");
    await expect(accountButton(page)).toHaveCSS("background-color", "rgb(46, 44, 41)");
    await accountButton(page).click();
    await expect(
      accountMenu(page).getByRole("menuitem", { name: "Settings & billing" }),
    ).toHaveAttribute("aria-current", "page");
    // The 'Sign out' button of the settings screen is still there.
    await expect(page.getByRole("main").getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("M7-01 Sign out is a POST: it ends the session and /editor then asks for sign-in", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the account menu is in the desktop sidebar");
    await signedInUser(context, { label: "n7" });
    await page.goto(url("app", "/editor"));
    // A form that posts to a Server Action: a submit button, no link, no href.
    await accountButton(page).click();
    const signOut = accountMenu(page).getByRole("menuitem", { name: "Sign out" });
    expect(await signOut.evaluate((el) => el.tagName)).toBe("BUTTON");
    expect(await signOut.getAttribute("type")).toBe("submit");
    expect(
      await signOut.evaluate((el) => el.closest("form")?.getAttribute("method") ?? "post"),
    ).toMatch(/post/i);
    expect(await signOut.getAttribute("href")).toBeNull();
    await signOut.click();
    await expect(page).toHaveURL(url("app", "/login"));
    expect(await authCookies(context)).toEqual([]);
    await page.goto(url("app", "/editor"));
    await expect(page).toHaveURL(url("app", "/login"));
  });

  test("M7-01 two users each see only their own email; a forged Origin cannot sign anyone out", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "the account menu is in the desktop sidebar");
    const a = await signedInUser(context, { label: "n7a" });
    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const otherPage = await otherContext.newPage();
    const b = await signedInUser(otherContext, { label: "n7b" });
    await page.goto(url("app", "/editor"));
    await otherPage.goto(url("app", "/editor"));
    await expect(accountButton(page)).toContainText(a.email);
    await expect(accountButton(page)).not.toContainText(b.email);
    await expect(accountButton(otherPage)).toContainText(b.email);
    await expect(accountButton(otherPage)).not.toContainText(a.email);
    await otherContext.close();

    // A cross-site POST to the app host is refused (the Server Action's own Origin check, M1-21).
    const cookies = await authCookies(context);
    const forged = await appRaw("/settings", {
      method: "POST",
      cookie: cookieHeader(cookies),
      headers: {
        origin: "http://evil.example",
        "content-type": "application/x-www-form-urlencoded",
        "next-action": "00".repeat(20),
      },
      body: "",
    });
    expect(forged.status).not.toBe(200);
    // The session is untouched.
    expect((await sessionOf(context)).access_token).toBeTruthy();
    await page.goto(url("app", "/editor"));
    await expect(page).toHaveURL(url("app", "/editor"));
  });
});

test.describe("M7-01 admin", () => {
  test("M7-01 for an admin the Admin link sits above the block and the menu has no extra item; the admin shell keeps its static block; a non-admin has no Admin link", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "the account menu is in the desktop sidebar");
    await signInAsAdmin(context, "n7adm");
    await page.goto(url("app", "/editor"));
    const aside = page.getByRole("complementary");
    const admin = aside.getByRole("link", { name: "Admin", exact: true });
    await expect(admin).toBeVisible();
    expect((await admin.boundingBox())!.y).toBeLessThan(
      (await accountButton(page).boundingBox())!.y,
    );
    await accountButton(page).click();
    await expect(accountMenu(page).getByRole("menuitem")).toHaveText([
      "Settings & billing",
      "Sign out",
    ]);
    await page.keyboard.press("Escape");

    // The admin shell renders the same block without the menu.
    await page.goto(url("app", "/admin"));
    await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
    await expect(
      page
        .getByRole("complementary")
        .getByText("E2", { exact: false })
        .or(page.getByRole("complementary").locator("div", { hasText: "@example.com" }).first()),
    ).toBeVisible();

    const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const otherPage = await otherContext.newPage();
    await signedInUser(otherContext, { label: "n7usr" });
    await otherPage.goto(url("app", "/editor"));
    await expect(otherPage.locator("a[data-admin-link]")).toHaveCount(0);
    await expect(otherPage.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    await otherContext.close();
  });
});

test.describe("M7-01 phone tab bar", () => {
  const TABS = ["Editor", "Stats", "Domains", "Account"];

  test("M7-01 four tabs in order; Editor is current on every workspace screen, Account on settings", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the tab bar is the phone layout");
    await signedInUser(context, { label: "n7" });
    const bar = page.getByRole("navigation", { name: "App sections" });
    const cases: [string, string][] = [
      ["/editor", "Editor"],
      ["/design", "Editor"],
      ["/share", "Editor"],
      ["/editor/history", "Editor"],
      ["/analytics", "Stats"],
      ["/domains", "Domains"],
      ["/settings", "Account"],
    ];
    for (const [path, expected] of cases) {
      await page.goto(url("app", path));
      await expect(bar.getByRole("link")).toHaveText(TABS);
      await expect(bar.locator("a[aria-current='page']")).toHaveText(expected);
      await expect(bar.locator("a[aria-current='page']")).toHaveCount(1);
    }
    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(page.getByRole("button", { name: "Account menu" })).toBeHidden();
    await expect(bar.getByRole("link", { name: "Design" })).toHaveCount(0);
    for (const link of await bar.getByRole("link").all()) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(56);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("M7-01 at 390 and 360px wide the labels are not clipped and nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the tab bar is the phone layout");
    await signedInUser(context, { label: "n7" });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(url("app", "/editor"));
      await expectNoHorizontalScroll(page);
      const clipped = await page
        .getByRole("navigation", { name: "App sections" })
        .getByRole("link")
        .evaluateAll((links) => links.filter((a) => a.scrollWidth > a.clientWidth + 1).length);
      expect(clipped).toBe(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("app", "/settings"));
    await expectTapTargets(page);
  });
});

test.describe("M7-01 old links keep working", () => {
  test("M7-01 /design, /share, /settings, /analytics, /domains and /editor/history answer 200; signed out they ask for sign-in", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "n7" });
    for (const path of [
      "/editor",
      "/design",
      "/share",
      "/settings",
      "/settings#plans",
      "/analytics",
      "/domains",
      "/editor/history",
    ]) {
      // No redirect, and the page opens in the browser too (a hash is not sent to the server).
      const bare = await context.request.get(url("app", path.split("#")[0]!), { maxRedirects: 0 });
      expect(bare.status(), path).toBe(200);
      await page.goto(url("app", "/"));
      await page.goto(url("app", path));
      expect(new URL(page.url()).pathname, path).toBe(path.split("#")[0]);
    }
    await context.clearCookies();
    for (const path of [
      "/editor",
      "/design",
      "/share",
      "/settings",
      "/analytics",
      "/domains",
      "/editor/history",
    ]) {
      const response = await appRaw(path);
      expect(response.status, path).toBe(307);
      expect(new URL(response.location!, "http://app.localhost:3000").pathname, path).toBe(
        "/login",
      );
    }
  });
});
