import { expect, test } from "@playwright/test";
import { cleanupUsers, phoneOnly } from "../fixtures/data";
import {
  applyTemplateChoice,
  blocksHeading,
  expectDraft,
  openDialog,
  openEditor,
  pageRow,
  publishButton,
  saveIndicator,
  toastOf,
  toastUndo,
} from "../m6/templates-helpers";
import { shapedUser } from "./templates-helpers";
import { clickTab, redoButton, undoButton } from "./workspace-helpers";

/**
 * M7-08 steps 4, 6 and 7, which need the whole workspace: the template toast belongs to it, so it
 * stays when the person switches tab; the toolbar's Undo and Redo serve it; Publish from another
 * tab stops at 'Fix 5 blocks'; and on a phone the toast ends clear of the mini phone (M7-09).
 */

test.afterAll(cleanupUsers);

test.describe("M7-08 a template apply in the workspace", () => {
  test("M7-08 the toast stays across a tab switch, the toolbar's Undo and Redo serve the apply, and Ctrl+Z does too", async ({
    page,
    context,
  }) => {
    const user = await shapedUser(context, "tw1", "blank");
    await openEditor(page);
    await openDialog(page);
    await applyTemplateChoice(page, "Musician", "keep");
    await expect(blocksHeading(page, 6)).toBeVisible();
    await expect(toastOf(page)).toContainText("Applied the Musician template.");
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 5_000 });

    // The toast is the workspace's: it is still there on the other tabs (same page, no reload).
    await clickTab(page, "Design");
    await expect(toastOf(page)).toBeVisible();
    await clickTab(page, "Share");
    await expect(toastOf(page)).toBeVisible();
    expect((await toastUndo(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // The toolbar's Undo, from this tab, restores the page as it was; Redo applies it again.
    await undoButton(page).click();
    await expectDraft(user.pageId, (draft) => draft.blocks.length === 0);
    const undone = (await pageRow(user.pageId)).draft;
    expect(undone.theme).toEqual(user.before.theme);
    expect(undone.profile).toEqual(user.before.profile);
    expect(undone.blocks).toEqual(user.before.blocks);
    await redoButton(page).click();
    await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);
    // Ctrl+Z is the same one step.
    await page.keyboard.press("Control+z");
    await expectDraft(user.pageId, (draft) => draft.blocks.length === 0);
  });

  test("M7-08 Publish from the Design tab stops at 'Fix 5 blocks', takes you to the Edit tab, and publishes nothing", async ({
    page,
    context,
  }) => {
    const user = await shapedUser(context, "tw2", "theme");
    await openEditor(page);
    await openDialog(page);
    await applyTemplateChoice(page, "Musician", "keep");
    await expect(blocksHeading(page, 6)).toBeVisible();
    await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);

    await clickTab(page, "Design");
    await publishButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: /before publishing/ });
    await expect(alert).toContainText("Fix 5 blocks before publishing.");
    // A block with a field to fix is on the Edit tab: the refusal took the workspace there.
    await expect(page).toHaveURL(/\/editor$/);
    expect((await pageRow(user.pageId)).published).toBeNull();
  });

  test("M7-08 on a phone the toast ends clear of the mini phone and above the tab bar, with a tappable Undo", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the mini phone is a phone control");
    await shapedUser(context, "tw3", "blank");
    await openEditor(page);
    await openDialog(page);
    await applyTemplateChoice(page, "Musician", "keep");
    await expect(blocksHeading(page, 6)).toBeVisible();
    const toast = (await toastOf(page).boundingBox())!;
    const phone = (await page.getByTestId("mini-phone").boundingBox())!;
    const undo = (await toastUndo(page).boundingBox())!;
    expect(toast.x + toast.width).toBeLessThanOrEqual(phone.x - 8 + 0.5);
    expect(toast.x).toBeGreaterThanOrEqual(0);
    expect(undo.height).toBeGreaterThanOrEqual(44);
    // Above the bottom tab bar (57px and the safe area).
    expect(toast.y + toast.height).toBeLessThanOrEqual(844 - 57 + 0.5);
  });
});
