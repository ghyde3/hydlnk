import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  chooseThemeMenuItem,
  expectNoThemeApplied,
  messageOf,
  openDesignWithCard,
  savedThemesCard,
  seedTheme,
  setTheme,
  storedTheme,
  themeCards,
  themeRowsOf,
  themeUser,
} from "../m3/themes-helpers";
import {
  cardOf,
  dialogOf,
  drawn,
  openDialog,
  openEditor,
  pageRow,
  previewOf,
  rect,
  richUser,
  setDraft,
} from "../m7/templates-helpers";
import { TEMPLATES } from "@/lib/templates";
import { box } from "./page-helpers";

/**
 * M9-33 (the template picker's previews start at the top of the page, photo and name included) and
 * M9-34 (deleting the applied theme shows the M5-16 notice at once), end to end. Each test makes its
 * own user; mara's rows are never touched.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const NOTICE = "The theme this page used was deleted. It now uses the default theme.";

test.describe("M9-33 the template previews show the top of the page", () => {
  test("M9-33 every card's window is 300px tall and holds the person's photo and display name, then at least 24px of the template's first block", async ({
    page,
    context,
  }, info) => {
    await richUser(context, "tp33a");
    await openEditor(page);
    await openDialog(page);
    const heights = new Set<number>();
    for (const template of TEMPLATES) {
      const name = template.name;
      await drawn(page, name);
      const preview = previewOf(page, name);
      const frame = await rect(preview);
      heights.add(Math.round(frame.height));
      expect(Math.abs(frame.height - 300), name).toBeLessThanOrEqual(1);

      const root = preview.locator("[data-page-root]");
      const avatar = await rect(root.locator('[data-profile-part="avatar"]'));
      const nameBox = await rect(root.locator('[data-profile-part="name"]'));
      const first = await rect(root.locator("main > *").first());
      for (const [label, part] of [
        ["photo", avatar],
        ["name", nameBox],
      ] as const) {
        expect(part.y, `${name} ${label} top`).toBeGreaterThanOrEqual(frame.y - 0.5);
        expect(part.y + part.height, `${name} ${label} bottom`).toBeLessThanOrEqual(
          frame.y + frame.height + 0.5,
        );
        expect(part.x, `${name} ${label} left`).toBeGreaterThanOrEqual(frame.x - 0.5);
        expect(part.x + part.width, `${name} ${label} right`).toBeLessThanOrEqual(
          frame.x + frame.width + 0.5,
        );
      }
      // At least 24px of the first block shows below them, or all of it when the block itself is
      // shorter (a one-line header or text block is 17 to 25px tall at the card's scale).
      const visible =
        Math.min(first.y + first.height, frame.y + frame.height) -
        Math.max(first.y, nameBox.y + nameBox.height);
      expect(visible, `${name} first block`).toBeGreaterThanOrEqual(
        Math.min(24, first.height) - 0.5,
      );
      expect(first.y, `${name} first block below the name`).toBeGreaterThanOrEqual(
        nameBox.y + nameBox.height - 0.5,
      );
    }
    // The same height on all six, at either viewport.
    expect(heights.size).toBe(1);
    expect(phoneOnly(info) || desktopOnly(info)).toBe(true);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, '[role="dialog"]');
  });

  test("M9-33 the window starts at the page's top even when the photo, the name or the bio are off, or the name is 60 characters, and never overflows the card", async ({
    page,
    context,
  }) => {
    const user = await richUser(context, "tp33b");
    const base = (await pageRow(user.pageId)).draft;

    // All three off: the first block shows from the top of the column.
    await setDraft(user.pageId, {
      ...base,
      profile: { ...base.profile, showPhoto: false, showName: false, showBio: false },
    });
    await openEditor(page);
    await openDialog(page);
    for (const template of TEMPLATES) {
      await drawn(page, template.name);
      const preview = previewOf(page, template.name);
      const frame = await rect(preview);
      const root = preview.locator("[data-page-root]");
      await expect(root.locator('[data-profile-part="avatar"]')).toHaveCount(0);
      const first = await rect(root.locator("main > *").first());
      // Under the column's own top padding, not under an empty profile.
      expect(first.y - frame.y, template.name).toBeLessThanOrEqual(70);
      expect(first.height).toBeGreaterThan(8);
    }

    // The name off, the photo and bio on: the photo shows and starts the page.
    await setDraft(user.pageId, {
      ...base,
      profile: { ...base.profile, showName: false },
    });
    await page.reload();
    await openDialog(page);
    const musician = await drawn(page, TEMPLATES[0]!.name);
    await expect(musician.locator('[data-profile-part="avatar"]')).toBeVisible();
    await expect(musician.locator('[data-profile-part="name"]')).toHaveCount(0);

    // A 60-character name: the preview clips, nothing leaves the card.
    await setDraft(user.pageId, {
      ...base,
      profile: { ...base.profile, name: "N".repeat(60) },
    });
    await page.reload();
    await openDialog(page);
    for (const template of TEMPLATES) {
      await drawn(page, template.name);
      const card = await rect(cardOf(page, template.name));
      const preview = await rect(previewOf(page, template.name));
      expect(preview.x).toBeGreaterThanOrEqual(card.x - 0.5);
      expect(preview.x + preview.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(preview.y + preview.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
      expect(Math.abs(preview.height - 300)).toBeLessThanOrEqual(1);
    }
    await expectNoHorizontalScroll(page);
  });

  test("M9-33 with a draft of 50 blocks the previews still show the template's blocks, and the dialog is the sheet on a phone and at most 720px on a desktop", async ({
    page,
    context,
  }, info) => {
    const user = await richUser(context, "tp33c");
    const base = (await pageRow(user.pageId)).draft;
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      id: `Zq9Divider${String(i).padStart(3, "0")}`,
      type: "divider",
      visible: true,
    }));
    await setDraft(user.pageId, { ...base, blocks: fifty });
    await openEditor(page);
    await openDialog(page);
    const root = await drawn(page, TEMPLATES[0]!.name);
    await expect(root.locator("main > [data-block-type]").first()).not.toHaveAttribute(
      "data-block-type",
      "divider",
    );

    const dialog = dialogOf(page);
    const sheet = await box(dialog);
    if (phoneOnly(info)) {
      expect(Math.round(sheet.width)).toBe(page.viewportSize()!.width);
      // The six cards stack, each preview the card's full width less its padding.
      const xs = await dialog
        .locator("li[data-template-id]")
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
      expect(new Set(xs).size).toBe(1);
    } else {
      expect(sheet.width).toBeLessThanOrEqual(720.5);
      const xs = await dialog
        .locator("li[data-template-id]")
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
      expect(new Set(xs).size).toBe(2);
    }
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M9-34 deleting the applied theme", () => {
  async function setup(
    context: Parameters<typeof themeUser>[0],
    label: string,
    name = "Shared look",
  ) {
    const user = await themeUser(context, label, "pro");
    const shared = await seedTheme(user.userId, name, { accent: "#C46A4F" });
    await setTheme(user.pageId, shared.id, { radius: 20 });
    return { user, shared, name };
  }
  const confirmDelete = async (page: Page, name: string) => {
    await chooseThemeMenuItem(page, name, "Delete");
    await page
      .getByTestId("delete-theme-dialog")
      .getByRole("button", { name: "Delete theme" })
      .click();
    await expect(page.getByTestId("delete-theme-dialog")).toHaveCount(0);
  };
  const notice = (page: Page) => savedThemesCard(page).getByTestId("theme-deleted-notice");

  test("M9-34 the card shows 'Deleted Shared look.' with Undo and, one under the other, the notice; the draft is on the default theme", async ({
    page,
    context,
  }, info) => {
    const { user, shared } = await setup(context, "tn1");
    await openDesignWithCard(page);
    await expect(notice(page)).toHaveCount(0);
    await confirmDelete(page, "Shared look");

    await expect(messageOf(page)).toContainText("Deleted Shared look.");
    const undo = savedThemesCard(page).getByTestId("theme-undo");
    await expect(undo).toBeVisible();
    await expect(notice(page)).toHaveText(NOTICE);
    await expect(notice(page)).toHaveAttribute("role", "status");
    // One polite status region holds the message (a phone draws the message fixed above the tab bar).
    await expect(savedThemesCard(page).getByTestId("theme-message-region")).toBeAttached();

    // The draft resolves to the default theme and keeps its own overrides.
    await expectNoThemeApplied(page);
    await expect
      .poll(async () => (await storedTheme(user.pageId)).ref, { timeout: 15_000 })
      .toBeNull();
    expect((await storedTheme(user.pageId)).overrides).toEqual({ radius: 20 });
    expect(await themeRowsOf(user.userId)).toHaveLength(0);
    expect(shared.id).toBeTruthy();

    // Placement: both messages are inside the Themes card, above the two carousels; nothing scrolls sideways.
    const msg = await box(messageOf(page));
    const note = await box(notice(page));
    const rows = await box(savedThemesCard(page).getByTestId("own-themes"));
    expect(rows.y).toBeGreaterThanOrEqual(note.y + note.height - 1);
    expect(note.height).toBeGreaterThan(20);
    expect((await box(undo)).height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
    if (phoneOnly(info)) {
      // The message sits above the bottom tab bar and clear of the mini phone at the right.
      const viewport = page.viewportSize()!;
      expect(msg.y + msg.height).toBeLessThanOrEqual(viewport.height - 60);
      const mini = page.getByTestId("mini-phone");
      if (await mini.count()) {
        const miniBox = await box(mini);
        expect(msg.x + msg.width).toBeLessThanOrEqual(miniBox.x - 1);
      }
    } else {
      expect(desktopOnly(info)).toBe(true);
      const card = await box(savedThemesCard(page));
      expect(card.width).toBeLessThanOrEqual(720.5);
      expect(note.x).toBeGreaterThanOrEqual(card.x);
      expect(note.x + note.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
  });

  test("M9-34 the message and Undo last at least 8 seconds and then go; the notice stays until a theme is applied", async ({
    page,
    context,
  }) => {
    await setup(context, "tn2");
    await openDesignWithCard(page);
    await confirmDelete(page, "Shared look");
    await expect(messageOf(page)).toBeVisible();
    await page.waitForTimeout(8000);
    await expect(messageOf(page)).toContainText("Deleted Shared look.");
    await expect(savedThemesCard(page).getByTestId("theme-undo")).toBeVisible();
    await expect(messageOf(page)).toHaveCount(0, { timeout: 6000 });
    await expect(notice(page)).toHaveText(NOTICE);

    // Applying a HYDLNK theme clears it and says 'Applied Noir.'.
    await savedThemesCard(page)
      .getByTestId("system-themes")
      .getByRole("button", { name: /^Noir/ })
      .click();
    await expect(notice(page)).toHaveCount(0);
    await expect(messageOf(page)).toContainText("Applied Noir.");
  });

  test("M9-34 Undo creates the theme again, applies it, and the notice goes with it", async ({
    page,
    context,
  }) => {
    const { user } = await setup(context, "tn3");
    await openDesignWithCard(page);
    await confirmDelete(page, "Shared look");
    await expect(notice(page)).toBeVisible();
    await savedThemesCard(page).getByTestId("theme-undo").click();

    await expect(messageOf(page)).toContainText("Undone.");
    await expect(notice(page)).toHaveCount(0);
    await expect(themeCards(page).filter({ hasText: "Shared look" })).toHaveCount(1);
    const rows = await themeRowsOf(user.userId);
    expect(rows.map((row) => row.name)).toEqual(["Shared look"]);
    await expect
      .poll(async () => (await storedTheme(user.pageId)).ref, { timeout: 15_000 })
      .toBe(rows[0]!.id);
    expect((await storedTheme(user.pageId)).overrides).toEqual({ radius: 20 });
  });

  test("M9-34 deleting a theme that is not the applied one shows the message and no notice", async ({
    page,
    context,
  }) => {
    const { user } = await setup(context, "tn4");
    await seedTheme(user.userId, "Other look");
    await openDesignWithCard(page);
    await confirmDelete(page, "Other look");
    await expect(messageOf(page)).toContainText("Deleted Other look.");
    await expect(notice(page)).toHaveCount(0);
    expect((await storedTheme(user.pageId)).ref).not.toBeNull();
  });

  test("M9-34 a theme named with markup is drawn as characters in the message, never in the notice; no dialog opens", async ({
    page,
    context,
  }) => {
    const { user } = await setup(context, "tn5", "<b>x</b>");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openDesignWithCard(page);
    await confirmDelete(page, "<b>x</b>");
    await expect(messageOf(page)).toContainText("Deleted <b>x</b>.");
    expect(await messageOf(page).locator("b").count()).toBe(0);
    await expect(notice(page)).toHaveText(NOTICE);
    expect(await notice(page).innerText()).not.toContain("<b>");
    expect(dialogs).toEqual([]);
    expect(user.userId).toBeTruthy();
  });

  test("M9-34 another user's themes are never listed or deletable; a theme deleted behind the screen's back shows the notice through the M5-16 path", async ({
    page,
    context,
  }) => {
    const { user, shared } = await setup(context, "tn6");
    const stranger = await themeUser(context, "tn7", "pro");
    // The stranger's signed-in session replaced ours on this context: sign the first user back in.
    expect(stranger.userId).not.toBe(user.userId);
    const other = await seedTheme(stranger.userId, "Strangers theme");
    const read = await adminClient().from("themes").select("id").eq("id", other.id);
    expect(read.data).toHaveLength(1);
    // Behind the back: the row goes while the draft still names it; the next load shows the notice.
    await adminClient().from("themes").delete().eq("id", shared.id);
    await setTheme(stranger.pageId, other.id, {});
    await adminClient().from("themes").delete().eq("id", other.id);
    await openDesignWithCard(page);
    await expect(notice(page)).toHaveText(NOTICE);
    await expect(savedThemesCard(page)).not.toContainText("Strangers theme");
    expect(await pageRow(stranger.pageId)).toBeTruthy();
  });
});
