import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { waitForEditorHydrated } from "../m2/editor-helpers";
import {
  dialogOf,
  emptyPageUser,
  openEditor,
  startButton,
  templateButton,
} from "../m7/templates-helpers";
import { box, redoButton, toolbar, undoButton } from "../m7/toolbar-helpers";

/**
 * The proving pass for M9-02, M9-05 and M9-06: the measured shapes of the icons (sizes, the 44px
 * rows, the 56px toolbar, nothing clipped at 390), and the keyboard focus ring and hover color the
 * Radix menus and the Radix dialog keep. The screenshot-against-the-commit-before steps need the
 * previous commit running beside this one and are not covered here.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const SCREENS = ["/editor", "/design", "/share", "/analytics", "/domains", "/settings"];
const BRASS = "rgb(184, 145, 79)";

async function settle(page: Page, route: string) {
  await page.goto(url("app", route));
  if (route === "/editor") await waitForEditorHydrated(page);
  await page.waitForLoadState("networkidle");
}

const ring = (locator: Locator) =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
  });

test.describe("M9-02 the measured shape of the icons", () => {
  test("M9-02 at 1440x900 the sidebar rows are 44px with a 16px icon at stroke 1.8, the toolbar is 56px with 44x44 icon buttons, and the toolbar icons keep their sizes", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the sidebar and the toolbar row are the desktop's");
    await signedInUser(context, { label: "ps1" });
    await settle(page, "/editor");

    const links = page.getByRole("navigation", { name: "App", exact: true }).getByRole("link");
    expect(await links.count()).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 3; i++) {
      const link = links.nth(i);
      expect((await box(link)).height, `sidebar row ${i}`).toBeGreaterThanOrEqual(43.5);
      expect((await box(link)).height, `sidebar row ${i}`).toBeLessThanOrEqual(44.5);
      const svg = link.locator("svg");
      expect((await box(svg)).width).toBe(16);
      expect((await box(svg)).height).toBe(16);
      expect(await svg.evaluate((el) => getComputedStyle(el).strokeWidth)).toBe("1.8px");
      expect(await svg.getAttribute("stroke-linecap")).toBe("round");
      expect(await svg.getAttribute("stroke-linejoin")).toBe("round");
    }

    expect((await box(toolbar(page))).height).toBeCloseTo(56, 0);
    const more = toolbar(page).getByRole("button", { name: "More actions" });
    const rename = toolbar(page).getByRole("button", { name: /^Rename (page|site)$/ });
    for (const [name, button] of [
      ["Undo", undoButton(page)],
      ["Redo", redoButton(page)],
      ["More actions", more],
      ["Rename page", rename],
    ] as const) {
      const b = await box(button);
      expect(b.width, `${name} width`).toBeGreaterThanOrEqual(43.5);
      expect(b.height, `${name} height`).toBeGreaterThanOrEqual(43.5);
    }
    const widthOf = async (button: Locator) => (await box(button.locator("svg").first())).width;
    expect(await widthOf(undoButton(page))).toBe(18);
    expect(await widthOf(redoButton(page))).toBe(18);
    expect(await widthOf(more)).toBe(18);
    expect(await widthOf(toolbar(page).getByRole("button", { name: "Preview", exact: true }))).toBe(
      14,
    );
    // The icons draw on the 24 grid and follow the control's color.
    for (const svg of await toolbar(page).locator("svg.lucide").all()) {
      expect(await svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(await svg.getAttribute("stroke")).toBe("currentColor");
    }
  });

  test("M9-02 on every app screen no icon is clipped or leaves its control, and nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "ps2" });
    const width = desktopOnly(info) ? 1440 : 390;
    for (const route of SCREENS) {
      await settle(page, route);
      await expectNoHorizontalScroll(page);
      const bad = await page.evaluate((viewport) => {
        const out: string[] = [];
        for (const svg of document.querySelectorAll<SVGElement>("svg.lucide")) {
          const r = svg.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // A carousel's cards beyond the edge are clipped by their scroller on purpose.
          let scroller: HTMLElement | null = svg.parentElement;
          while (scroller && getComputedStyle(scroller).overflowX === "visible") {
            scroller = scroller.parentElement;
          }
          const scrolls =
            scroller !== null &&
            scroller !== document.documentElement &&
            scroller !== document.body;
          if (!scrolls && (r.left < -0.5 || r.right > viewport + 0.5))
            out.push("an icon is off screen");
          const control = svg.closest<HTMLElement>("button, a[href]");
          if (!control) continue;
          const c = control.getBoundingClientRect();
          if (
            r.left < c.left - 0.5 ||
            r.right > c.right + 0.5 ||
            r.top < c.top - 0.5 ||
            r.bottom > c.bottom + 0.5
          ) {
            out.push(
              `an icon leaves its control: ${control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 20)}`,
            );
          }
        }
        return out;
      }, width);
      expect(bad, route).toEqual([]);
    }
  });

  test("M9-02 the phone's tab bar keeps four icons above their labels, in a row of the same height each", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the tab bar is the phone's");
    await signedInUser(context, { label: "ps3" });
    await settle(page, "/editor");
    const items = page
      .getByRole("navigation", { name: "App sections", exact: true })
      .getByRole("link");
    await expect(items).toHaveCount(4);
    const heights = new Set<number>();
    let iconTop: number | null = null;
    for (let i = 0; i < 4; i++) {
      const item = items.nth(i);
      const svg = await box(item.locator("svg"));
      const label = await item.evaluate((el) => {
        const text = Array.from(el.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim(),
        );
        if (!text) return null;
        const range = document.createRange();
        range.selectNodeContents(text);
        return {
          top: range.getBoundingClientRect().top,
          fontSize: parseFloat(getComputedStyle(el).fontSize),
        };
      });
      expect(label, `tab ${i} has a label`).not.toBeNull();
      expect(svg.y + svg.height, `tab ${i}: the icon sits above its label`).toBeLessThanOrEqual(
        label!.top + 0.5,
      );
      expect(label!.fontSize).toBe(11);
      iconTop ??= svg.y;
      expect(Math.abs(svg.y - iconTop), `tab ${i} icon aligned with the first`).toBeLessThanOrEqual(
        1,
      );
      heights.add(Math.round((await box(item)).height));
    }
    expect([...heights]).toHaveLength(1);
    expect([...heights][0]).toBeGreaterThanOrEqual(44);
  });

  test("M9-02 an icon follows its control's color on hover and on keyboard focus", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the sidebar is the desktop's");
    await signedInUser(context, { label: "ps4" });
    await settle(page, "/editor");
    const links = page.getByRole("navigation", { name: "App", exact: true }).getByRole("link");
    const link = links.nth(1);
    const strokeOf = () => link.locator("svg").evaluate((el) => getComputedStyle(el).stroke);
    const colorOf = () => link.evaluate((el) => getComputedStyle(el).color);
    await link.hover();
    expect(await strokeOf()).toBe(await colorOf());
    await page.mouse.move(700, 450);
    await link.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    expect(await strokeOf()).toBe(await colorOf());
  });
});

const MENUS = [
  {
    name: "Preview",
    trigger: (page: Page) => toolbar(page).getByRole("button", { name: "Preview", exact: true }),
  },
  {
    name: "More actions",
    trigger: (page: Page) => toolbar(page).getByRole("button", { name: "More actions" }),
  },
  { name: "Account", trigger: (page: Page) => page.getByRole("button", { name: "Account menu" }) },
];

test.describe("M9-05 focus ring and hover of the menus", () => {
  for (const menu of MENUS) {
    test(`M9-05 ${menu.name}: the focused item has the 2px brass outline, and hovering an item changes its background`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "the menus are the desktop's");
      await signedInUser(context, { label: "ps5" });
      await settle(page, "/editor");
      const trigger = menu.trigger(page);
      await trigger.focus();
      await page.keyboard.press("Enter");
      const items = page.getByRole("menu", { name: menu.name, exact: true }).getByRole("menuitem");
      await expect(items.first()).toBeFocused();
      expect(await ring(items.first())).toEqual({ width: "2px", style: "solid", color: BRASS });
      // The trigger shows the same ring when it is the focused control.
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect(await ring(trigger)).toEqual({ width: "2px", style: "solid", color: BRASS });

      await trigger.click();
      const second = items.nth(1);
      await page.mouse.move(5, 5);
      const rest = await second.evaluate((el) => getComputedStyle(el).backgroundColor);
      await second.hover();
      await expect
        .poll(() => second.evaluate((el) => getComputedStyle(el).backgroundColor))
        .not.toBe(rest);
    });
  }
});

test.describe("M9-06 focus ring in the template dialog", () => {
  test("M9-06 the focused card button and Close have the 2px brass outline, at both viewports", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "ps6");
    await openEditor(page);
    // Opened from the keyboard, so :focus-visible matches the card button focus lands on.
    await startButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(dialogOf(page)).toBeVisible();
    const first = templateButton(page, "Musician");
    await expect(first).toBeFocused();
    expect(await ring(first)).toEqual({ width: "2px", style: "solid", color: BRASS });
    const close = dialogOf(page).getByRole("button", { name: "Close", exact: true });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    expect(await ring(close)).toEqual({ width: "2px", style: "solid", color: BRASS });
  });
});
