import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { axeViolations } from "../fixtures/a11y";
import { accessTokenFor, cleanupUsers, makeUser } from "../fixtures/data";
import { FAULT_COOKIE_IGNORED, restAs } from "../fixtures/http";
import { url } from "../helpers";
import {
  expectNoHorizontalScroll,
  expectTapTargets,
  isPhone,
  savedThemesCard,
  seedTheme,
  setTheme,
  storedTheme,
  themeRowsOf,
  themeUser,
  type ThemeFixture,
} from "../m3/themes-helpers";

/**
 * M7-06: the Design tab's Themes card as two swipeable carousels, "Your themes" then "HYDLNK
 * themes". Every test makes its own users (the phone and desktop projects run side by side on one
 * database) and never touches mara's rows. The layout, the scrolling, the applied card, the menu
 * and the dialogs run on both projects; the arrows are desktop only and the swipe is phone only.
 */

test.afterAll(cleanupUsers);

const SYSTEM_IDS = {
  Noir: "00000000-0000-4000-8000-000000000001",
  Paper: "00000000-0000-4000-8000-000000000004",
  Plum: "00000000-0000-4000-8000-000000000014",
} as const;
const BRASS = "rgb(184, 145, 79)";

// ---- helpers -------------------------------------------------------------------------------

/** Opens the Design tab and waits until the Themes card has React handlers. */
async function openThemes(page: Page): Promise<void> {
  await page.goto(url("app", "/design"));
  await expect(savedThemesCard(page)).toBeVisible();
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-testid="theme-card"]');
    return !!card && Object.keys(card).some((key) => key.startsWith("__reactProps$"));
  });
}

const ownRow = (page: Page): Locator =>
  savedThemesCard(page).getByRole("region", { name: /^Your themes · \d+$/ });
const systemRow = (page: Page): Locator =>
  savedThemesCard(page).getByRole("region", { name: "HYDLNK themes · 16" });
const cardsOf = (row: Locator): Locator => row.getByTestId("theme-card");
const cardNamed = (row: Locator, name: string): Locator =>
  row.locator("li[data-theme-id]", { has: row.page().getByText(name, { exact: true }) });
const moreOf = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: `More for ${name}`, exact: true });
const arrow = (row: Locator, which: "previous" | "next"): Locator =>
  row.locator("xpath=..").getByRole("button", { name: `Show ${which} themes` });

/** Waits until the row has stopped scrolling and returns where it rests. */
async function settled(row: Locator): Promise<number> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 80; i++) {
    const now = await row.evaluate((el) => el.scrollLeft);
    if (Math.abs(now - last) < 0.5) {
      stable += 1;
      if (stable >= 4) return now;
    } else stable = 0;
    last = now;
    await row.page().waitForTimeout(60);
  }
  return last;
}

/** The card is fully inside the row's visible box. */
async function insideRow(row: Locator, card: Locator): Promise<boolean> {
  const r = (await row.boundingBox())!;
  const c = (await card.boundingBox())!;
  return c.x >= r.x - 0.5 && c.x + c.width <= r.x + r.width + 0.5;
}

async function seedMany(ownerId: string, names: string[]): Promise<ThemeFixture[]> {
  const out: ThemeFixture[] = [];
  for (const name of names) out.push(await seedTheme(ownerId, name, { accent: "#336699" }));
  return out;
}

const FIVE = ["Night shift", "Midday", "A very long theme name that gets cut", "<b>x</b>", "Fifth"];

// ---- layout ---------------------------------------------------------------------------------

test.describe("M7-06 the Themes card", () => {
  test("M7-06 one Themes card holds the rows 'Your themes · 5' then 'HYDLNK themes · 16', as compact cards of one height", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-layout", "pro");
    await seedMany(user.userId, FIVE);
    await openThemes(page);
    const card = savedThemesCard(page);
    const phone = isPhone(page);

    // One card, its h2 hidden, the old title gone.
    await expect(page.getByTestId("saved-themes-card")).toHaveCount(1);
    const title = card.getByRole("heading", { level: 2, name: "Themes" });
    const titleBox = (await title.boundingBox())!;
    expect(titleBox.width).toBeLessThanOrEqual(1);
    expect(titleBox.height).toBeLessThanOrEqual(1);
    await expect(card.getByText("Saved themes", { exact: true })).toHaveCount(0);
    await expect(card.getByText("Applying one replaces", { exact: false })).toHaveCount(0);

    // Two rows in order, counts from the data.
    await expect(card.getByRole("heading", { level: 3 })).toHaveText([
      "Your themes · 5",
      "HYDLNK themes · 16",
    ]);
    await expect(cardsOf(ownRow(page))).toHaveCount(5);
    await expect(cardsOf(systemRow(page))).toHaveCount(16);
    const own = (await ownRow(page).boundingBox())!;
    const system = (await systemRow(page).boundingBox())!;
    expect(own.y).toBeLessThan(system.y);

    // Each row is a focusable, snapping, horizontal scroll container.
    for (const row of [ownRow(page), systemRow(page)]) {
      await expect(row).toHaveAttribute("tabindex", "0");
      const style = await row.evaluate((el) => {
        const s = getComputedStyle(el);
        const aligns = Array.from(el.querySelectorAll("li")).map(
          (li) => getComputedStyle(li).scrollSnapAlign,
        );
        return { overflowX: s.overflowX, snap: s.scrollSnapType, aligns };
      });
      expect(style.overflowX).toBe("auto");
      expect(style.snap).toBe("x mandatory");
      expect(style.aligns.length).toBeGreaterThan(0);
      expect(style.aligns.every((a) => a.startsWith("start"))).toBe(true);
    }

    // Compact, equal cards: about 152px wide, a 48px swatch over a 44px name row.
    const boxes = await cardsOf(card).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const swatch = el.querySelector("[data-swatch]")!.getBoundingClientRect();
        const name = el.querySelector("[data-name-row]")!.getBoundingClientRect();
        return { w: r.width, h: r.height, swatch: swatch.height, name: name.height };
      }),
    );
    expect(boxes).toHaveLength(21);
    for (const b of boxes) {
      expect(Math.abs(b.w - 152)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.h - boxes[0]!.h)).toBeLessThanOrEqual(1);
      expect(b.swatch).toBe(48);
      expect(b.name).toBe(44);
    }
    // A long name is cut with an ellipsis and carries the whole name in `title`.
    const longName = card.locator('[data-theme-name][title^="A very long"]');
    await expect(longName).toHaveAttribute("title", FIVE[2]!);
    expect(await longName.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    // The applied card: pressed, tagged, 2px brass outline, its name is the theme plus the tag.
    const noir = card.getByRole("button", { name: "Noir Applied" });
    await expect(noir).toHaveAttribute("aria-pressed", "true");
    await expect(noir.locator("[data-theme-tag]")).toHaveText("Applied");
    const outline = await noir.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor };
    });
    expect(outline).toEqual({ width: "2px", style: "solid", color: BRASS });
    await expect(card.getByRole("button", { name: "Ivory", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // The card's height: about 300px, for the same reason at both widths.
    const height = (await card.boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(290);
    expect(height).toBeLessThanOrEqual(phone ? 370 : 340);

    // "Save as theme" is at the right of the 'Your themes' heading, 44px tall.
    const save = card.getByRole("button", { name: "Save as theme" });
    const heading = (await card.getByRole("heading", { name: /^Your themes/ }).boundingBox())!;
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.height).toBeGreaterThanOrEqual(44);
    expect(saveBox.x).toBeGreaterThan(heading.x + heading.width);
    expect(
      Math.abs(saveBox.y + saveBox.height / 2 - (heading.y + heading.height / 2)),
    ).toBeLessThan(12);

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[data-testid="saved-themes-card"]');

    if (phone) {
      // Two cards and a part of a third: the swipe can be found.
      const r = (await ownRow(page).boundingBox())!;
      const cards = await cardsOf(ownRow(page)).evaluateAll((els) =>
        els.map((el) => {
          const b = el.getBoundingClientRect();
          return { left: b.left, right: b.right };
        }),
      );
      const whole = cards.filter((c) => c.right <= r.x + r.width + 0.5 && c.left >= r.x).length;
      const part = cards.filter((c) => c.left < r.x + r.width - 4 && c.right > r.x + r.width + 0.5);
      expect(whole).toBe(2);
      expect(part).toHaveLength(1);
      // No arrow buttons below 760px.
      await expect(card.getByRole("button", { name: /Show (previous|next) themes/ })).toHaveCount(
        0,
      );
    } else {
      // The rows run the width of the 720px column, with arrows at their edges, and the five style
      // cards follow the Themes card.
      expect(own.width).toBeGreaterThanOrEqual(700);
      expect(own.width).toBeLessThanOrEqual(722);
      await expect(arrow(systemRow(page), "previous")).toBeVisible();
      await expect(arrow(systemRow(page), "next")).toBeVisible();
      const below = await page
        .locator("[data-design-section]")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
      const themes = (await card.boundingBox())!;
      expect(below).toHaveLength(5);
      expect(below.every((top) => top > themes.y + themes.height - 1)).toBe(true);
    }
  });

  test("M7-06 the card is the same height with 0, 1, 3 and 30 saved themes, and the empty row shows its hint", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-height", "pro");
    const heights: number[] = [];
    const measure = async (): Promise<void> => {
      await openThemes(page);
      heights.push((await savedThemesCard(page).boundingBox())!.height);
    };

    await measure(); // none
    await expect(
      savedThemesCard(page).getByRole("heading", { level: 3, name: "Your themes · 0" }),
    ).toBeVisible();
    const hint = savedThemesCard(page).getByTestId("saved-themes-hint");
    await expect(hint).toHaveText(
      "Saved themes appear here. Use Save as theme to reuse this design on any page.",
    );
    expect(await hint.evaluate((el) => getComputedStyle(el).borderStyle)).toBe("dashed");
    const cardHeight = (await cardsOf(systemRow(page)).first().boundingBox())!.height;
    expect(Math.abs((await hint.boundingBox())!.height - cardHeight)).toBeLessThanOrEqual(1);

    await seedMany(user.userId, ["One"]);
    await measure();
    await seedMany(user.userId, ["Two", "Three"]);
    await measure();
    await seedMany(
      user.userId,
      Array.from({ length: 27 }, (_, i) => `Theme ${i + 4}`),
    );
    await measure();
    await expect(cardsOf(ownRow(page))).toHaveCount(30);
    await expect(
      savedThemesCard(page).getByRole("heading", { level: 3, name: "Your themes · 30" }),
    ).toBeVisible();

    for (const h of heights) expect(Math.abs(h - heights[0]!)).toBeLessThanOrEqual(1);
    expect(heights[0]!).toBeGreaterThanOrEqual(290);
    expect(heights[0]!).toBeLessThanOrEqual(isPhone(page) ? 370 : 340);
  });
});

// ---- moving along a row ---------------------------------------------------------------------

test.describe("M7-06 moving along a row", () => {
  test("M7-06 arrows on desktop, a swipe on a phone, the arrow keys, and tabbing to a card out of view", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-move", "pro");
    await seedMany(user.userId, ["A", "B", "C"]);
    await openThemes(page);
    const row = systemRow(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      // Our own origins and the database: the preview's Google Fonts links are not the row's. A
      // production build also prefetches the nav links' routes (`?_rsc=`) once they are idle; that is
      // the framework's, not the row's.
      const target = request.url();
      const ours =
        /^https?:\/\/([a-z0-9-]+\.)?localhost(:\d+)?\//.test(target) ||
        target.includes("127.0.0.1");
      if (ours && !/hot-update|webpack-hmr|__nextjs|_next\/static|\.map$|[?&]_rsc=/.test(target)) {
        requests.push(`${request.method()} ${target}`);
      }
    });
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    const step = await row.evaluate((el) => {
      const lis = el.querySelectorAll("li");
      return lis[1]!.getBoundingClientRect().left - lis[0]!.getBoundingClientRect().left;
    });
    expect(step).toBeGreaterThan(150);

    if (isPhone(page)) {
      // A finger drags the row sideways and it ends snapped to a card.
      const box = (await row.boundingBox())!;
      const y = box.y + box.height / 2;
      const cdp = await context.newCDPSession(page);
      const point = (x: number) => [{ x, y, id: 1 }];
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: point(box.x + 300),
      });
      for (let x = 300; x >= 120; x -= 20) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: point(box.x + x),
        });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const rest = await settled(row);
      expect(rest).toBeGreaterThan(step / 2);
      const offset = rest % step;
      expect(Math.min(offset, step - offset)).toBeLessThanOrEqual(1.5);
      // The row moved, not the page.
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
    } else {
      const previous = arrow(row, "previous");
      const next = arrow(row, "next");
      await expect(previous).toHaveAttribute("aria-disabled", "true");
      await expect(next).toHaveAttribute("aria-disabled", "false");
      for (const button of [previous, next]) {
        const b = (await button.boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.height).toBeGreaterThanOrEqual(44);
      }
      // Vertically centered on the row, overlaid on its edges.
      const r = (await row.boundingBox())!;
      const n = (await next.boundingBox())!;
      expect(Math.abs(n.y + n.height / 2 - (r.y + r.height / 2))).toBeLessThanOrEqual(2);
      expect(n.x + n.width).toBeLessThanOrEqual(r.x + r.width + 1);
      expect(n.x).toBeGreaterThan(r.x + r.width - 80);

      // One click: by the visible width less one card, on a card boundary.
      const width = await row.evaluate((el) => el.clientWidth);
      await next.click();
      const first = await settled(row);
      const expected = Math.round((width - step) / step) * step;
      expect(Math.abs(first - expected)).toBeLessThanOrEqual(1.5);
      await expect(previous).toHaveAttribute("aria-disabled", "false");

      // On to the end: the next arrow gives out, the previous one stays.
      for (let i = 0; i < 6; i++) {
        if ((await next.getAttribute("aria-disabled")) === "true") break;
        await next.click();
        await settled(row);
      }
      await expect(next).toHaveAttribute("aria-disabled", "true");
      const end = await settled(row);
      expect(end).toBeGreaterThan(first);
      // A press on a disabled arrow does nothing.
      await next.dispatchEvent("click");
      expect(await settled(row)).toBe(end);

      // And back: onto a boundary again.
      await previous.click();
      const back = await settled(row);
      expect(back).toBeLessThan(end);
      expect(Math.min(back % step, step - (back % step))).toBeLessThanOrEqual(1.5);

      // Only the row with more cards than fit has arrows: three of our own cards fit.
      await expect(arrow(ownRow(page), "next")).toHaveCount(0);
    }

    // The arrow keys scroll the focused row.
    await row.evaluate((el) => (el.scrollLeft = 0));
    await settled(row);
    await row.focus();
    await page.keyboard.press("ArrowRight");
    const oneCard = await settled(row);
    expect(Math.abs(oneCard - step)).toBeLessThanOrEqual(1.5);
    await page.keyboard.press("ArrowLeft");
    expect(await settled(row)).toBeLessThanOrEqual(1);

    // Tabbing to a card that is out of view scrolls the row to it: ten Tabs from the first card
    // (card, More, card, More, ...) reach the sixth, which starts out of view.
    await row.evaluate((el) => (el.scrollLeft = 0));
    await settled(row);
    const cards = cardsOf(row);
    await cards.first().focus();
    const sixth = cards.nth(5);
    expect(await insideRow(row, sixth)).toBe(false);
    for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
    await expect(sixth).toBeFocused();
    await settled(row);
    expect(await insideRow(row, sixth)).toBe(true);

    // Scrolling made no request, and the page did not move.
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollYBefore);
  });
});

// ---- the applied theme ----------------------------------------------------------------------

test.describe("M7-06 the applied theme", () => {
  test("M7-06 the row of the applied theme opens scrolled to it, and follows an apply, an Undo and Save as theme without moving the page", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-applied", "pro");
    const mine = await seedMany(user.userId, ["Mine 1", "Mine 2", "Mine 3", "Mine 4", "Mine 5"]);
    await setTheme(user.pageId, SYSTEM_IDS.Plum);
    await openThemes(page);

    // The 14th HYDLNK theme is applied: its row opens scrolled to it, the other row does not.
    const plum = cardNamed(systemRow(page), "Plum");
    await expect(plum.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => insideRow(systemRow(page), plum)).toBe(true);
    expect(await systemRow(page).evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    expect(await ownRow(page).evaluate((el) => el.scrollLeft)).toBe(0);
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    // Apply the last of my own themes: the key End takes the row there, a press applies it.
    await ownRow(page).focus();
    await page.keyboard.press("End");
    await settled(ownRow(page));
    const last = cardNamed(ownRow(page), "Mine 5");
    await last.getByTestId("theme-card").click();
    const message = savedThemesCard(page).getByTestId("theme-message");
    await expect(message).toContainText("Applied Mine 5.");
    await expect(last.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect(last.locator("[data-theme-tag]")).toHaveText("Applied");
    await expect.poll(() => insideRow(ownRow(page), last)).toBe(true);
    // Plum is not applied any more: the page did not scroll.
    await expect(plum.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    // Undo puts Plum back, and its row scrolls to it again (it was scrolled away first).
    await systemRow(page).focus();
    await page.keyboard.press("Home");
    await settled(systemRow(page));
    expect(await insideRow(systemRow(page), plum)).toBe(false);
    await savedThemesCard(page).getByTestId("theme-undo").click();
    await expect(plum.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => insideRow(systemRow(page), plum)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    // Save as theme: the heading counts six, the new card is last, outlined and in view.
    await savedThemesCard(page).getByRole("button", { name: "Save as theme" }).click();
    await expect(
      savedThemesCard(page).getByRole("heading", { level: 3, name: "Your themes · 6" }),
    ).toBeVisible();
    const created = ownRow(page).locator("li[data-theme-id]").last();
    await expect(created.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect(created.locator("[data-theme-name]")).toHaveText(/^My theme \d+$/);
    await expect.poll(() => insideRow(ownRow(page), created)).toBe(true);
    const outline = await created
      .getByTestId("theme-card")
      .evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outline).toBe("2px");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    expect(mine).toHaveLength(5);
  });
});

test.describe("M7-06 the applied theme after a Redo and after Retry", () => {
  test("M7-06 Undo and Redo of an apply bring the applied card's row back to it", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-redo", "pro");
    await setTheme(user.pageId, SYSTEM_IDS.Plum);
    await openThemes(page);
    const plum = cardNamed(systemRow(page), "Plum");
    const paper = cardNamed(systemRow(page), "Paper");
    await expect.poll(() => insideRow(systemRow(page), plum)).toBe(true);

    // Apply Paper: the row goes to Paper. (Scroll it there first; a press does not scroll by itself.)
    await systemRow(page).focus();
    await page.keyboard.press("Home");
    await settled(systemRow(page));
    await paper.getByTestId("theme-card").click();
    await expect(paper.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("saved-themes-card").getByTestId("theme-message")).toContainText(
      "Applied Paper.",
    );
    await expect
      .poll(async () => (await storedTheme(user.pageId)).ref, { timeout: 15_000 })
      .toBe(SYSTEM_IDS.Paper);

    // The workspace's Undo (Ctrl+Z, from the card) points the draft back at Plum: its row follows.
    await page.keyboard.press("Control+z");
    await expect(plum.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => insideRow(systemRow(page), plum)).toBe(true);

    // And Redo points it at Paper again, with the row scrolled back to it.
    await page.keyboard.press("Control+Shift+z");
    await expect(paper.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => insideRow(systemRow(page), paper)).toBe(true);
  });

  test("M7-06 a Retry that loads the themes scrolls the applied card's row to it", async ({
    page,
    context,
  }) => {
    test.skip(
      FAULT_COOKIE_IGNORED,
      "this production server was started without the test hooks, so it ignores the fault cookie",
    );
    const user = await themeUser(context, "m7t-retry", "pro");
    await setTheme(user.pageId, SYSTEM_IDS.Plum);
    await context.addCookies([{ name: "hl-fault", value: "themes-load", url: url("app") }]);
    await page.goto(url("app", "/design"));
    const error = savedThemesCard(page).getByTestId("themes-load-error");
    await expect(error).toContainText("We couldn’t load your themes. Try again.");
    await expect(savedThemesCard(page).getByRole("region")).toHaveCount(0);

    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(error).toHaveCount(0);
    const plum = cardNamed(systemRow(page), "Plum");
    await expect(plum.getByTestId("theme-card")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => insideRow(systemRow(page), plum)).toBe(true);
    expect(await systemRow(page).evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

// ---- the per-card menu, rename and delete ---------------------------------------------------

test.describe("M7-06 the card menu", () => {
  test("M7-06 HYDLNK cards have Preview, own cards have Preview, Rename and Delete; the keys work", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-menu", "pro");
    await seedMany(user.userId, ["Night shift"]);
    await openThemes(page);

    // A HYDLNK card: one item. The button is 44x44, on the name row.
    const paper = moreOf(page, "Paper");
    await paper.scrollIntoViewIfNeeded();
    const b = (await paper.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await expect(paper).toHaveAttribute("aria-haspopup", "menu");
    await expect(paper).toHaveAttribute("aria-expanded", "false");
    // Paper is the fourth card: scroll its row to it first on a phone, where it is out of view.
    await cardNamed(systemRow(page), "Paper").getByTestId("theme-card").focus();
    await paper.click();
    await expect(paper).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu", { name: "Paper" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(1);
    await expect(menu.getByRole("menuitem", { name: "Preview Paper" })).toBeFocused();
    // Escape closes it and gives the focus back to its button.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(paper).toBeFocused();
    await expect(paper).toHaveAttribute("aria-expanded", "false");

    // An own card: Preview, Rename, Delete; the arrows, Home and End move; the menu stays on screen.
    const mine = moreOf(page, "Night shift");
    await mine.click();
    const ownMenu = page.getByRole("menu", { name: "Night shift" });
    await expect(ownMenu.getByRole("menuitem")).toHaveText(["Preview", "Rename", "Delete"]);
    const rect = (await ownMenu.boundingBox())!;
    const view = page.viewportSize()!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(view.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(view.height);
    for (const item of await ownMenu.getByRole("menuitem").all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(ownMenu.getByRole("menuitem", { name: "Preview Night shift" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(ownMenu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(ownMenu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(ownMenu.getByRole("menuitem", { name: "Preview Night shift" })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(ownMenu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(ownMenu.getByRole("menuitem", { name: "Preview Night shift" })).toBeFocused();
    // A press outside closes it.
    await page.getByRole("heading", { level: 3, name: /^Your themes/ }).click();
    await expect(ownMenu).toHaveCount(0);
    // Opening and closing a menu changes nothing in the draft.
    expect((await storedTheme(user.pageId)).ref).toBe(SYSTEM_IDS.Noir);
  });

  test("M7-06 Preview from a card's menu shows the page in that theme and writes nothing", async ({
    page,
    context,
  }, info) => {
    test.skip(
      info.project.name !== "desktop",
      "the phone's preview view belongs to the mini phone (M7-09)",
    );
    const user = await themeUser(context, "m7t-preview", "pro");
    await openThemes(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (["PATCH", "POST", "PUT", "DELETE"].includes(request.method())) {
        const target = request.url();
        if (target.includes("/rest/v1/") || target.includes("/storage/")) writes.push(target);
      }
    });
    await cardNamed(systemRow(page), "Paper").getByTestId("theme-card").focus();
    await moreOf(page, "Paper").click();
    await page.getByRole("menuitem", { name: "Preview Paper" }).click();
    await expect(page.getByText("Previewing Paper").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply Paper", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop previewing" }).click();
    // Focus goes back to the card's More button.
    await expect(moreOf(page, "Paper")).toBeFocused();
    expect(writes).toEqual([]);
    expect((await storedTheme(user.pageId)).ref).toBe(SYSTEM_IDS.Noir);
  });

  test("M7-06 Rename opens a dialog: prefilled and selected, trimmed, empty refused, Escape cancels, Enter saves", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-rename", "pro");
    const [theme] = await seedMany(user.userId, ["Night shift"]);
    await openThemes(page);

    await moreOf(page, "Night shift").click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename theme" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("textbox", { name: "Theme name" });
    await expect(input).toHaveValue("Night shift");
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((el: HTMLInputElement) => ({
        selected: el.selectionStart === 0 && el.selectionEnd === el.value.length,
        font: getComputedStyle(el).fontSize,
      })),
    ).toEqual({ selected: true, font: "16px" });
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const name of ["Save", "Cancel"]) {
      expect(
        (await dialog.getByRole("button", { name, exact: true }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);

    // Empty: refused with the reason, and nothing is written.
    await input.fill("   ");
    await input.press("Enter");
    await expect(dialog.getByText("Give the theme a name.")).toBeVisible();
    expect((await themeRowsOf(user.userId))[0]!.name).toBe("Night shift");

    // Escape cancels and the focus returns to the card's More button.
    await input.fill("Discarded");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(moreOf(page, "Night shift")).toBeFocused();
    expect((await themeRowsOf(user.userId))[0]!.name).toBe("Night shift");

    // Whitespace is trimmed and Enter saves; the tokens are untouched.
    await moreOf(page, "Night shift").click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await input.fill("  Midnight market  ");
    await input.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(
      savedThemesCard(page).getByRole("button", { name: "Midnight market", exact: true }),
    ).toBeVisible();
    await expect(savedThemesCard(page).getByTestId("theme-message")).toContainText(
      "Renamed to Midnight market.",
    );
    const row = (await themeRowsOf(user.userId))[0]!;
    expect(row.name).toBe("Midnight market");
    expect(row.id).toBe(theme!.id);
    await expect(moreOf(page, "Midnight market")).toBeFocused();
  });

  test("M7-06 Delete asks first; deleting the applied theme leaves the draft on the default theme", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-delete", "pro");
    const [keep, applied] = await seedMany(user.userId, ["Keep me", "Applied one"]);
    await setTheme(user.pageId, applied!.id);
    await openThemes(page);

    // Cancel keeps the theme and returns the focus to the card's More button.
    await moreOf(page, "Applied one").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByTestId("delete-theme-dialog");
    await expect(dialog).toContainText("Delete Applied one?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(moreOf(page, "Applied one")).toBeFocused();
    expect(await themeRowsOf(user.userId)).toHaveLength(2);

    // Confirm: the card goes, the heading counts one, the draft falls back to the default.
    await moreOf(page, "Applied one").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Delete theme" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      savedThemesCard(page).getByRole("heading", { level: 3, name: "Your themes · 1" }),
    ).toBeVisible();
    await expect(savedThemesCard(page).getByTestId("theme-message")).toContainText(
      "Deleted Applied one.",
    );
    await expect(savedThemesCard(page).getByRole("button", { name: /^Applied one/ })).toHaveCount(
      0,
    );
    await expect
      .poll(async () => (await storedTheme(user.pageId)).ref, { timeout: 15_000 })
      .toBeNull();
    const rows = await themeRowsOf(user.userId);
    expect(rows.map((r) => r.id)).toEqual([keep!.id]);
    // The focus lands on the row's heading, which is still there.
    await expect(
      savedThemesCard(page).getByRole("heading", { level: 3, name: "Your themes · 1" }),
    ).toBeFocused();
  });
});

// ---- the Free limit and the messages --------------------------------------------------------

test.describe("M7-06 messages and the Free limit", () => {
  test("M7-06 the Free limit and the other messages sit above the rows in one polite region", async ({
    page,
    context,
  }) => {
    await themeUser(context, "m7t-free", "free").then((u) =>
      seedMany(u.userId, ["One", "Two", "Three"]),
    );
    await openThemes(page);
    const card = savedThemesCard(page);
    const region = card.getByTestId("theme-message-region");
    await expect(region).toHaveAttribute("role", "status");
    await expect(region).toHaveAttribute("aria-live", "polite");

    await card.getByRole("button", { name: "Save as theme" }).click();
    const limit = card.getByTestId("theme-message");
    await expect(limit).toContainText(
      "You’ve used 3 of 3 saved themes. Delete one or upgrade to Pro.",
    );
    const limitBox = (await limit.boundingBox())!;
    const ownBox = (await ownRow(page).boundingBox())!;
    expect(limitBox.y + limitBox.height).toBeLessThanOrEqual(ownBox.y + 1);
    expect(limitBox.height).toBeGreaterThanOrEqual(44);
    if (isPhone(page)) {
      // The real Free limit message (not only the Applied one) is clear of the mini phone and of the
      // bottom tab bar, measured against the mini phone itself.
      const view = page.viewportSize()!;
      const mini = page.getByTestId("mini-phone");
      await expect(mini).toBeVisible();
      const miniBox = (await mini.boundingBox())!;
      const overlapsX =
        limitBox.x < miniBox.x + miniBox.width && limitBox.x + limitBox.width > miniBox.x;
      const overlapsY =
        limitBox.y < miniBox.y + miniBox.height && limitBox.y + limitBox.height > miniBox.y;
      expect(overlapsX && overlapsY, "the limit message overlaps the mini phone").toBe(false);
      expect(limitBox.x + limitBox.width).toBeLessThanOrEqual(view.width + 0.5);
      expect(limitBox.y + limitBox.height).toBeLessThanOrEqual(view.height - 68 + 0.5);
    }
    await limit.getByRole("button", { name: "Dismiss" }).click();
    await expect(limit).toHaveCount(0);

    // An apply shows 'Applied X.' with its Undo, which is at least 44px tall; on a phone it sits
    // above the bottom tab bar and ends before the mini phone's corner (72px from the right edge).
    await cardsOf(systemRow(page)).nth(1).click();
    const applied = card.getByTestId("theme-message");
    await expect(applied).toContainText("Applied Ivory.");
    const undo = card.getByTestId("theme-undo");
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (isPhone(page)) {
      const box = (await applied.boundingBox())!;
      const view = page.viewportSize()!;
      expect(box.x + box.width).toBeLessThanOrEqual(view.width - 72 + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(view.height - 68 + 0.5);
    }
    await undo.click();
    await expect(card.getByTestId("theme-message")).toContainText("Undone.");
  });
});

// ---- abuse and accessibility ----------------------------------------------------------------

test.describe("M7-06 safety and accessibility", () => {
  test("M7-06 a theme named with markup is drawn as text everywhere, and no dialog opens", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-xss", "pro");
    const name = "<b>x</b><img src=x onerror=alert(1)>";
    await seedMany(user.userId, [name.slice(0, 40)]);
    const shown = name.slice(0, 40);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openThemes(page);
    const card = savedThemesCard(page);
    await expect(card.locator("[data-theme-name]", { hasText: shown })).toHaveCount(1);
    await expect(card.locator("b, img")).toHaveCount(0);
    await moreOf(page, shown).click();
    const menu = page.getByRole("menu", { name: shown });
    await expect(menu).toBeVisible();
    await expect(page.locator("b, img[src='x']")).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByRole("dialog", { name: "Rename theme" }).getByRole("textbox");
    await expect(input).toHaveValue(shown);
    await expect(page.locator("b, img[src='x']")).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(dialogs).toEqual([]);
  });

  test("M7-06 another user's saved themes are in neither row, and the API returns none of them", async ({
    page,
    context,
  }, info) => {
    const a = await makeUser("m7t-a");
    await seedTheme(a.id, "A private look", { accent: "#FF00AA" });
    await themeUser(context, "m7t-b", "pro");
    await openThemes(page);
    await expect(savedThemesCard(page).getByText("A private look")).toHaveCount(0);
    await expect(
      savedThemesCard(page).getByRole("heading", { level: 3, name: "Your themes · 0" }),
    ).toBeVisible();
    if (info.project.name !== "desktop") return;
    // With user B's token and the publishable key, user A's rows are not readable.
    const b = await makeUser("m7t-c");
    const token = await accessTokenFor(b.email);
    const byOwner = await restAs(token, `/themes?owner_id=eq.${a.id}`);
    expect(byOwner.status).toBe(200);
    expect(byOwner.body).toEqual([]);
    // And nothing the screen did wrote A's rows.
    const { data } = await adminClient().from("themes").select("name").eq("owner_id", a.id);
    expect(data).toEqual([{ name: "A private look" }]);
  });

  test("M7-06 axe finds no serious or critical violation with a menu open", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "m7t-axe", "pro");
    await seedMany(user.userId, FIVE);
    await openThemes(page);
    expect(await axeViolations(page)).toEqual([]);
    await moreOf(page, "Midday").click();
    await expect(page.getByRole("menu", { name: "Midday" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
