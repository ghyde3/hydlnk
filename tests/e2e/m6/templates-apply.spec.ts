import { expect, test, type Page } from "@playwright/test";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { url } from "../helpers";
import { draftDocSchema } from "@/lib/document";
import { uploadImage } from "../m2/blocks-helpers";
import { SYSTEM_IDS, liveHtml, rootVars, seedTheme } from "./themes-helpers";
import { setOverrides } from "../m3/design-helpers";
import {
  blocksHeading,
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
  publishedUserWithEmptyDraft,
  replaceConfirmation,
  saveIndicator,
  setDraft,
  statusChip,
  templateButton,
  templateOf,
  toastOf,
  toastUndo,
  userThemeRows,
  watchWrites,
  type DraftDoc,
} from "./templates-helpers";
import { seededUser } from "../m2/editor-helpers";

/**
 * M6-40, applying a template: to an empty page, to a page that has content (with the inline
 * confirmation), Undo, and the Publish that follows. Each test makes its own user; mara's rows are
 * never touched. The abuse cases are in templates-safety.spec.ts.
 */

test.afterAll(cleanupUsers);

const MUSICIAN = templateOf("Musician");

async function box(locator: ReturnType<Page["locator"]>) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

/** The draft without `rev`, which is not part of what an apply or an undo restores. */
const withoutRev = (draft: DraftDoc) => {
  const copy: Partial<DraftDoc> = { ...draft };
  delete copy.rev;
  return copy;
};

test.describe("M6-40 apply to an empty page", () => {
  test("M6-40 Use this template on Musician writes the draft once, sets theme and bio, keeps name and photo, shows the toast, and leaves the live page alone", async ({
    page,
    context,
  }, info) => {
    const user = await publishedUserWithEmptyDraft(context, "tpl-ap");
    const liveBefore = await liveHtml(user.handle);
    await openEditor(page);
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
    const writes = watchWrites(page);

    await openDialog(page);
    const appliedAt = Date.now();
    await templateButton(page, "Musician").click();

    // The dialog closes, and the count and the (desktop) preview update at once.
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(blocksHeading(page, 6)).toBeVisible();
    if (desktopOnly(info)) {
      await expect(page.getByTestId("preview-screen")).toContainText("Listen now");
      await expect(page.getByTestId("preview-screen")).toContainText("Tour dates");
    }
    // Saved through the normal autosave within 3 seconds.
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 3_000 });
    await expect(statusChip(page)).toHaveText(/Not published|Unpublished changes/);

    const stored = await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(MUSICIAN));
    expect(stored.blocks.every((block) => block.visible === true)).toBe(true);
    expect(stored.theme).toEqual({ ref: SYSTEM_IDS.Midnight, overrides: {} });
    expect(stored.profile.bio).toBe("New music, tour dates and merch.");
    expect(stored.profile.name).toBe(user.before.profile.name);
    expect(stored.profile.photo).toBe(user.before.profile.photo);

    // One PATCH to the pages table, carrying only the draft column; nothing else was written.
    expect(writes.patches).toHaveLength(1);
    expect(Object.keys(writes.patches[0]!.body)).toEqual(["draft"]);
    expect(writes.others).toEqual([]);
    expect(writes.serverActions).toEqual([]);

    // The toast: its words, a 44px Undo, announced politely, and it stays at least 8 seconds.
    const toast = toastOf(page);
    await expect(toast).toHaveText(
      "Applied the Musician template. Add your links, then publish.Undo",
    );
    const region = page.getByTestId("template-toast-region");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region).toHaveAttribute("role", "status");
    expect((await box(toastUndo(page))).height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(Math.max(0, 8_100 - (Date.now() - appliedAt)));
    await expect(toast).toBeVisible({ timeout: 500 });

    // The live page is as it was until Publish.
    expect(await liveHtml(user.handle)).toBe(liveBefore);
  });

  test("M6-40 a bio the person wrote stays", async ({ page, context }) => {
    const user = await emptyPageUser(context, "tpl-bio");
    const row = await pageRow(user.pageId);
    await setDraft(user.pageId, {
      ...row.draft,
      profile: { ...row.draft.profile, bio: "My own words." },
    });
    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Coach").click();
    await expect(blocksHeading(page, 6)).toBeVisible();
    const stored = await expectDraft(user.pageId, (draft) => draft.blocks.length === 6);
    expect(stored.profile.bio).toBe("My own words.");
    expect(stored.theme.ref).toBe(SYSTEM_IDS.Sage);
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(templateOf("Coach")));
  });
});

test.describe("M6-40 on a phone", () => {
  test("M6-40 the toast sits above the bottom tab bar and the docked preview, covers neither Publish nor the dock, and nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone only");
    const user = await emptyPageUser(context, "tpl-ph");
    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Musician").click();
    await expect(toastOf(page)).toBeVisible();
    await expect(blocksHeading(page, 6)).toBeVisible();

    const viewport = page.viewportSize()!;
    const toast = await box(toastOf(page));
    // Above the fixed 68px tab bar, inside the screen, within the margins.
    expect(toast.y + toast.height).toBeLessThanOrEqual(viewport.height - 68 + 1);
    expect(toast.x).toBeGreaterThanOrEqual(0);
    expect(toast.x + toast.width).toBeLessThanOrEqual(viewport.width);
    expect(toast.height).toBeGreaterThanOrEqual(44);
    expect((await box(toastUndo(page))).height).toBeGreaterThanOrEqual(44);
    // Neither Publish (in the header) nor the docked preview is covered.
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const publish = await box(
      page.locator("main > header").getByRole("button", { name: "Publish", exact: true }),
    );
    expect(overlaps(toast, publish)).toBe(false);
    const dock = page.getByTestId("preview-dock");
    if ((await dock.count()) > 0 && (await dock.first().isVisible())) {
      expect(overlaps(toast, await box(dock.first()))).toBe(false);
    }
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-testid=template-toast]");
    expect(user.pageId).toBeTruthy();
  });
});

test.describe("M6-40 apply to a page that has content", () => {
  test("M6-40 it asks first; Keep my page, Escape and Close leave the draft exactly as it was; Replace my page replaces blocks, theme and overrides and nothing else", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "tpl-rp");
    await setOverrides(user.pageId, { accent: "#C46A4F", radius: 20 });
    await seedTheme(user.userId, "Keep me", { accent: "#112233" });
    const before = await pageRow(user.pageId);
    const themesBefore = await userThemeRows(user.userId);
    expect(before.draft.blocks.length).toBeGreaterThan(0);
    await openEditor(page);
    const writes = watchWrites(page);

    // Pressing Use this template shows the confirmation in the dialog.
    await openDialog(page);
    await templateButton(page, "Musician").click();
    const confirm = replaceConfirmation(page);
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByText(
        "Replace your blocks and style with the Musician template? Your name, photo and saved themes stay. You can undo this.",
      ),
    ).toBeVisible();
    const replace = confirm.getByRole("button", { name: "Replace my page", exact: true });
    const keep = confirm.getByRole("button", { name: "Keep my page", exact: true });
    for (const button of [replace, keep])
      expect((await box(button)).height).toBeGreaterThanOrEqual(44);
    const danger = await replace.evaluate((el) => {
      const css = getComputedStyle(el);
      return {
        bg: css.backgroundColor,
        color: css.color,
        border: css.borderTopColor,
        width: css.borderTopWidth,
      };
    });
    expect(danger.bg).toBe("rgb(255, 255, 255)");
    expect(danger.color).toBe(danger.border);
    expect(danger.width).toBe("1px");
    expect(danger.color).not.toBe("rgb(0, 0, 0)");
    const secondary = await keep.evaluate((el) => {
      const css = getComputedStyle(el);
      return { bg: css.backgroundColor, color: css.color, border: css.borderTopColor };
    });
    expect(secondary.border).not.toBe(danger.border);
    expect(secondary.color).not.toBe(danger.color);

    // Keep my page.
    await keep.click();
    await expect(dialogOf(page)).toHaveCount(0);
    // Escape.
    await openDialog(page);
    await templateButton(page, "Musician").click();
    await expect(replaceConfirmation(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toHaveCount(0);
    // Close.
    await openDialog(page);
    await templateButton(page, "Musician").click();
    await expect(replaceConfirmation(page)).toBeVisible();
    await dialogOf(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialogOf(page)).toHaveCount(0);

    await page.waitForTimeout(1_500);
    expect(writes.patches).toEqual([]);
    expect(withoutRev((await pageRow(user.pageId)).draft)).toEqual(withoutRev(before.draft));
    expect((await pageRow(user.pageId)).draft.rev).toBe(before.draft.rev);

    // Replace my page.
    await openDialog(page);
    await templateButton(page, "Musician").click();
    await replaceConfirmation(page)
      .getByRole("button", { name: "Replace my page", exact: true })
      .click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(blocksHeading(page, 6)).toBeVisible();
    const stored = await expectDraft(
      user.pageId,
      (draft) => draft.blocks.length === 6 && draft.theme.ref === SYSTEM_IDS.Midnight,
    );
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(MUSICIAN));
    expect(stored.theme).toEqual({ ref: SYSTEM_IDS.Midnight, overrides: {} });
    // Nothing else moved: name, photo, the bio the person wrote, the profile options.
    expect(stored.profile).toEqual(draftDocSchema.parse(before.draft).profile);
    // One edit, one write; saved themes are as they were; no Storage call, no other write.
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 3_000 });
    expect(writes.patches).toHaveLength(1);
    expect(writes.others).toEqual([]);
    expect(await userThemeRows(user.userId)).toEqual(themesBefore);
  });
});

test.describe("M6-40 Undo", () => {
  test("M6-40 Undo in the toast restores the earlier page exactly, an uploaded image included, and its file is still in Storage", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "tpl-un");
    const image = await uploadImage(user.userId, 120, 80, [200, 80, 60]);
    const row = await pageRow(user.pageId);
    const draft: DraftDoc = {
      ...row.draft,
      theme: { ref: SYSTEM_IDS.Noir, overrides: { accent: "#C46A4F" } },
      blocks: [
        ...row.draft.blocks,
        {
          id: "Zq1CardImage01",
          type: "card",
          visible: true,
          title: "With a picture",
          caption: "",
          url: "https://example.com/pic",
          image,
        },
      ],
    };
    await setDraft(user.pageId, draft);
    const before = await pageRow(user.pageId);
    const mediaUrl = `${supabaseUrl()}/storage/v1/object/public/page-media/${image.path}`;
    expect((await fetch(mediaUrl, { method: "HEAD" })).status).toBe(200);

    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Shop").click();
    await replaceConfirmation(page)
      .getByRole("button", { name: "Replace my page", exact: true })
      .click();
    await expect(blocksHeading(page, 7)).toBeVisible();
    await expect(toastOf(page)).toContainText("Applied the Shop template.");
    await expectDraft(user.pageId, (d) => d.theme.ref === SYSTEM_IDS.Paper);

    await toastUndo(page).click();
    await expect(blocksHeading(page, before.draft.blocks.length)).toBeVisible();
    await expect(toastOf(page)).toHaveCount(0);
    const restored = await expectDraft(
      user.pageId,
      (d) => d.theme.ref === SYSTEM_IDS.Noir && d.blocks.length === before.draft.blocks.length,
    );
    // The same blocks (ids, content, order), bio, theme reference and overrides.
    // (The editor fills the profile display options a stored draft may lack: the same defaults.)
    expect(withoutRev(restored)).toEqual(
      withoutRev(draftDocSchema.parse(before.draft) as DraftDoc),
    );
    // The image is still there, and stays: the page names it again.
    expect((await fetch(mediaUrl, { method: "HEAD" })).status).toBe(200);
    await page.waitForTimeout(11_000);
    expect((await fetch(mediaUrl, { method: "HEAD" })).status).toBe(200);
    const { data } = await adminClient().storage.from("page-media").list(user.userId);
    expect(data?.map((file) => file.name)).toContain(image.path.split("/")[1]);
  });

  test("M6-40 once the toast is gone the template stays, and Undo brings the chip back to Published", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "tpl-ch");
    const before = await pageRow(user.pageId);
    await openEditor(page);
    await expect(statusChip(page)).toHaveText("Published");

    // Apply, then Undo: Published again.
    await openDialog(page);
    await templateButton(page, "Streamer").click();
    await replaceConfirmation(page)
      .getByRole("button", { name: "Replace my page", exact: true })
      .click();
    await expect(blocksHeading(page, 5)).toBeVisible();
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await toastUndo(page).click();
    await expect(statusChip(page)).toHaveText("Published");
    await expectDraft(user.pageId, (d) => d.blocks.length === before.draft.blocks.length);

    // Apply again and let the toast go: the template stays.
    await openDialog(page);
    await templateButton(page, "Streamer").click();
    await replaceConfirmation(page)
      .getByRole("button", { name: "Replace my page", exact: true })
      .click();
    await expect(toastOf(page)).toBeVisible();
    await expect(toastOf(page)).toHaveCount(0, { timeout: 12_000 });
    await expect(blocksHeading(page, 5)).toBeVisible();
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await expectDraft(
      user.pageId,
      (d) => d.theme.ref === SYSTEM_IDS.Ember && d.blocks.length === 5,
    );
  });

  test("M6-40 a later edit takes the toast away, so its Undo can never undo something else", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "tpl-ed");
    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Artist").click();
    await expect(toastOf(page)).toBeVisible();
    await page.getByLabel("Display name", { exact: true }).fill("A new name");
    await expect(toastOf(page)).toHaveCount(0);
  });
});

test.describe("M6-40 Publish after applying", () => {
  test("M6-40 Publish stops at Fix 5 blocks naming the embed, the two links, the card and the social row; once the addresses are in, it publishes in Midnight", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough for the publish gate");
    const user = await emptyPageUser(context, "tpl-pb");
    await openEditor(page);
    await openDialog(page);
    await templateButton(page, "Musician").click();
    await expect(blocksHeading(page, 6)).toBeVisible();
    await expectDraft(user.pageId, (d) => d.blocks.length === 6);

    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    const alert = page.getByRole("alert").filter({ hasText: /before publishing/ });
    await expect(alert).toContainText("Fix 5 blocks before publishing.");
    for (const title of ["Latest release", "Tour dates", "Merch", "New single"]) {
      await expect(alert).toContainText(title);
    }
    await expect(alert).toContainText("Instagram, TikTok, YouTube:");
    await expect(alert).not.toContainText("Listen now");
    // Nothing was published.
    const refused = await pageRow(user.pageId);
    expect(refused.published).toBeNull();
    expect(refused.published_at).toBeNull();

    // The five addresses go in (test setup writes them the way the editor's fields would).
    const draft = refused.draft;
    const filled: DraftDoc = {
      ...draft,
      blocks: draft.blocks.map((block, index) => {
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
    await page
      .locator("main > header")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.getByText("Published.", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(statusChip(page)).toHaveText("Published");

    await page.goto(url(user.handle));
    await expect(page.locator("[data-page-root]").getByText("Listen now")).toBeVisible();
    await expect(
      page.locator("[data-page-root]").getByRole("link", { name: "Tour dates" }),
    ).toBeVisible();
    const vars = await rootVars(page.locator("[data-page-root]"));
    expect(vars.bg).toBe("#0F1626");
  });
});
