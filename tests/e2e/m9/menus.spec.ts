import { expect, test, type Locator, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { pageRow, setDraft } from "../m2/editor-helpers";
import {
  box,
  displayName,
  openTab,
  saveStatus,
  textBlocks,
  toolbar,
  undoButton,
} from "../m7/toolbar-helpers";

/**
 * M9-05: the Preview menu, the ⋯ menu (More actions) and the account menu are Radix dropdown menus.
 * The behaviors that were M7-05 and M7-01 (the items and links) are in those specs; these cover
 * what Radix adds or changes: the three menus' keyboard and pointer behavior, a menu that is not
 * modal and moves nothing, the panel in a portal that Radix positions, Escape consumed by the menu,
 * no request or edit on opening, axe, and the phone's missing menus. Each test makes its own user.
 */

test.afterAll(cleanupUsers);

const previewButton = (page: Page) =>
  toolbar(page).getByRole("button", { name: "Preview", exact: true });
const moreButton = (page: Page) => toolbar(page).getByRole("button", { name: "More actions" });
const accountButton = (page: Page) => page.getByRole("button", { name: "Account menu" });
const menu = (page: Page, name: string) => page.getByRole("menu", { name, exact: true });

interface MenuCase {
  name: string;
  trigger: (page: Page) => Locator;
  items: string[];
  /** Typing this letter jumps to the item that starts with it. */
  letter: string;
  jumpsTo: number;
}

const CASES: MenuCase[] = [
  {
    name: "Preview",
    trigger: previewButton,
    items: ["Preview your draft", "View live page", "Private preview link…"],
    letter: "p",
    jumpsTo: 2,
  },
  {
    name: "More actions",
    trigger: moreButton,
    items: ["QR code", "Version history"],
    letter: "v",
    jumpsTo: 1,
  },
  {
    name: "Account",
    trigger: accountButton,
    items: ["Settings & billing", "Sign out"],
    letter: "s",
    jumpsTo: 1,
  },
];

test.describe("M9-05 the three menus at 1440x900", () => {
  test.beforeEach(({}, info) => {
    test.skip(!desktopOnly(info), "the menus are the desktop's; a phone has none");
  });

  for (const c of CASES) {
    test(`M9-05 ${c.name}: a menu button, items of at least 44px, Enter, Space and ArrowDown open it on the first item and ArrowUp on the last, a pointer open leaves focus on the menu`, async ({
      page,
      context,
    }) => {
      await signedInUser(context, { label: "m9a" });
      await openTab(page, "Edit");
      const button = c.trigger(page);
      const panel = menu(page, c.name);
      const items = panel.getByRole("menuitem");

      await expect(button).toHaveAttribute("aria-haspopup", "menu");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(button).not.toHaveAttribute("aria-controls", /.+/);
      await expect(panel).toHaveCount(0);

      for (const [name, index] of [
        ["Enter", 0],
        ["Space", 0],
        ["ArrowDown", 0],
        ["ArrowUp", c.items.length - 1],
      ] as const) {
        await button.focus();
        await page.keyboard.press(name);
        await expect(panel, name).toBeVisible();
        await expect(button).toHaveAttribute("aria-expanded", "true");
        await expect(button).toHaveAttribute("aria-controls", /.+/);
        await expect(items).toHaveText(c.items.map((text) => new RegExp(`^${text}`)));
        await expect(items.nth(index), name).toBeFocused();
        for (let i = 0; i < c.items.length; i++) {
          expect((await box(items.nth(i))).height).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);
        await expect(button).toBeFocused();
      }

      // A pointer open leaves focus on the menu itself; the first arrow enters it.
      await button.click();
      await expect(panel).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(items.first()).toBeFocused();
    });

    test(`M9-05 ${c.name}: the arrows move and wrap, Home and End jump, a letter jumps, Escape and a press outside close it, Tab stays`, async ({
      page,
      context,
    }) => {
      await signedInUser(context, { label: "m9b" });
      await openTab(page, "Edit");
      const button = c.trigger(page);
      const panel = menu(page, c.name);
      const items = panel.getByRole("menuitem");
      const last = c.items.length - 1;

      await button.focus();
      await page.keyboard.press("Enter");
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(items.nth(last)).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(items.nth(last)).toBeFocused();
      await page.keyboard.press("Home");
      await expect(items.first()).toBeFocused();
      // Typing a letter jumps to the item that starts with it.
      await page.keyboard.press(c.letter);
      await expect(items.nth(c.jumpsTo)).toBeFocused();
      // Tab does not leave an open menu.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(panel).toBeVisible();
      await expect(items.nth(c.jumpsTo)).toBeFocused();
      // Escape closes it and returns focus at once: the next key reaches the button.
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowDown");
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);

      // A press outside closes it (on an element: Radix arms its outside-press handler a moment after the menu is drawn).
      await button.click();
      await expect(panel).toBeVisible();
      await page.getByRole("heading", { name: "Profile" }).click();
      await expect(panel).toHaveCount(0);
      await expect(button).toHaveAttribute("aria-expanded", "false");

      // The toggle: pressing the button again closes it.
      await button.click();
      await expect(panel).toBeVisible();
      await button.click();
      await expect(panel).toHaveCount(0);
    });

    test(`M9-05 ${c.name}: the panel is a body-level portal of 6px corners, named for what it is, and axe finds nothing serious with it open`, async ({
      page,
      context,
    }) => {
      await signedInUser(context, { label: "m9c" });
      await openTab(page, "Edit");
      await c.trigger(page).click();
      const panel = menu(page, c.name);
      await expect(panel).toBeVisible();
      const info = await panel.evaluate((el) => ({
        wrapperParentIsBody:
          el.closest("[data-radix-popper-content-wrapper]")?.parentElement === document.body,
        radius: getComputedStyle(el).borderTopLeftRadius,
        width: el.getBoundingClientRect().width,
        labelledby: el.getAttribute("aria-labelledby"),
      }));
      expect(info.wrapperParentIsBody).toBe(true);
      expect(info.radius).toBe("6px");
      expect(info.labelledby).toBeNull();
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("M9-05 opening a menu changes no draft, adds no undo step and sends no request", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "m9d" });
    await openTab(page, "Edit");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const before = JSON.stringify((await pageRow(user.pageId)).draft);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!/__nextjs|\/_next\/|fonts\.g|^data:|^blob:/.test(request.url()))
        requests.push(`${request.method()} ${request.url()}`);
    });
    for (const c of CASES) {
      await c.trigger(page).click();
      await expect(menu(page, c.name)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu(page, c.name)).toHaveCount(0);
    }
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(saveStatus(page)).toHaveAttribute("data-save-status", "idle");
    expect(requests).toEqual([]);
    expect(JSON.stringify((await pageRow(user.pageId)).draft)).toBe(before);
  });

  test("M9-05 Escape inside an open menu does not cancel a rename the page-name field holds", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "m9e" });
    await openTab(page, "Edit");
    await page.getByRole("button", { name: "Rename page" }).click();
    const field = page.getByRole("textbox", { name: /page name|name/i }).first();
    await expect(field).toBeVisible();
    await field.fill("A name not saved yet");
    // The rename form covers the toolbar's row, so the menu is opened from the keyboard.
    await previewButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page, "Preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page, "Preview")).toHaveCount(0);
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("A name not saved yet");
  });
});

test.describe("M9-05 not modal, no page shift", () => {
  test.beforeEach(({}, info) => {
    test.skip(!desktopOnly(info), "the menus are the desktop's");
  });

  test("M9-05 the toolbar, the content column and the preview bezel do not move when each menu opens; with 30 blocks scrolled 800px the toolbar's top stays 0", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "m9f" });
    const row = await pageRow(user.pageId);
    await setDraft(user.pageId, { ...row.draft, blocks: textBlocks(30) });
    await openTab(page, "Edit");
    const column = page.getByRole("main").first();
    const bezel = page.getByTestId("preview-bezel");
    const shape = async () => ({
      toolbar: await box(toolbar(page)),
      column: await box(column),
      bezel: await box(bezel),
    });
    const same = (
      a: { x: number; y: number; width: number; height: number },
      b: typeof a,
      label: string,
    ) => {
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(a[key] - b[key]), `${label} ${key}`).toBeLessThanOrEqual(0.5);
      }
    };
    const before = await shape();
    for (const c of CASES) {
      await c.trigger(page).click();
      await expect(menu(page, c.name)).toBeVisible();
      const open = await shape();
      same(before.toolbar, open.toolbar, `${c.name} toolbar`);
      same(before.column, open.column, `${c.name} column`);
      same(before.bezel, open.bezel, `${c.name} bezel`);
      // Nothing is locked: no scroll lock, no padding, no inert page.
      const body = await page.evaluate(() => ({
        overflow: getComputedStyle(document.body).overflow,
        paddingRight: getComputedStyle(document.body).paddingRight,
        pointerEvents: getComputedStyle(document.body).pointerEvents,
        locked: document.body.hasAttribute("data-scroll-locked"),
        hidden: document.querySelectorAll("[aria-hidden='true'][data-aria-hidden]").length,
      }));
      expect(body.locked).toBe(false);
      expect(body.pointerEvents).not.toBe("none");
      expect(body.paddingRight).toBe("0px");
      expect(body.hidden).toBe(0);
      await page.keyboard.press("Escape");
      await expect(menu(page, c.name)).toHaveCount(0);
    }

    // Scrolled 800px down, with a menu open: the toolbar is still pinned at the top of the screen.
    await page.evaluate(() => window.scrollTo(0, 800));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(700);
    const scrolled = await page.evaluate(() => window.scrollY);
    for (const c of CASES.slice(0, 2)) {
      // A raw press at the button: Playwright's own click (and focus()) scroll a sticky element to
      // where it sits in the flow, which moves the page for reasons that have nothing to do with the menu.
      const at = await box(c.trigger(page));
      await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
      await expect(menu(page, c.name)).toBeVisible();
      expect((await box(toolbar(page))).y).toBe(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
      await page.keyboard.press("Escape");
    }
  });

  test("M9-05 Preview and More actions open under their buttons aligned to the end, inside the viewport, 240px wide", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "m9g" });
    await openTab(page, "Edit");
    for (const c of CASES.slice(0, 2)) {
      await c.trigger(page).click();
      const panel = menu(page, c.name);
      await expect(panel).toBeVisible();
      const m = await box(panel);
      const b = await box(c.trigger(page));
      expect(m.y).toBeGreaterThanOrEqual(b.y + b.height);
      expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThanOrEqual(1);
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(1440);
      expect(Math.round(m.width)).toBe(240);
      await page.keyboard.press("Escape");
    }
  });

  test("M9-05 the account menu opens above the user block, as wide as it, and stays inside the viewport at 1440x900 and at 1440x500", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "m9h" });
    for (const height of [900, 500]) {
      await page.setViewportSize({ width: 1440, height });
      await page.goto(url("app", "/editor"));
      await accountButton(page).scrollIntoViewIfNeeded();
      await page.waitForLoadState("networkidle");
      await accountButton(page).click();
      const panel = menu(page, "Account");
      await expect(panel).toBeVisible();
      const m = await box(panel);
      const b = await box(accountButton(page));
      expect(m.y + m.height, `${height}: above the block`).toBeLessThanOrEqual(b.y + 1);
      expect(Math.abs(m.width - b.width), `${height}: as wide as the block`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.x - b.x)).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(1440);
      expect(m.y + m.height).toBeLessThanOrEqual(height);
      expect(await axeViolations(page)).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });

  test("M9-05 choosing an item closes the menu: Version history leaves, Private preview link goes to Create link, Settings & billing goes to /settings", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "m9i" });
    await openTab(page, "Edit");
    await previewButton(page).click();
    await menu(page, "Preview").getByRole("menuitem", { name: "Private preview link…" }).click();
    await expect(menu(page, "Preview")).toHaveCount(0);
    await expect(page).toHaveURL(/\/share#preview-links$/);
    await expect(page.getByRole("button", { name: "Create link" })).toBeFocused();

    await accountButton(page).click();
    await menu(page, "Account").getByRole("menuitem", { name: "Settings & billing" }).click();
    await expect(menu(page, "Account")).toHaveCount(0);
    await expect(page).toHaveURL(url("app", "/settings"));
    await accountButton(page).click();
    await expect(
      menu(page, "Account").getByRole("menuitem", { name: "Settings & billing" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("M9-05 the phone", () => {
  test("M9-05 at 390x844 there is no Preview, no ⋯ and no account menu, nothing scrolls sideways and every button, input and link is at least 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await signedInUser(context, { label: "m9p" });
    await openTab(page, "Edit");
    await expect(previewButton(page)).toBeHidden();
    await expect(moreButton(page)).toBeHidden();
    await expect(accountButton(page)).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The name field is the toolbar's; nothing here opened a menu.
    await expect(displayName(page)).toBeVisible();
  });
});
