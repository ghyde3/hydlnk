import { axeViolations } from "../fixtures/a11y";
import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  bid,
  chooser,
  expectDraft,
  focused,
  isPhone,
  openEditor,
  patchDraftAsUser,
  pageRow,
  previewScreen,
  reloadEditor,
  rowIds,
  rowOf,
  rows,
  saveIndicator,
  slotButton,
  slots,
  status,
  textBlocks,
  userWithBlocks,
} from "./history-helpers";
import { emptyUser } from "../m2/editor-helpers";
import { BLOCK_ID_PATTERN } from "@/lib/document";
import { inPreviewSheet } from "../m7/phone-preview";

/**
 * M6-04: a "+" before, between and after the blocks adds a block exactly there. One smoke per
 * viewport for the flow, the phone and desktop layout rules, the 50-block limit, and the abuse case
 * of a draft with a repeated id written straight to the database.
 */

test.afterAll(cleanupUsers);

const TYPE_ORDER = [
  "Link",
  "Card",
  "Header",
  "Text",
  "Image",
  "Social",
  "Embed",
  "Grid",
  "Divider",
];

test.describe("M6-04 the + between blocks", () => {
  test("M6-04 there is a + before, between and after the rows, in page order, outside the sortable items", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "ins1", textBlocks(3));
    await openEditor(page);
    await expect(rows(page)).toHaveCount(3);
    await expect(slots(page)).toHaveCount(4);
    for (let k = 1; k <= 4; k++) {
      const button = slotButton(page, k);
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
    // Not sortable: no drag handle, not a row, and never inside a row. In page order: slot 1, row 1,
    // slot 2, row 2, slot 3, row 3, slot 4.
    const order = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("ol > li"));
      return items.map((li) =>
        li.hasAttribute("data-add-slot")
          ? `slot ${li.getAttribute("data-add-slot")}`
          : `row ${li.getAttribute("data-block-id")}`,
      );
    });
    expect(order).toEqual([
      "slot 1",
      `row ${bid(1)}`,
      "slot 2",
      `row ${bid(2)}`,
      "slot 3",
      `row ${bid(3)}`,
      "slot 4",
    ]);
    await expect(slots(page).locator('[aria-label="Drag to reorder"]')).toHaveCount(0);
    await expect(page.locator("li[data-block-id] [data-add-slot]")).toHaveCount(0);
    // Tab reaches the "+" buttons in page order: the focus order puts slot 2 between row 1 and row 2.
    await slotButton(page, 1).focus();
    await page.keyboard.press("Tab"); // the handle of row 1
    await page.keyboard.press("Tab"); // its title button
    await page.keyboard.press("Tab"); // its visibility toggle
    await page.keyboard.press("Tab");
    await expect(slotButton(page, 2)).toBeFocused();

    // The card that appends is unchanged.
    const card = page.getByRole("region", { name: "Add a block" });
    await expect(card.getByText("Goes to the end of the page")).toBeVisible();
    expect(user.pageId).toBeTruthy();
  });

  test("M6-04 with no blocks there is no + and the empty state reads as before", async ({
    page,
    context,
  }) => {
    await emptyUser(context, "ins0");
    await openEditor(page);
    await expect(slots(page)).toHaveCount(0);
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
  });

  test("M6-04 the chooser opens under the gap with nine chips; Escape or a second click close it; another + closes the first", async ({
    page,
    context,
  }) => {
    await userWithBlocks(context, "ins2", textBlocks(3));
    await openEditor(page);

    await slotButton(page, 2).click();
    await expect(slotButton(page, 2)).toHaveAttribute("aria-expanded", "true");
    const first = chooser(page, 2);
    await expect(first).toBeVisible();
    const names = await first.getByRole("button").allTextContents();
    expect(names.map((n) => n.replace(/^\+\s*/, "").trim())).toEqual(TYPE_ORDER);
    // Right under the gap: the chooser starts below the "+" and above the next row.
    const plus = (await slotButton(page, 2).boundingBox())!;
    const box = (await first.boundingBox())!;
    const next = (await rowOf(page, bid(2)).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(plus.y + plus.height - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(next.y + 1);
    for (const chip of await first.getByRole("button").all()) {
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    }

    // The open chooser has no serious accessibility violation.
    expect(await axeViolations(page)).toEqual([]);

    // A second click on the same "+" closes it and keeps focus there.
    await slotButton(page, 2).click();
    await expect(first).toHaveCount(0);
    await expect(slotButton(page, 2)).toHaveAttribute("aria-expanded", "false");
    await expect(slotButton(page, 2)).toBeFocused();

    // Escape closes it from the "+" and from inside the chooser, and returns focus to the "+".
    await slotButton(page, 3).click();
    await expect(chooser(page, 3)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chooser(page, 3)).toHaveCount(0);
    await expect(slotButton(page, 3)).toBeFocused();
    await slotButton(page, 3).click();
    await chooser(page, 3).getByRole("button", { name: "Divider" }).focus();
    await page.keyboard.press("Escape");
    await expect(chooser(page, 3)).toHaveCount(0);
    await expect(slotButton(page, 3)).toBeFocused();

    // Opening another "+" closes the first.
    await slotButton(page, 1).click();
    await expect(chooser(page, 1)).toBeVisible();
    await slotButton(page, 4).click();
    await expect(chooser(page, 4)).toBeVisible();
    await expect(chooser(page, 1)).toHaveCount(0);
    await expect(slotButton(page, 1)).toHaveAttribute("aria-expanded", "false");
    // Nothing was added by opening and closing.
    await expect(rows(page)).toHaveCount(3);
  });

  test("M6-04 Header at position 3 inserts one block at index 2: opened, focused, announced, saved, kept after reload", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "ins3", textBlocks(7));
    await openEditor(page);
    const before = await rowIds(page);
    expect(before).toHaveLength(7);

    await slotButton(page, 3).click();
    await chooser(page, 3).getByRole("button", { name: "Header" }).click();

    await expect(rows(page)).toHaveCount(8);
    const after = await rowIds(page);
    const added = after[2]!;
    expect(before).not.toContain(added);
    expect(added).toMatch(BLOCK_ID_PATTERN);
    // Every other block keeps its place relative to the others.
    expect(after.filter((id) => id !== added)).toEqual(before);

    const row = rowOf(page, added);
    await expect(row).toHaveAttribute("data-block-type", "header");
    await expect(row.locator("button[aria-expanded]").first()).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Its first input has focus, the heading and the live preview follow, and the page says so.
    await expect.poll(async () => (await focused(page)).blockId).toBe(added);
    expect((await focused(page)).tag).toBe("INPUT");
    await expect(page.getByRole("heading", { level: 2, name: "Blocks · 8" })).toBeVisible();
    await inPreviewSheet(page, () => expect(previewScreen(page)).toContainText("New section"));
    await expect(status(page, "Header added at position 3 of 8.")).toHaveCount(1);
    // The chooser closed itself.
    await expect(chooser(page, 3)).toHaveCount(0);

    await expect(saveIndicator(page)).toHaveText("Saved");
    const stored = await expectDraft(user.pageId, (d) => d.blocks.length === 8);
    expect(stored.blocks.map((b) => b.id)).toEqual(after);
    expect(stored.blocks[2]).toMatchObject({ type: "header", text: "New section", visible: true });

    await reloadEditor(page);
    expect(await rowIds(page)).toEqual(after);
  });

  test("M6-04 position 1 inserts at the top, the last position appends, and a divider focuses its row", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "ins4", textBlocks(3));
    await openEditor(page);
    const before = await rowIds(page);

    await slotButton(page, 1).click();
    await chooser(page, 1).getByRole("button", { name: "Divider" }).click();
    await expect(rows(page)).toHaveCount(4);
    let ids = await rowIds(page);
    await expect(rowOf(page, ids[0]!)).toHaveAttribute("data-block-type", "divider");
    expect(ids.slice(1)).toEqual(before);
    // A divider has no input: the row itself is focused.
    await expect.poll(async () => (await focused(page)).blockId).toBe(ids[0]);
    await expect(rowOf(page, ids[0]!)).toBeFocused();

    await slotButton(page, 5).click();
    await chooser(page, 5).getByRole("button", { name: "Link" }).click();
    await expect(rows(page)).toHaveCount(5);
    ids = await rowIds(page);
    await expect(rowOf(page, ids[4]!)).toHaveAttribute("data-block-type", "link");
    expect(ids.slice(1, 4)).toEqual(before);
    await expect(status(page, "Link added at position 5 of 5.")).toHaveCount(1);

    await expectDraft(user.pageId, (d) => d.blocks.length === 5);
    const stored = (await pageRow(user.pageId)).draft;
    expect(stored.blocks.map((b) => b.id)).toEqual(ids);
  });

  test("M6-04 at 50 blocks every + is disabled and the limit message shows", async ({
    page,
    context,
  }) => {
    await userWithBlocks(
      context,
      "ins50",
      Array.from({ length: 50 }, (_, i) => ({ id: bid(i + 1), type: "divider", visible: true })),
    );
    await openEditor(page);
    await expect(slots(page)).toHaveCount(51);
    for (const button of await slots(page).getByRole("button").all()) {
      await expect(button).toBeDisabled();
    }
    await expect(page.getByText("You’ve reached the 50-block limit.")).toBeVisible();
    // The chips of the card are off too, and nothing was added.
    await expect(
      page.getByRole("region", { name: "Add a block" }).getByRole("button", { name: "Text" }),
    ).toBeDisabled();
    await expect(rows(page)).toHaveCount(50);
  });
});

test.describe("M6-04 layout", () => {
  test("M6-04 phone: each + slot is a full-width 44px row of its own, no row loses its size, the chooser wraps", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info));
    await userWithBlocks(context, "insl", textBlocks(3));
    await openEditor(page);
    const list = (await page
      .locator("ol")
      .filter({ has: page.locator("li[data-add-slot]") })
      .first()
      .boundingBox())!;
    for (let k = 1; k <= 4; k++) {
      const box = (await slotButton(page, k).boundingBox())!;
      expect(box.height).toBeCloseTo(44, 0);
      expect(box.width).toBeCloseTo(list.width, 0);
    }
    // A slot never overlaps a row, and the controls of a row keep their size.
    const rects = await page.evaluate(() =>
      Array.from(document.querySelectorAll("ol > li")).map((li) => {
        const r = li.getBoundingClientRect();
        return { slot: li.hasAttribute("data-add-slot"), top: r.top, bottom: r.bottom };
      }),
    );
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i]!.top).toBeGreaterThanOrEqual(rects[i - 1]!.bottom - 0.5);
    }
    const row = rowOf(page, bid(1));
    expect(
      (await row.getByRole("button", { name: "Drag to reorder" }).boundingBox())!.width,
    ).toBeCloseTo(44, 0);
    expect(
      (await row.locator("button[aria-expanded]").first().boundingBox())!.height,
    ).toBeGreaterThanOrEqual(57.5);
    expect(
      (await row.getByRole("button", { name: "Visible on page" }).boundingBox())!.height,
    ).toBeCloseTo(48, 0);

    await slotButton(page, 2).click();
    await expect(chooser(page, 2)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const chipBoxes = await chooser(page, 2)
      .getByRole("button")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect(new Set(chipBoxes.map((top) => Math.round(top))).size).toBeGreaterThan(1);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[role='tabpanel']");
  });

  test("M6-04 desktop: a slot is a 20px hairline whose circle shows on hover and on focus, inside the 720px column", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info));
    await userWithBlocks(context, "insd", textBlocks(3));
    await openEditor(page);
    const column = (await page.locator("[role='tabpanel']").boundingBox())!;
    expect(column.width).toBeLessThanOrEqual(720.5);
    const box = (await slotButton(page, 2).boundingBox())!;
    expect(box.height).toBeCloseTo(20, 0);
    expect(box.x).toBeGreaterThanOrEqual(column.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width + 0.5);

    // The circle is hidden (scale 0) until the slot is hovered or has keyboard focus.
    const circle = slotButton(page, 2).locator("span").nth(1);
    const scaleOf = () =>
      circle.evaluate((el) => {
        const value = parseFloat(getComputedStyle(el).scale);
        return Number.isNaN(value) ? 1 : value;
      });
    expect(await scaleOf()).toBe(0);
    await slotButton(page, 2).hover();
    await expect.poll(scaleOf).toBe(1);
    await page.mouse.move(0, 0);
    await expect.poll(scaleOf).toBe(0);
    await slotButton(page, 3).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(slotButton(page, 3)).toBeFocused();
    await expect
      .poll(() =>
        slotButton(page, 3)
          .locator("span")
          .nth(1)
          .evaluate((el) => parseFloat(getComputedStyle(el).scale)),
      )
      .toBe(1);

    await slotButton(page, 2).click();
    const chooserBox = (await chooser(page, 2).boundingBox())!;
    expect(chooserBox.width).toBeLessThanOrEqual(720.5);
    // Nine chips fit in at most two rows.
    const tops = await chooser(page, 2)
      .getByRole("button")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBeLessThanOrEqual(2);
    expect(isPhone(page)).toBe(false);
  });
});

test.describe("M6-04 abuse: a repeated id written straight to the database", () => {
  test("M6-04 two blocks that share an id: the editor keeps the first, and Publish refuses the stored draft", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "insab", textBlocks(2));
    await openEditor(page);
    // Publish first so there is a live page that must not change.
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveText("Published", {
      timeout: 20_000,
    });
    const before = await pageRow(user.pageId);

    const clash = [
      { id: bid(1), type: "text", visible: true, text: "First" },
      { id: bid(2), type: "text", visible: true, text: "Middle" },
      { id: bid(1), type: "text", visible: true, text: "Second, same id" },
    ];
    await patchDraftAsUser(context, user.pageId, {
      ...before.draft,
      rev: before.draft.rev + 50,
      blocks: clash,
    });

    await reloadEditor(page);
    await expect(
      page.getByText(
        "Some content couldn’t be read and was reset in the editor. Nothing is saved until you edit.",
      ),
    ).toBeVisible();
    // The first of the two stays; the second is dropped.
    expect(await rowIds(page)).toEqual([bid(1), bid(2)]);
    await expect(page.getByRole("heading", { level: 2, name: "Blocks · 2" })).toBeVisible();

    // The Publish gate refuses the stored draft itself (nothing was edited, so nothing was saved).
    expect((await pageRow(user.pageId)).draft.blocks).toHaveLength(3);
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText("Ids must be unique within a page.");
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
  });
});
