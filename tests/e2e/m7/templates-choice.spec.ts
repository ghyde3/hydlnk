import { expect, test, type Page, type Request } from "@playwright/test";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, phoneOnly, insertPage } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { accessToken } from "../m2/editor-helpers";
import { url } from "../helpers";
import { seedTheme } from "../m3/themes-helpers";
import { PROFILE_OPTION_DEFAULTS } from "@/lib/document";
import { applyTemplate, templateById } from "@/lib/templates";
import {
  SHAPE_DEFAULTS,
  SYSTEM_IDS,
  applyTemplateChoice,
  blocksHeading,
  choiceOf,
  dialogOf,
  describeBlocks,
  describeTemplate,
  emptyPageUser,
  expectDraft,
  expectNoHorizontalScroll,
  expectTapTargets,
  openDialog,
  openEditor,
  pageRow,
  publishButton,
  rect,
  richUser,
  saveIndicator,
  setDraft,
  shapedDraft,
  shapedUser,
  startButton,
  statusChip,
  templateButton,
  templateOf,
  toastOf,
  toastUndo,
  userThemeRows,
  watchWrites,
  type DraftDoc,
  type Shape,
} from "./templates-helpers";

/**
 * M7-08, applying a template with one clear choice: the template's style, or keep my style. Each
 * test makes its own user; mara's rows are never touched. The pure parts (the default, what each
 * style changes, the reducer's action) are in tests/unit/m7-templates-style.test.ts.
 */

test.afterAll(cleanupUsers);

const MUSICIAN = templateOf("Musician");
const TEMPLATE_RADIO = "Use the blocks and the Midnight style";
const KEEP_RADIO = "Use the blocks only and keep my current style";
const STAYS = "Your name, photo, share card and saved themes stay.";
const REPLACED = "Your current blocks are replaced.";

/**
 * The draft as the editor holds it, without `rev`: a stored draft may lack profile display options
 * (the editor fills the same defaults), and `rev` is not part of what an apply or an undo restores.
 */
const normalized = (draft: DraftDoc) => {
  const copy: Partial<DraftDoc> = {
    ...draft,
    profile: { ...PROFILE_OPTION_DEFAULTS, ...draft.profile },
  };
  delete copy.rev;
  return copy;
};
const profileOf = (draft: DraftDoc) => ({ ...PROFILE_OPTION_DEFAULTS, ...draft.profile });

const radio = (page: Page, name: string) =>
  choiceOf(page, "Musician").getByRole("radio", { name, exact: true });

test.describe("M7-08 the panel", () => {
  test("M7-08 Use this template does not apply at once: a group with a Style radiogroup, two radios, what stays, Apply template and Cancel; focus on the checked radio", async ({
    page,
    context,
  }) => {
    const user = await emptyPageUser(context, "tc8-a");
    await openEditor(page);
    const writes = watchWrites(page);
    await openDialog(page);
    await templateButton(page, "Musician").click();

    const group = choiceOf(page, "Musician");
    await expect(group).toBeVisible();
    // Announced politely: by the live region that is always in the card around the panel.
    await expect(group.locator("xpath=ancestor::*[@aria-live='polite'][1]")).toHaveCount(1);
    const styleGroup = group.getByRole("radiogroup", { name: "Style", exact: true });
    await expect(styleGroup).toBeVisible();
    await expect(styleGroup.getByRole("radio")).toHaveCount(2);
    await expect(radio(page, TEMPLATE_RADIO)).toBeVisible();
    await expect(radio(page, KEEP_RADIO)).toBeVisible();
    // Native radios, in a page that has no theme, no overrides and no blocks: the template's style.
    expect(await radio(page, TEMPLATE_RADIO).evaluate((el) => (el as HTMLInputElement).type)).toBe(
      "radio",
    );
    await expect(radio(page, TEMPLATE_RADIO)).toBeChecked();
    await expect(radio(page, KEEP_RADIO)).not.toBeChecked();
    await expect(radio(page, TEMPLATE_RADIO)).toBeFocused();

    await expect(group.getByText(STAYS, { exact: true })).toBeVisible();
    // An empty page has no blocks to replace, and is still asked.
    await expect(group.getByText(REPLACED)).toHaveCount(0);

    // Each row, and each button, is at least 44px tall.
    for (const style of ["template", "keep"]) {
      expect(
        (await rect(group.locator(`[data-style-option="${style}"]`))).height,
      ).toBeGreaterThanOrEqual(44);
    }
    const apply = group.getByRole("button", { name: "Apply template", exact: true });
    const cancel = group.getByRole("button", { name: "Cancel", exact: true });
    expect((await rect(apply)).height).toBeGreaterThanOrEqual(44);
    expect((await rect(cancel)).height).toBeGreaterThanOrEqual(44);
    // Apply is the charcoal button; Cancel is the secondary one (white, 1px border).
    expect(await apply.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(28, 27, 26)",
    );
    const secondary = await cancel.evaluate((el) => {
      const css = getComputedStyle(el);
      return { bg: css.backgroundColor, width: css.borderTopWidth };
    });
    expect(secondary).toEqual({ bg: "rgb(255, 255, 255)", width: "1px" });

    // Nothing was written by asking.
    await page.waitForTimeout(1_500);
    expect(writes.patches).toEqual([]);
    expect((await pageRow(user.pageId)).draft.blocks).toEqual([]);
  });

  test("M7-08 Cancel returns to the card with focus on its button; Escape and Close close the dialog; the draft is exactly as it was and nothing is written", async ({
    page,
    context,
  }) => {
    const user = await shapedUser(context, "tc8-b", "both");
    const before = await pageRow(user.pageId);
    await openEditor(page);
    const writes = watchWrites(page);
    await openDialog(page);

    await templateButton(page, "Musician").click();
    await expect(choiceOf(page, "Musician")).toBeVisible();
    // This page has blocks: they would be replaced, and it says so.
    await expect(choiceOf(page, "Musician").getByText(REPLACED, { exact: true })).toBeVisible();
    await choiceOf(page, "Musician").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(choiceOf(page, "Musician")).toHaveCount(0);
    await expect(templateButton(page, "Musician")).toBeFocused();
    await expect(dialogOf(page)).toBeVisible();

    await templateButton(page, "Musician").click();
    await expect(choiceOf(page, "Musician")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(startButton(page)).toBeFocused();

    await openDialog(page);
    await templateButton(page, "Coach").click();
    await expect(choiceOf(page, "Coach")).toBeVisible();
    await dialogOf(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialogOf(page)).toHaveCount(0);

    await page.waitForTimeout(1_500);
    expect(writes.patches).toEqual([]);
    expect(await pageRow(user.pageId)).toEqual(before);
  });
});

test.describe("M7-08 the default follows the page", () => {
  for (const shape of Object.keys(SHAPE_DEFAULTS) as Shape[]) {
    test(`M7-08 a page with ${shape === "blank" ? "nothing" : shape} opens on ${SHAPE_DEFAULTS[shape] === "template" ? "the template's style" : "keep my style"}`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "the default is logic, not layout: one viewport");
      await shapedUser(context, `tc8-d-${shape}`, shape);
      await openEditor(page);
      await openDialog(page);
      await templateButton(page, "Musician").click();
      const expected = SHAPE_DEFAULTS[shape] === "template" ? TEMPLATE_RADIO : KEEP_RADIO;
      const other = SHAPE_DEFAULTS[shape] === "template" ? KEEP_RADIO : TEMPLATE_RADIO;
      await expect(radio(page, expected)).toBeChecked();
      await expect(radio(page, other)).not.toBeChecked();
    });
  }

  test("M7-08 the default is only a default: the other radio sticks until Apply, and reopening the panel resets it", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport");
    await shapedUser(context, "tc8-e", "theme");
    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Musician").click();
    await expect(radio(page, KEEP_RADIO)).toBeChecked();

    // Pick the other one: it stays selected while the person works in the panel.
    await radio(page, TEMPLATE_RADIO).check();
    await expect(radio(page, TEMPLATE_RADIO)).toBeChecked();
    await expect(radio(page, KEEP_RADIO)).not.toBeChecked();
    await choiceOf(page, "Musician").getByText(STAYS).click();
    await expect(radio(page, TEMPLATE_RADIO)).toBeChecked();

    // The arrow keys move the choice, like any radio group.
    await radio(page, TEMPLATE_RADIO).focus();
    await page.keyboard.press("ArrowDown");
    await expect(radio(page, KEEP_RADIO)).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(radio(page, TEMPLATE_RADIO)).toBeChecked();

    // Cancel, then open it again: back on the default.
    await choiceOf(page, "Musician").getByRole("button", { name: "Cancel", exact: true }).click();
    await templateButton(page, "Musician").click();
    await expect(radio(page, KEEP_RADIO)).toBeChecked();
    await expect(radio(page, TEMPLATE_RADIO)).not.toBeChecked();
  });
});

test.describe("M7-08 applying", () => {
  test("M7-08 the blocks and the template's style: blocks replaced, theme becomes the template's with no overrides, nothing else of the page or the person moves, one write", async ({
    page,
    context,
  }, info) => {
    const user = await richUser(context, "tc8-f");
    await seedTheme(user.id, "Keep me", { accent: "#112233" });
    const themesBefore = await userThemeRows(user.id);
    const before = await pageRow(user.pageId);
    await openEditor(page);
    const writes = watchWrites(page);
    const log: { url: string; action: boolean }[] = [];
    page.on("request", (request: Request) =>
      log.push({ url: request.url(), action: request.headers()["next-action"] !== undefined }),
    );

    await openDialog(page);
    await applyTemplateChoice(page, "Musician", "template");

    // The dialog closes, focus returns, the count and the chip update at once.
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(startButton(page)).toBeFocused();
    await expect(blocksHeading(page, 6)).toBeVisible();
    await expect(statusChip(page)).toHaveText(/Unpublished changes|Not published/);
    if (desktopOnly(info)) {
      await expect(page.getByTestId("preview-screen")).toContainText("Listen now");
    }
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 3_000 });

    const stored = await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(MUSICIAN));
    expect(stored.blocks.every((block) => block.visible === true)).toBe(true);
    expect(stored.theme).toEqual({ ref: SYSTEM_IDS.Midnight, overrides: {} });
    // The name, photo, bio they wrote, every profile option and the share card stay.
    expect(stored.profile).toEqual(profileOf(before.draft));
    expect(stored.share).toEqual(before.draft.share);

    // One PATCH, carrying only the draft; nothing else written, no Storage call, no Server Action.
    expect(writes.patches).toHaveLength(1);
    expect(Object.keys(writes.patches[0]!.body)).toEqual(["draft"]);
    expect(writes.others).toEqual([]);
    expect(writes.serverActions).toEqual([]);
    expect(log.filter((entry) => entry.url.includes("/rest/v1/themes"))).toEqual([]);
    expect(log.filter((entry) => entry.url.includes("/storage/v1/"))).toEqual([]);
    expect(log.filter((entry) => entry.action)).toEqual([]);
    expect(await userThemeRows(user.id)).toEqual(themesBefore);

    const toast = toastOf(page);
    await expect(toast).toHaveText(
      "Applied the Musician template. Add your links, then publish.Undo",
    );
    await expect(page.getByTestId("template-toast-region")).toHaveAttribute("aria-live", "polite");
    expect((await rect(toastUndo(page))).height).toBeGreaterThanOrEqual(44);
  });

  test("M7-08 the blocks only: the page's theme reference and overrides are exactly what they were", async ({
    page,
    context,
  }) => {
    const user = await richUser(context, "tc8-g");
    await seedTheme(user.id, "Keep me too", { accent: "#445566" });
    const themesBefore = await userThemeRows(user.id);
    const before = await pageRow(user.pageId);
    expect(before.draft.theme.ref).toBe(SYSTEM_IDS.Noir);
    await openEditor(page);
    const writes = watchWrites(page);
    const log: { url: string; action: boolean }[] = [];
    page.on("request", (request: Request) =>
      log.push({ url: request.url(), action: request.headers()["next-action"] !== undefined }),
    );

    await openDialog(page);
    // This page has a theme: the default is already "keep".
    await templateButton(page, "Musician").click();
    await expect(radio(page, KEEP_RADIO)).toBeChecked();
    await choiceOf(page, "Musician")
      .getByRole("button", { name: "Apply template", exact: true })
      .click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(blocksHeading(page, 6)).toBeVisible();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 3_000 });

    const stored = await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(MUSICIAN));
    expect(stored.theme).toEqual(before.draft.theme);
    expect(stored.profile).toEqual(profileOf(before.draft));
    expect(stored.share).toEqual(before.draft.share);
    expect(writes.patches).toHaveLength(1);
    expect(Object.keys(writes.patches[0]!.body)).toEqual(["draft"]);
    expect(writes.others).toEqual([]);
    expect(writes.serverActions).toEqual([]);
    expect(log.filter((entry) => entry.url.includes("/rest/v1/themes"))).toEqual([]);
    expect(log.filter((entry) => entry.url.includes("/storage/v1/"))).toEqual([]);
    expect(log.filter((entry) => entry.action)).toEqual([]);
    expect(await userThemeRows(user.id)).toEqual(themesBefore);
    await expect(toastOf(page)).toContainText("Applied the Musician template.");
  });

  test("M7-08 the sample bio is written only when the bio is empty, for both styles", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport");
    const user = await shapedUser(context, "tc8-h", "blank");
    await openEditor(page);
    await openDialog(page);
    await applyTemplateChoice(page, "Coach", "keep");
    await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);
    const stored = (await pageRow(user.pageId)).draft;
    expect(stored.profile.bio).toBe("Clear steps, honest feedback, real results.");
    // Keep my style: this page had none, and the template did not give it one.
    expect(stored.theme).toEqual({ ref: null, overrides: {} });
  });
});

test.describe("M7-08 one undo step, both ways", () => {
  for (const style of ["template", "keep"] as const) {
    test(`M7-08 ${style}: Undo in the toast restores the draft deep-equal, blocks, bio, theme and overrides included, and the files are still in Storage; Redo applies it again`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "the 10 second cleanup wait is long: one viewport");
      const user = await richUser(context, `tc8-u-${style}`);
      const before = await pageRow(user.pageId);
      const mediaUrl = (path: string) =>
        `${supabaseUrl()}/storage/v1/object/public/page-media/${path}`;
      for (const image of Object.values(user.images)) {
        expect((await fetch(mediaUrl(image.path), { method: "HEAD" })).status).toBe(200);
      }

      await openEditor(page);
      await openDialog(page);
      await applyTemplateChoice(page, "Shop", style);
      await expect(blocksHeading(page, 7)).toBeVisible();
      const applied = await expectDraft(user.pageId, (draft) => draft.blocks.length === 7);
      expect(applied.theme).toEqual(
        style === "template" ? { ref: SYSTEM_IDS.Paper, overrides: {} } : before.draft.theme,
      );

      await toastUndo(page).click();
      await expect(blocksHeading(page, before.draft.blocks.length)).toBeVisible();
      await expect(toastOf(page)).toHaveCount(0);
      const restored = await expectDraft(
        user.pageId,
        (draft) => draft.blocks.length === before.draft.blocks.length,
      );
      expect(normalized(restored)).toEqual(normalized(before.draft));
      expect(restored.theme).toEqual(before.draft.theme);
      expect(restored.profile.bio).toBe("My own words.");

      // Redo applies it again (the keyboard way: the toolbar is another agent's).
      await page.keyboard.press("Control+Shift+z");
      await expect(blocksHeading(page, 7)).toBeVisible();
      const redone = await expectDraft(user.pageId, (draft) => draft.blocks.length === 7);
      expect(redone.theme).toEqual(applied.theme);

      // Undo with the keyboard too, and wait out the image cleanup: every file is still there.
      await page.keyboard.press("Control+z");
      await expect(blocksHeading(page, before.draft.blocks.length)).toBeVisible();
      await expectDraft(user.pageId, (draft) => draft.blocks.length === before.draft.blocks.length);
      await page.waitForTimeout(11_000);
      for (const image of Object.values(user.images)) {
        expect((await fetch(mediaUrl(image.path), { method: "HEAD" })).status, image.path).toBe(
          200,
        );
      }
    });
  }
});

test.describe("M7-08 safety", () => {
  test("M7-08 with another user's token a template-shaped draft changes no row, for either style; a 51-block draft of your own is accepted by the database", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API only: one viewport is enough");
    const victim = await makeUser("tc8-vic");
    const victimPage = await insertPage(victim.id, `zq-tc8-vic-${Date.now().toString(36)}`, {});
    const own = await emptyPageUser(context, "tc8-att");
    const token = await accessToken(context);
    const victimBefore = await pageRow(victimPage);
    for (const style of ["template", "keep"] as const) {
      const shaped = applyTemplate(victimBefore.draft, templateById("musician")!, style);
      const hit = await restAs(token, `/pages?id=eq.${victimPage}`, {
        method: "PATCH",
        body: { draft: shaped },
      });
      expect(hit.status).toBeLessThan(500);
      expect(hit.body).toEqual([]);
      expect((await pageRow(victimPage)).draft).toEqual(victimBefore.draft);
    }
    // The same on your own page works: the database holds a draft of any size the schema allows.
    const fifty1: DraftDoc = {
      ...shapedDraft((await pageRow(own.pageId)).draft, "blank"),
      blocks: Array.from({ length: 51 }, (_, i) => ({
        id: `Zq8Divider${String(i).padStart(3, "0")}`,
        type: "divider",
        visible: true,
      })),
    };
    const accepted = await restAs(token, `/pages?id=eq.${own.pageId}`, {
      method: "PATCH",
      body: { draft: fifty1 },
    });
    expect(accepted.status).toBe(200);
    expect((await pageRow(own.pageId)).draft.blocks).toHaveLength(51);
  });

  test("M7-08 on a page of 50 blocks an apply leaves exactly the template's blocks, for both styles", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport");
    const user = await emptyPageUser(context, "tc8-50");
    const row = await pageRow(user.pageId);
    await setDraft(user.pageId, {
      ...row.draft,
      theme: { ref: SYSTEM_IDS.Ivory, overrides: {} },
      blocks: Array.from({ length: 50 }, (_, i) => ({
        id: `Zq8Divider${String(i).padStart(3, "0")}`,
        type: "divider",
        visible: true,
      })),
    });
    await openEditor(page);
    await expect(blocksHeading(page, 50)).toBeVisible();
    await openDialog(page);
    await applyTemplateChoice(page, "Shop", "keep");
    await expect(blocksHeading(page, 7)).toBeVisible();
    const stored = await expectDraft(user.pageId, (draft) => draft.blocks.length === 7);
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(templateOf("Shop")));
    expect(stored.theme).toEqual({ ref: SYSTEM_IDS.Ivory, overrides: {} });
  });
});

test.describe("M7-08 Publish after an apply", () => {
  test("M7-08 Publish stops at Fix 5 blocks; with the addresses in it publishes, in the page's own theme after 'keep my style'", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough for the publish gate");
    const user = await shapedUser(context, "tc8-p", "theme");
    await openEditor(page);
    await openDialog(page);
    await applyTemplateChoice(page, "Musician", "keep");
    await expect(blocksHeading(page, 6)).toBeVisible();
    await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);

    await publishButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: /before publishing/ });
    await expect(alert).toContainText("Fix 5 blocks before publishing.");
    for (const title of ["Latest release", "Tour dates", "Merch", "New single"]) {
      await expect(alert).toContainText(title);
    }
    await expect(alert).toContainText("Instagram, TikTok, YouTube:");
    const refused = await pageRow(user.pageId);
    expect(refused.published).toBeNull();

    const filled: DraftDoc = {
      ...refused.draft,
      blocks: refused.draft.blocks.map((block, index) => {
        if (block.type === "embed")
          return { ...block, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
        if (block.type === "link")
          return { ...block, url: `https://example.com/musician-${index}` };
        if (block.type === "card") return { ...block, url: "https://example.com/new-single" };
        if (block.type === "social") {
          return {
            ...block,
            icons: block.icons.map((icon) =>
              icon.platform === "email"
                ? icon
                : { ...icon, url: `https://example.com/${icon.platform}` },
            ),
          };
        }
        return block;
      }),
    };
    await setDraft(user.pageId, filled);
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });

    await page.goto(url(user.handle));
    const root = page.locator("[data-page-root]");
    await expect(root.getByText("Listen now")).toBeVisible();
    // Ivory, the page's own theme: not Midnight (#0F1626).
    const vars = await root.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--t-bg").trim(),
    );
    expect(vars.toLowerCase()).not.toBe("#0f1626");
    const ivory = (
      await adminClient().from("themes").select("tokens").eq("id", SYSTEM_IDS.Ivory).single()
    ).data!.tokens as { bg: string };
    expect(vars.toLowerCase()).toBe(ivory.bg.toLowerCase());
  });
});

test.describe("M7-08 on a phone", () => {
  test("M7-08 the panel fits the sheet: rows and buttons at least 44px, buttons stacked and full width, labels wrap, nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone only");
    await shapedUser(context, "tc8-ph", "both");
    await openEditor(page);
    const viewport = page.viewportSize()!;
    await openDialog(page);
    await templateButton(page, "Musician").click();
    const group = choiceOf(page, "Musician");
    await expect(group).toBeVisible();
    await group.scrollIntoViewIfNeeded();

    const groupBox = await rect(group);
    for (const style of ["template", "keep"]) {
      const row = group.locator(`[data-style-option="${style}"]`);
      const box = await rect(row);
      expect(box.height).toBeGreaterThanOrEqual(44);
      // The label wraps inside the row instead of running out of it.
      expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    const apply = group.getByRole("button", { name: "Apply template", exact: true });
    const cancel = group.getByRole("button", { name: "Cancel", exact: true });
    const a = await rect(apply);
    const c = await rect(cancel);
    expect(a.height).toBeGreaterThanOrEqual(44);
    expect(c.height).toBeGreaterThanOrEqual(44);
    // Stacked, and each as wide as the panel.
    expect(c.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
    expect(Math.abs(a.width - groupBox.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(c.width - groupBox.width)).toBeLessThanOrEqual(2);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "dialog");

    // Apply: the toast is inside the screen, 44px, and nothing scrolls sideways.
    await apply.click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(toastOf(page)).toBeVisible();
    const toast = await rect(toastOf(page));
    expect(toast.x).toBeGreaterThanOrEqual(0);
    expect(toast.x + toast.width).toBeLessThanOrEqual(viewport.width);
    expect(toast.y + toast.height).toBeLessThanOrEqual(viewport.height);
    expect((await rect(toastUndo(page))).height).toBeGreaterThanOrEqual(44);
    await expectTapTargets(page, "[data-testid=template-toast]");
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M7-08 on a desktop", () => {
  test("M7-08 the panel sits inside the card in the 720px dialog, Apply template and Cancel on one row, focus order radios then Apply then Cancel, Tab stays inside", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop only");
    await emptyPageUser(context, "tc8-dt");
    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Musician").click();
    const group = choiceOf(page, "Musician");
    await expect(group).toBeVisible();

    const dialogBox = await rect(dialogOf(page));
    expect(dialogBox.width).toBeLessThanOrEqual(720);
    const card = await rect(page.locator("[data-template-id='musician']"));
    const panel = await rect(group);
    expect(panel.x).toBeGreaterThanOrEqual(card.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(card.x + card.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(card.y + card.height + 1);

    const apply = group.getByRole("button", { name: "Apply template", exact: true });
    const cancel = group.getByRole("button", { name: "Cancel", exact: true });
    const a = await rect(apply);
    const c = await rect(cancel);
    expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
    expect(c.x).toBeGreaterThan(a.x);

    // Focus order: the checked radio, then Apply template, then Cancel.
    await expect(radio(page, TEMPLATE_RADIO)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(apply).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();

    // Tab and Shift+Tab never leave the dialog.
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
        true,
      );
    }
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
        true,
      );
    }
    await expectNoHorizontalScroll(page);
  });
});
