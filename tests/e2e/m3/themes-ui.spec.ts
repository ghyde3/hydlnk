import { expect, test, type Locator, type Page } from "@playwright/test";
import { publishableKey } from "../fixtures/auth";
import { cleanupUsers, makeUser } from "../fixtures/data";
import { pageRow } from "../m2/editor-helpers";
import { SYSTEM_DEFAULT_TOKENS, resolveTokens, tokenSetSchema } from "@/lib/theme";
import {
  IVORY,
  NOIR,
  SYSTEM_THEME_COUNT,
  expectFits,
  expectNoHorizontalScroll,
  expectStoredTheme,
  expectTapTargets,
  headerStatus,
  isPhone,
  liveHtml,
  messageOf,
  openDesignWithCard,
  openEditorPage,
  previewRootOf,
  publishFromEditor,
  rootVars,
  savedThemesCard,
  secondPage,
  seedTheme,
  setTheme,
  statusChip,
  storedTheme,
  switchTo,
  themeCard,
  themeCards,
  themeRow,
  themeRowsOf,
  themeUser,
} from "./themes-helpers";

/**
 * M3-19 .. M3-24, the saved-themes card on the Design screen: the grid and its applied state,
 * apply with Undo, Save as theme, the Free limit, update and rename, delete with a fallback. One
 * flow per feature on both viewports (the test bar for screens); the security halves (RLS, the
 * limit trigger, the name constraint) are in themes-api.spec.ts and the pgTAP files.
 *
 * Each test makes its own user: the two projects run at once on one database.
 */

test.afterAll(cleanupUsers);

const tag = (card: Locator) => card.locator("[data-theme-tag]");
const undoButton = (page: Page) => savedThemesCard(page).getByTestId("theme-undo");
const accentSwatch = (page: Page, name: string) =>
  page.getByRole("button", { name: `Accent ${name}`, exact: true });

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

async function varsOf(page: Page) {
  return rootVars(previewRootOf(page));
}

test.describe("M3-19 saved themes grid", () => {
  test("M3-19 every system theme then the user's saved ones; the applied card is pressed and tagged; an edit says Edited", async ({
    page,
    context,
  }, info) => {
    const user = await themeUser(context, "t19a", "pro");
    await seedTheme(user.userId, "Night shift", { accent: "#112233" });
    await seedTheme(user.userId, "Day shift", { accent: "#AABBCC" });
    await openDesignWithCard(page);

    await expect(
      savedThemesCard(page).getByRole("heading", { name: "Saved themes" }),
    ).toBeVisible();
    await expect(savedThemesCard(page)).toContainText("Applying one replaces page-level tokens");

    const cards = themeCards(page);
    await expect(cards).toHaveCount(SYSTEM_THEME_COUNT + 2);
    await expect(cards.nth(0)).toContainText("Noir");
    await expect(cards.nth(SYSTEM_THEME_COUNT)).toContainText("Night shift");
    await expect(cards.nth(SYSTEM_THEME_COUNT + 1)).toContainText("Day shift");

    // The applied card: pressed and tagged. Everything else is not pressed and has no tag.
    const noir = themeCard(page, "Noir");
    await expect(noir).toHaveAttribute("aria-pressed", "true");
    await expect(tag(noir)).toHaveText("Applied");
    await expect(page.locator("[data-testid=theme-card][aria-pressed=true]")).toHaveCount(1);
    await expect(headerStatus(page)).toHaveText("Theme · Noir");

    // The swatch is 56px tall with a filled and an outlined accent bar.
    const swatch = noir.locator("[data-swatch]");
    expect((await box(swatch)).height).toBe(56);
    await expect(swatch.locator("> span")).toHaveCount(2);

    // The grid is repeat(auto-fill, minmax(130px, 1fr)): two columns on a phone.
    const columns = await page
      .getByTestId("theme-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    if (isPhone(page)) expect(columns).toBe(2);
    else expect(columns).toBeGreaterThanOrEqual(4);
    for (const index of [0, 1, SYSTEM_THEME_COUNT]) {
      expect((await box(cards.nth(index))).height).toBeGreaterThanOrEqual(44);
    }
    await expectTapTargets(page, "[data-testid=saved-themes-card]");
    await expectNoHorizontalScroll(page);

    // After editing a colour, the tag reads Edited and the header says so.
    await accentSwatch(page, "Terracotta").click();
    await expect(tag(noir)).toHaveText("Edited");
    await expect(headerStatus(page)).toHaveText("Theme · Noir · edited");
    expect(info.project.name).toMatch(/phone|desktop/);
  });

  test("M3-19 a Free user with no saved themes sees only the system cards, never another user's", async ({
    page,
    context,
  }) => {
    const other = await makeUser("t19o", { plan: "pro" });
    await seedTheme(other.id, "Someone else's look");
    await themeUser(context, "t19b", "free");
    await openDesignWithCard(page);

    await expect(themeCards(page)).toHaveCount(SYSTEM_THEME_COUNT);
    await expect(savedThemesCard(page)).not.toContainText("Someone else's look");
    await expect(page.locator("body")).not.toContainText("Someone else's look");
  });
});

test.describe("M3-20 apply a theme to the draft, with Undo", () => {
  async function setup(context: Parameters<typeof themeUser>[0], label: string) {
    const user = await themeUser(context, label, "pro");
    await setTheme(user.pageId, NOIR, { accent: "#C46A4F" });
    return user;
  }

  test("M3-20 applying Ivory changes the preview and the draft's theme, keeps the blocks, leaves the live page alone", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "t20a");
    await publishFromEditor(page);
    const liveBefore = await liveHtml(user.handle);
    const draftBefore = (await pageRow(user.pageId)).draft;

    await openDesignWithCard(page);
    expect((await varsOf(page)).bg).toBe("#16120E");
    expect((await varsOf(page)).accent).toBe("#C46A4F");

    const clicked = Date.now();
    await themeCard(page, "Ivory").click();
    await expect.poll(async () => (await varsOf(page)).bg).toBe("#F3EEE4");
    await expect(themeCard(page, "Ivory")).toHaveAttribute("aria-pressed", "true");
    await expect(tag(themeCard(page, "Ivory"))).toHaveText("Applied");
    await expect(themeCard(page, "Noir")).toHaveAttribute("aria-pressed", "false");

    // The draft points at Ivory with no page overrides; nothing else changed.
    await expectStoredTheme(
      user.pageId,
      (t) => t.ref === IVORY && Object.keys(t.overrides).length === 0,
    );
    const draftAfter = (await pageRow(user.pageId)).draft;
    expect(draftAfter.blocks).toEqual(draftBefore.blocks);
    expect(draftAfter.profile).toEqual(draftBefore.profile);
    const fill = draftAfter.blocks.find((block) => block.id === "Bt5rJ1fGz6Os");
    expect(fill && "overrides" in fill ? fill.overrides : null).toEqual({ buttonStyle: "fill" });

    // The message and its Undo stay for at least 8 seconds.
    await expect(messageOf(page)).toHaveText(/Applied Ivory\./);
    await expect(undoButton(page)).toBeVisible();
    await page.waitForTimeout(Math.max(0, 8_300 - (Date.now() - clicked)));
    await expect(messageOf(page)).toBeVisible();
    await expect(undoButton(page)).toBeVisible();

    await expectFits(page);

    // The live page is untouched; the editor says there are changes; Publish makes it Ivory.
    expect(await liveHtml(user.handle)).toBe(liveBefore);
    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await publishFromEditor(page);
    await expect
      .poll(async () => (await liveHtml(user.handle)).includes("--t-bg:#F3EEE4"))
      .toBe(true);
  });

  test("M3-20 Undo restores the exact previous theme and overrides, and the editor is Published again", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "t20b");
    await publishFromEditor(page);
    const before = await storedTheme(user.pageId);
    expect(before).toEqual({ ref: NOIR, overrides: { accent: "#C46A4F" } });

    await openDesignWithCard(page);
    await themeCard(page, "Ivory").click();
    await expectStoredTheme(user.pageId, (t) => t.ref === IVORY);

    await undoButton(page).click();
    await expect.poll(async () => (await varsOf(page)).bg).toBe("#16120E");
    await expect.poll(async () => (await varsOf(page)).accent).toBe("#C46A4F");
    await expectStoredTheme(
      user.pageId,
      (t) => JSON.stringify(t) === JSON.stringify(before),
      "the stored theme is the one from before the apply",
    );
    await expect(themeCard(page, "Noir")).toHaveAttribute("aria-pressed", "true");
    await expect(tag(themeCard(page, "Noir"))).toHaveText("Edited");

    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Published");
  });

  test("M3-20 on a phone the message and Undo sit above the bottom tab bar and are 44px tall; on desktop near the grid", async ({
    page,
    context,
  }) => {
    await setup(context, "t20c");
    await openDesignWithCard(page);
    await themeCard(page, "Smoke").click();
    const message = messageOf(page);
    await expect(message).toContainText("Applied Smoke.");
    const undo = undoButton(page);
    expect((await box(undo)).height).toBeGreaterThanOrEqual(44);
    const m = await box(message);
    if (isPhone(page)) {
      const bar = await box(page.getByRole("navigation", { name: "App sections" }));
      expect(m.y + m.height).toBeLessThanOrEqual(bar.y + 0.5);
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(390);
    } else {
      const grid = await box(page.getByTestId("theme-grid"));
      expect(m.y + m.height).toBeLessThanOrEqual(grid.y + 0.5);
      expect(grid.y - (m.y + m.height)).toBeLessThan(80);
    }
    await expectNoHorizontalScroll(page);
  });

  test("M3-20 a card is activated with Enter", async ({ page, context }) => {
    const user = await setup(context, "t20d");
    await openDesignWithCard(page);
    const smoke = themeCard(page, "Smoke");
    await smoke.focus();
    await page.keyboard.press("Enter");
    await expect(smoke).toHaveAttribute("aria-pressed", "true");
    await expectStoredTheme(user.pageId, (t) => t.ref === "00000000-0000-4000-8000-000000000003");
  });
});

test.describe("M3-21 Save as theme", () => {
  test("M3-21 saves the resolved tokens through the user's own session and applies the new theme", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "t21a", "pro");
    await setTheme(user.pageId, NOIR, { accent: "#C46A4F", radius: 20 });
    const liveBefore = await liveHtml(user.handle);
    await openDesignWithCard(page);
    const varsBefore = await varsOf(page);
    const noirTokens = tokenSetSchema.partial().parse((await themeRow(NOIR))!.tokens);

    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().includes("/rest/v1/themes"),
    );
    await page.getByRole("button", { name: "Save as theme" }).click();
    const request = await posted;
    // The publishable key and the user's own JWT, never the secret key.
    expect(request.headers().apikey).toBe(publishableKey());
    expect(request.headers().authorization).toMatch(/^Bearer ey/);

    await expect.poll(async () => (await themeRowsOf(user.userId)).length).toBe(1);
    const [row] = await themeRowsOf(user.userId);
    expect(row!.owner_id).toBe(user.userId);
    expect(row!.name).toBe("My theme 1");
    expect(row!.tokens).toEqual(resolveTokens(noirTokens, { accent: "#C46A4F", radius: 20 }));

    // The draft points at the new row, the overrides are empty, the preview did not change.
    await expectStoredTheme(
      user.pageId,
      (t) => t.ref === row!.id && Object.keys(t.overrides).length === 0,
    );
    expect(await varsOf(page)).toEqual(varsBefore);
    await expect(themeCard(page, "My theme 1")).toHaveAttribute("aria-pressed", "true");
    await expect(tag(themeCard(page, "My theme 1"))).toHaveText("Applied");
    await expect(headerStatus(page)).toHaveText("Theme · My theme 1");
    await expect(messageOf(page)).toHaveText(/Saved as My theme 1\./);

    // Later edits make it Edited and leave the saved row alone.
    await accentSwatch(page, "Sage").click();
    await expect(tag(themeCard(page, "My theme 1"))).toHaveText("Edited");
    await page.waitForTimeout(500);
    expect((await themeRow(row!.id))!.tokens).toEqual(row!.tokens);
    expect(await liveHtml(user.handle)).toBe(liveBefore);
  });

  test("M3-21 the button and the confirmation are 44px, visible and inside the viewport; on desktop the button sits next to Done", async ({
    page,
    context,
  }) => {
    await themeUser(context, "t21b", "pro");
    await openDesignWithCard(page);
    const button = page.getByRole("button", { name: "Save as theme" });
    expect((await box(button)).height).toBeGreaterThanOrEqual(44);
    await button.click();
    const message = messageOf(page);
    await expect(message).toHaveText(/Saved as My theme 1\./);
    const m = await box(message);
    expect(m.height).toBeGreaterThanOrEqual(44);
    const viewport = page.viewportSize()!;
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(viewport.width);
    expect(m.y + m.height).toBeLessThanOrEqual(viewport.height);
    await expectNoHorizontalScroll(page);

    if (!isPhone(page)) {
      const done = await box(page.getByRole("link", { name: "Done" }));
      const b = await box(button);
      expect(b.x + b.width).toBeLessThanOrEqual(done.x);
      expect(Math.abs(b.y + b.height / 2 - (done.y + done.height / 2))).toBeLessThan(12);
    }
  });
});

test.describe("M3-22 the Free limit on the Design screen", () => {
  test("M3-22 a 4th theme shows the limit message above the grid, adds no card and no row", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "t22", "free");
    for (const name of ["One", "Two", "Three"]) await seedTheme(user.userId, name);
    await openDesignWithCard(page);
    await expect(themeCards(page)).toHaveCount(SYSTEM_THEME_COUNT + 3);

    await page.getByRole("button", { name: "Save as theme" }).click();
    const message = messageOf(page);
    await expect(message).toContainText(
      "You’ve used 3 of 3 saved themes. Delete one or upgrade to Pro.",
    );
    await expect(themeCards(page)).toHaveCount(SYSTEM_THEME_COUNT + 3);
    expect((await themeRowsOf(user.userId)).length).toBe(3);

    // Above the grid, fully visible, with a 44px Dismiss.
    const m = await box(message);
    const grid = await box(page.getByTestId("theme-grid"));
    expect(m.y + m.height).toBeLessThanOrEqual(grid.y + 0.5);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const dismiss = message.getByRole("button", { name: "Dismiss" });
    expect((await box(dismiss)).height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);

    await dismiss.click();
    await expect(message).toHaveCount(0);
  });
});

test.describe("M3-23 update and rename a saved theme", () => {
  async function sharedLook(context: Parameters<typeof themeUser>[0], label: string) {
    const user = await themeUser(context, label, "pro");
    const second = await secondPage(user, "mp");
    const shared = await seedTheme(user.userId, "Shared look", {
      accent: "#C46A4F",
      radius: 20,
      fontHeading: "Fraunces",
    });
    await setTheme(user.pageId, shared.id, {});
    await setTheme(second.pageId, shared.id, {});
    return { user, second, shared };
  }

  test("M3-23 Update writes the resolved tokens into the row and clears the overrides; the other page and both live pages stay as they were until republished", async ({
    page,
    context,
  }) => {
    const { user, second, shared } = await sharedLook(context, "t23a");
    // Publish both pages so each has a frozen look and a "Published" chip.
    await publishFromEditor(page);
    await switchTo(context, second.pageId);
    await publishFromEditor(page);
    await switchTo(context, user.pageId);
    const liveMain = await liveHtml(user.handle);
    const liveSecond = await liveHtml(second.handle);

    await openDesignWithCard(page);
    const card = themeCard(page, "Shared look");
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("theme-update")).toHaveCount(0); // nothing to update yet

    await accentSwatch(page, "Sage").click();
    await expect(tag(card)).toHaveText("Edited");
    const update = page.getByTestId("theme-update");
    await expect(update).toHaveText("Update Shared look");
    expect((await box(update)).height).toBeGreaterThanOrEqual(44);
    await expectFits(page);
    const varsBefore = await varsOf(page);

    await update.click();
    await expect(tag(card)).toHaveText("Applied");
    await expect(messageOf(page)).toContainText("Updated Shared look.");
    expect(await varsOf(page)).toEqual(varsBefore); // the preview did not change
    await expectStoredTheme(
      user.pageId,
      (t) => t.ref === shared.id && Object.keys(t.overrides).length === 0,
    );
    const row = await themeRow(shared.id);
    expect(row!.tokens).toEqual(resolveTokens(tokenSetSchema.partial().parse(row!.tokens), {}));
    expect((row!.tokens as Record<string, unknown>).accent).toBe("#8FA68A");
    expect((row!.tokens as Record<string, unknown>).radius).toBe(20);
    expect((row!.tokens as Record<string, unknown>).fontHeading).toBe("Fraunces");

    // The other page's draft shows the new accent, and its editor says there are changes.
    await switchTo(context, second.pageId);
    await openDesignWithCard(page);
    expect((await varsOf(page)).accent).toBe("#8FA68A");
    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes");

    // Both live pages are byte-identical.
    expect(await liveHtml(user.handle)).toBe(liveMain);
    expect(await liveHtml(second.handle)).toBe(liveSecond);
  });

  test("M3-23 Update is not offered when the applied theme is a system theme", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "t23b", "pro");
    await setTheme(user.pageId, NOIR, { accent: "#C46A4F" });
    await openDesignWithCard(page);
    await expect(tag(themeCard(page, "Noir"))).toHaveText("Edited");
    await expect(page.getByTestId("theme-update")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save as theme" })).toBeVisible();
    await expect(page.getByTestId("theme-rename")).toHaveCount(0);
  });

  test("M3-23 rename: Enter saves, Escape cancels, whitespace is trimmed, empty is refused; other pages show the new name and nothing becomes unpublished", async ({
    page,
    context,
  }) => {
    const { user, second, shared } = await sharedLook(context, "t23c");
    await publishFromEditor(page);
    await switchTo(context, second.pageId);
    await publishFromEditor(page);
    await switchTo(context, user.pageId);
    const tokensBefore = (await themeRow(shared.id))!.tokens;

    await openDesignWithCard(page);
    const trigger = page.getByRole("button", { name: "Rename Shared look" });
    expect((await box(trigger)).height).toBeGreaterThanOrEqual(44);

    // Escape cancels.
    await trigger.click();
    const input = page.getByTestId("theme-rename-input");
    await expect(input).toHaveValue("Shared look");
    await expect(input).toBeFocused();
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect((await box(input)).height).toBeGreaterThanOrEqual(44);
    await expectFits(page);
    await input.fill("Discarded");
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    expect((await themeRow(shared.id))!.name).toBe("Shared look");

    // Empty is refused.
    await trigger.click();
    await input.fill("   ");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Give the theme a name.")).toBeVisible();
    expect((await themeRow(shared.id))!.name).toBe("Shared look");

    // Enter saves, trimmed.
    await input.fill("  Night Market  ");
    await page.keyboard.press("Enter");
    await expect(input).toHaveCount(0);
    await expect(themeCard(page, "Night Market")).toBeVisible();
    await expect(headerStatus(page)).toHaveText("Theme · Night Market");
    await expect.poll(async () => (await themeRow(shared.id))!.name).toBe("Night Market");
    expect((await themeRow(shared.id))!.tokens).toEqual(tokensBefore);

    // Every other page using the theme shows the new name, and no page is "unpublished" for it.
    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Published");
    await switchTo(context, second.pageId);
    await openDesignWithCard(page);
    await expect(headerStatus(page)).toHaveText("Theme · Night Market");
    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Published");
  });
});

test.describe("M3-24 delete a saved theme and fall back to the default", () => {
  test("M3-24 the dialog traps focus and closes on Escape; confirming deletes the row, drafts fall back to the default and live pages keep their look", async ({
    page,
    context,
  }, info) => {
    const user = await themeUser(context, "t24a", "pro");
    const second = await secondPage(user, "mp");
    const shared = await seedTheme(user.userId, "Shared look", { accent: "#C46A4F" });
    await setTheme(user.pageId, shared.id, {});
    await setTheme(second.pageId, shared.id, { radius: 20 });
    await publishFromEditor(page);
    await switchTo(context, second.pageId);
    await publishFromEditor(page);
    await switchTo(context, user.pageId);
    const liveMain = await liveHtml(user.handle);
    const liveSecond = await liveHtml(second.handle);

    await openDesignWithCard(page);
    const open = async () => {
      await page.getByRole("button", { name: "Delete Shared look" }).click();
      const dialog = page.getByTestId("delete-theme-dialog");
      await expect(dialog).toBeVisible();
      return dialog;
    };

    let dialog = await open();
    await expect(dialog).toContainText("Delete Shared look?");
    await expect(dialog).toContainText(
      "Drafts using it fall back to the default theme. Live pages keep their look until you republish.",
    );
    const buttons = dialog.getByRole("button");
    await expect(buttons).toHaveCount(2);
    for (let i = 0; i < 2; i++)
      expect((await box(buttons.nth(i))).height).toBeGreaterThanOrEqual(44);

    // Focus stays inside, both ways round.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    // Size and backdrop.
    const d = await box(dialog);
    const viewport = page.viewportSize()!;
    expect(d.width).toBeLessThanOrEqual(440.5);
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(viewport.width);
    expect(d.y + d.height).toBeLessThanOrEqual(viewport.height);
    if (!isPhone(page)) {
      expect(Math.abs(d.x + d.width / 2 - viewport.width / 2)).toBeLessThan(2);
    }
    const backdrop = await dialog.evaluate(
      (el) => getComputedStyle(el, "::backdrop").backgroundColor,
    );
    expect(backdrop).not.toMatch(/^rgba?\(0, 0, 0, 0\)$|^transparent$/);
    await expectNoHorizontalScroll(page);

    // Escape closes it and deletes nothing; so does Cancel.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await themeRow(shared.id)).not.toBeNull();
    dialog = await open();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await themeRow(shared.id)).not.toBeNull();

    // Confirm.
    dialog = await open();
    await dialog.getByRole("button", { name: "Delete theme" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => await themeRow(shared.id)).toBeNull();
    await expect(page.getByRole("button", { name: "Delete Shared look" })).toHaveCount(0);
    await expect(themeCards(page)).toHaveCount(SYSTEM_THEME_COUNT);
    await expect(headerStatus(page)).toHaveText("Theme · Default");
    await expect(messageOf(page)).toContainText("Deleted Shared look.");
    expect((await varsOf(page)).accent).toBe(SYSTEM_DEFAULT_TOKENS.accent); // the system default accent
    await expectNoHorizontalScroll(page);

    // The other page's draft: no error for the dangling reference, default plus its own overrides.
    await switchTo(context, second.pageId);
    await openDesignWithCard(page);
    await expect(headerStatus(page)).toHaveText("Theme · Default");
    const vars = await varsOf(page);
    expect(vars.accent).toBe(SYSTEM_DEFAULT_TOKENS.accent);
    expect(vars.radius).toBe("20px");
    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await switchTo(context, user.pageId);
    await openEditorPage(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes");

    // Both live pages are byte-identical to before.
    expect(await liveHtml(user.handle)).toBe(liveMain);
    expect(await liveHtml(second.handle)).toBe(liveSecond);
    expect(info.project.name).toMatch(/phone|desktop/);
  });

  test("M3-24 a Free user at 3 saved themes can save again after deleting one", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "t24b", "free");
    for (const name of ["One", "Two", "Three"]) await seedTheme(user.userId, name);
    await openDesignWithCard(page);

    await page.getByRole("button", { name: "Delete Two" }).click();
    await page
      .getByTestId("delete-theme-dialog")
      .getByRole("button", { name: "Delete theme" })
      .click();
    await expect.poll(async () => (await themeRowsOf(user.userId)).length).toBe(2);

    await page.getByRole("button", { name: "Save as theme" }).click();
    await expect(messageOf(page)).toContainText("Saved as");
    await expect.poll(async () => (await themeRowsOf(user.userId)).length).toBe(3);
  });
});
