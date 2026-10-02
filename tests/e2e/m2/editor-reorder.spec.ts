import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import {
  css,
  draftWith,
  emptyUser,
  expectDraft,
  openEditor,
  previewScreen,
  reloadEditor,
  rowOf,
  rows,
  saveIndicator,
  seededUser,
  setDraft,
} from "./editor-helpers";

/** M2-14: reorder blocks with dnd-kit (pointer, touch, keyboard) and with Move up / Move down. */

test.afterAll(cleanupUsers);

const FIVE = ["blockAAA1", "blockBBB2", "blockCCC3", "blockDDD4", "blockEEE5"];
const WORDS = ["One", "Two", "Three", "Four", "Five"];

const handle = (page: Page, id: string) =>
  rowOf(page, id).getByRole("button", { name: "Drag to reorder" });
const rowButton = (page: Page, id: string) => rowOf(page, id).locator("button[aria-expanded]");
const order = (page: Page) =>
  rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
const previewOrder = (page: Page) =>
  previewScreen(page)
    .locator("[data-block-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
const liveRegion = (page: Page) => page.locator('[id^="DndLiveRegion"]');

/** Puts the list in the middle of the viewport, away from the edges where dnd-kit auto-scrolls. */
async function centerList(page: Page) {
  await page.evaluate(() => {
    const first = document.querySelector("li[data-block-id]")!.getBoundingClientRect();
    window.scrollTo(0, first.top + window.scrollY - 250);
  });
  await page.waitForTimeout(150);
}

async function fiveBlocks(context: import("@playwright/test").BrowserContext, label: string) {
  const user = await emptyUser(context, label);
  await setDraft(
    user.pageId,
    draftWith(
      user.handle,
      FIVE.map((id, i) => ({ id, type: "header", visible: true, text: WORDS[i] })),
    ),
  );
  return user;
}

test.describe("M2-14 drag handles", () => {
  test("M2-14 each row has a 44x44 handle named 'Drag to reorder'; only the handle has touch-action none", async ({
    page,
    context,
  }) => {
    await fiveBlocks(context, "rd1");
    await openEditor(page);
    await expect(page.getByRole("button", { name: "Drag to reorder" })).toHaveCount(5);
    const h = handle(page, FIVE[0]!);
    const box = (await h.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await css(h, "color")).toBe("rgb(154, 149, 141)");
    await expect(h.locator("svg")).toHaveCount(1);
    expect(await css(h, "touch-action")).toBe("none");
    expect(await css(rowOf(page, FIVE[0]!), "touch-action")).not.toBe("none");
    expect(await css(rowButton(page, FIVE[0]!), "touch-action")).not.toBe("none");
    // It is a sortable: dnd-kit's own attributes are on it.
    await expect(h).toHaveAttribute("aria-roledescription", "sortable");
  });

  test("M2-14 pointer drag: the first of five dropped below the third; ids unchanged; an open row stays open; it persists", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "pointer drag at 1440x900");
    const user = await fiveBlocks(context, "rd2");
    await openEditor(page);
    await rowButton(page, FIVE[3]!).click(); // an open row elsewhere in the list
    await expect(rowButton(page, FIVE[3]!)).toHaveAttribute("aria-expanded", "true");
    await centerList(page);

    const from = (await handle(page, FIVE[0]!).boundingBox())!;
    const third = (await rowOf(page, FIVE[2]!).boundingBox())!;
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 12, { steps: 4 });
    // A drag overlay shows while dragging: a copy of the row that follows the pointer.
    await expect(page.getByTestId("drag-overlay")).toBeVisible();
    await page.mouse.move(x, third.y + third.height * 0.8, { steps: 20 });
    await page.mouse.up();

    const expected = [FIVE[1], FIVE[2], FIVE[0], FIVE[3], FIVE[4]];
    await expect.poll(() => order(page)).toEqual(expected);
    expect(await previewOrder(page)).toEqual(expected);
    await expect(rowButton(page, FIVE[3]!)).toHaveAttribute("aria-expanded", "true");
    await expect(saveIndicator(page)).toHaveText("Saved");
    const saved = await expectDraft(user.pageId, (d) => d.blocks[2]?.id === FIVE[0]);
    expect(saved.blocks.map((b) => b.id)).toEqual(expected);
    expect(saved.blocks.map((b) => (b as { text: string }).text)).toEqual([
      "Two",
      "Three",
      "One",
      "Four",
      "Five",
    ]);
    await reloadEditor(page);
    expect(await order(page)).toEqual(expected);
  });

  test("M2-14 keyboard: Space lifts, ArrowDown twice moves two places, Space drops; Escape cancels; the live region announces", async ({
    page,
    context,
  }) => {
    const user = await fiveBlocks(context, "rd3");
    await openEditor(page);
    const h = handle(page, FIVE[0]!);
    // The lift can be lost when the page has only just hydrated: press again until it is announced
    // (never once it has been, a second Space would drop the block).
    await expect(async () => {
      if (!(await liveRegion(page).innerText()).includes("Picked up One")) {
        await h.focus();
        await page.keyboard.press("Space");
      }
      await expect(liveRegion(page)).toContainText("Picked up One", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    // dnd-kit starts listening for the arrow keys a tick after the lift (and re-measures the list
    // after each move), so under load a key pressed at once can be lost: press again until the move
    // is announced, but never once the announcement is there.
    for (const position of [2, 3]) {
      await expect(async () => {
        const said = await liveRegion(page).innerText();
        if (!said.includes(`One moved to position ${position} of 5`)) {
          await page.keyboard.press("ArrowDown");
        }
        await expect(liveRegion(page)).toContainText(`One moved to position ${position} of 5`, {
          timeout: 1000,
        });
      }).toPass({ timeout: 15_000 });
    }
    await page.keyboard.press("Space");
    const expected = [FIVE[1], FIVE[2], FIVE[0], FIVE[3], FIVE[4]];
    await expect.poll(() => order(page)).toEqual(expected);
    await expect(liveRegion(page)).toContainText("dropped at position 3 of 5");
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectDraft(user.pageId, (d) => d.blocks[2]?.id === FIVE[0]);

    // Escape while lifted cancels.
    const again = handle(page, FIVE[1]!);
    await again.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    await expect(liveRegion(page)).toContainText("cancelled");
    expect(await order(page)).toEqual(expected);
    await page.waitForTimeout(1200);
    const stored = await expectDraft(user.pageId, () => true);
    expect(stored.blocks.map((b) => b.id)).toEqual(expected);
  });

  test("M2-14 Move up and Move down: disabled at the ends, announced, preview and draft follow", async ({
    page,
    context,
  }, info) => {
    const user = await fiveBlocks(context, "rd4");
    await openEditor(page);
    await rowButton(page, FIVE[1]!).click();
    const panel = page.locator(`#block-panel-${FIVE[1]}`);
    const up = panel.getByRole("button", { name: "Move up" });
    const down = panel.getByRole("button", { name: "Move down" });
    for (const button of [up, down]) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await css(button, "border-top-color")).toBe("rgb(201, 197, 190)");
      expect(await css(button, "border-top-width")).toBe("1px");
    }
    await expect(up).toBeEnabled();
    await up.click();
    await expect.poll(() => order(page)).toEqual([FIVE[1], FIVE[0], FIVE[2], FIVE[3], FIVE[4]]);
    const status = page.locator('div.sr-only[role="status"]');
    await expect(status).toHaveText("Moved to position 1 of 5");
    await expect(up).toBeDisabled(); // first now
    await expect(down).toBeFocused(); // focus moved to the twin button, not lost
    if (phoneOnly(info)) await page.getByRole("tab", { name: "Preview" }).click();
    expect(await previewOrder(page)).toEqual([FIVE[1], FIVE[0], FIVE[2], FIVE[3], FIVE[4]]);
    if (phoneOnly(info)) await page.getByRole("tab", { name: "Blocks" }).click();

    await down.click();
    await down.click();
    await down.click();
    await down.click();
    await expect.poll(() => order(page)).toEqual([FIVE[0], FIVE[2], FIVE[3], FIVE[4], FIVE[1]]);
    await expect(status).toHaveText("Moved to position 5 of 5");
    await expect(down).toBeDisabled(); // last now
    await expect(up).toBeFocused();
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectDraft(user.pageId, (d) => d.blocks[4]?.id === FIVE[1]);
  });

  test("M2-14 reordering does not change the live page until Publish; nested lists have no drag handles", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "rd5");
    await openEditor(page);
    const live = async () => (await rawRequest(`${user.handle}.localhost:3000`, "/")).body;
    const before = await live();
    const orderOf = (html: string) =>
      html.indexOf("Book a session") < html.indexOf("Portrait sessions");
    expect(orderOf(before)).toBe(true);

    const header = "Hd7mN3cYb8Ue";
    await rowButton(page, header).click();
    await page.locator(`#block-panel-${header}`).getByRole("button", { name: "Move down" }).click();
    await page.locator(`#block-panel-${header}`).getByRole("button", { name: "Move down" }).click();
    await page.locator(`#block-panel-${header}`).getByRole("button", { name: "Move down" }).click();
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectDraft(user.pageId, (d) => d.blocks.findIndex((b) => b.id === header) === 4);
    expect(orderOf(await live())).toBe(true); // still the published order

    // The social block's nested icons reorder with buttons: its row has exactly one drag handle.
    const social = "Sx4kT9pLq2Wa";
    await rowButton(page, social).click();
    await expect(rowOf(page, social).getByRole("button", { name: "Drag to reorder" })).toHaveCount(
      1,
    );
    await expect(
      page.locator(`#block-panel-${social}`).getByRole("button", { name: /Drag/ }),
    ).toHaveCount(0);
  });

  test("M2-14 phone: a vertical swipe that starts on a row scrolls the page and reorders nothing; targets are 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "touch layout");
    await fiveBlocks(context, "rd6");
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "li[data-block-id]");
    const before = await order(page);
    // Scroll the list to the middle of the screen, then swipe up from a row with real touch events.
    await page.evaluate(() => window.scrollTo(0, 150));
    await page.waitForTimeout(150);
    const box = (await rowButton(page, FIVE[2]!).boundingBox())!;
    expect(box.y).toBeGreaterThan(0);
    const scroller = await page.evaluate(() => window.scrollY);
    const cdp = await context.newCDPSession(page);
    const x = box.x + box.width / 2;
    const startY = Math.min(box.y + box.height / 2, 700);
    const point = (y: number) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(startY) });
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(startY - i * 25),
      });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.scrollY);
    expect(after).toBeGreaterThan(scroller + 100);
    expect(await order(page)).toEqual(before);
  });

  test("M2-14 desktop: pointer drag also works from the handle of the last row upward", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "pointer drag at 1440x900");
    await fiveBlocks(context, "rd7");
    await openEditor(page);
    await centerList(page);
    const from = (await handle(page, FIVE[4]!).boundingBox())!;
    const second = (await rowOf(page, FIVE[1]!).boundingBox())!;
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 12, { steps: 4 });
    await page.mouse.move(x, second.y + second.height * 0.2, { steps: 20 });
    await page.mouse.up();
    await expect.poll(() => order(page)).toEqual([FIVE[0], FIVE[4], FIVE[1], FIVE[2], FIVE[3]]);
  });
});
