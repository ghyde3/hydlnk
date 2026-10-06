import { axeViolations } from "../fixtures/a11y";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { adminClient, signInAs, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { makePngImage } from "../m5/images-fixtures";
import { removeFolders } from "../m5/images-helpers";
import { isDraftPatch, pageRow } from "./history-helpers";
import {
  chooseThemeMenuItem,
  IVORY,
  NOIR,
  expectStoredTheme,
  expectAppliedTheme,
  expectNoThemeApplied,
  openDesignWithCard,
  setTheme,
  storedTheme,
  themeCard,
  themeCards,
  themeUser,
} from "../m3/themes-helpers";
import { previewRoot, saveStatus, showTokens } from "../m3/design-helpers";
import { mediaPathOf } from "@/lib/themes/bg-image";

/**
 * M6-08: undo and redo on the Design screen. The engine is the Editor's (tests/unit/m6-history-*.test.ts);
 * here the screen is run in the browser: the buttons and shortcuts, a table of controls, one slider
 * gesture as one step, themes (apply, Save as theme, a theme deleted in between), a background image
 * that was deleted since, the stale-tab guard, and the layout at both widths.
 */

test.afterAll(async () => {
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});
const owners: string[] = [];

// M7-05: Undo and Redo are the workspace toolbar's, the same two buttons on every tab (the Design
// header and its 'Done' link are gone).
const toolbar = (page: Page): Locator => page.getByTestId("workspace-toolbar");
const undoButton = (page: Page): Locator =>
  toolbar(page).getByRole("button", { name: "Undo", exact: true });
const redoButton = (page: Page): Locator =>
  toolbar(page).getByRole("button", { name: "Redo", exact: true });

const UNDO_KEY = "Control+z";
const REDO_KEY = "Control+Shift+z";

type Overrides = Record<string, unknown>;

async function overridesOf(pageId: string): Promise<Overrides> {
  return ((await pageRow(pageId)).draft.theme.overrides ?? {}) as Overrides;
}

const sorted = (value: Overrides): Overrides =>
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

async function expectOverridesEqual(pageId: string, want: Overrides, why: string): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(sorted(await overridesOf(pageId))), {
      message: why,
      timeout: 20_000,
    })
    .toBe(JSON.stringify(sorted(want)));
}

const group = (page: Page, name: string): Locator => page.getByRole("group", { name, exact: true });
const option = (page: Page, groupName: string, name: string): Locator =>
  group(page, groupName).getByRole("button", { name, exact: true });

async function pickFont(page: Page, label: string, family: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${label}: `) }).click();
  await page
    .getByRole("listbox", { name: label })
    .getByRole("option", { name: family, exact: true })
    .click();
}

const patchesOf = (page: Page) => {
  const sent: { keys: string[]; rev: number }[] = [];
  page.on("request", (request: Request) => {
    if (!isDraftPatch(request)) return;
    const body = JSON.parse(request.postData() ?? "{}") as { draft?: { rev: number } };
    sent.push({ keys: Object.keys(body), rev: body.draft?.rev ?? -1 });
  });
  return sent;
};

test.describe("M6-08 the buttons", () => {
  test("M6-08 Undo and Redo are 44x44 in the workspace toolbar, disabled until there is something to do (M7-05 places them)", async ({
    page,
    context,
  }) => {
    await themeUser(context, "dh1");
    await openDesignWithCard(page);
    for (const button of [undoButton(page), redoButton(page)]) {
      await expect(button).toBeVisible();
      await expect(button).toBeDisabled();
      const box = (await button.boundingBox())!;
      expect(box.width).toBeCloseTo(44, 0);
      expect(box.height).toBeCloseTo(44, 0);
    }
    expect(await axeViolations(page)).toEqual([]);
    const undoBox = (await undoButton(page).boundingBox())!;
    const redoBox = (await redoButton(page).boundingBox())!;
    expect(undoBox.x).toBeLessThan(redoBox.x);
    // Nothing overlaps or scrolls sideways; there is no 'Done' and no header 'Save as theme' left.
    expect(undoBox.x + undoBox.width).toBeLessThanOrEqual(redoBox.x + 0.5);
    await expect(page.getByRole("link", { name: "Done" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M6-08 every Design change is a step", () => {
  test.describe.configure({ timeout: 300_000 });

  test("M6-08 13 controls, each followed by Undo and Redo, compared on draft.theme.overrides and the preview", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the table is the same at every width; run once");
    const user = await themeUser(context, "dt1");
    owners.push(user.userId);
    await openDesignWithCard(page);
    await expectAppliedTheme(page, "Noir");
    const png = await makePngImage({ width: 240, height: 180, color: [40, 80, 160] });

    const settled = async () => {
      await expect(saveStatus(page)).not.toHaveText("Saving...", { timeout: 15_000 });
      return overridesOf(user.pageId);
    };
    const accent = async () =>
      (
        await previewRoot(page).evaluate((el) =>
          (el as HTMLElement).style.getPropertyValue("--t-accent"),
        )
      ).trim();
    const accentAtStart = await accent();
    // What the preview draws: the root's inline token variables and the styles they resolve to.
    const previewLook = async () =>
      previewRoot(page).evaluate((el) => {
        const root = el as HTMLElement;
        const computed = getComputedStyle(root);
        // The custom properties by name (the attribute's text differs between the server's string
        // and the browser's own serialization after a re-render, the values do not).
        const tokens = Array.from(root.style)
          .filter((name) => name.startsWith("--t-"))
          .map((name) => [name, root.style.getPropertyValue(name).trim()]);
        return JSON.stringify({
          tokens,
          backgroundColor: computed.backgroundColor,
          backgroundImage: computed.backgroundImage,
          fontFamily: computed.fontFamily,
          color: computed.color,
        });
      });

    const table: [string, () => Promise<void>, (o: Overrides) => boolean, number][] = [
      [
        "an accent swatch",
        () => option(page, "Accent", "Accent Sage").click(),
        (o) => o.accent === "#8FA68A",
        1,
      ],
      [
        "a hex color field",
        async () => {
          const field = page.getByLabel("Page background hex", { exact: true });
          await field.fill("#102030");
          await field.blur();
        },
        (o) => o.bg === "#102030",
        1,
      ],
      [
        "the heading font",
        () => pickFont(page, "Heading font", "Fraunces"),
        (o) => o.fontHeading === "Fraunces",
        1,
      ],
      [
        "the body font",
        () => pickFont(page, "Body font", "Space Mono"),
        (o) => o.fontBody === "Space Mono",
        1,
      ],
      [
        "the type scale",
        () => option(page, "Text size", "1.1×").click(),
        (o) => o.scale === 1.1,
        1,
      ],
      [
        "the heading weight",
        () => option(page, "Heading boldness", "Semibold").click(),
        (o) => o.weightHeading === 600,
        1,
      ],
      [
        "the letter case",
        () => option(page, "Capital letters", "Uppercase").click(),
        (o) => o.letterCase === "uppercase",
        1,
      ],
      [
        "the button style",
        () => option(page, "Button style", "Pill").click(),
        (o) => o.buttonStyle === "pill",
        1,
      ],
      [
        "the corner radius",
        () => option(page, "Corner radius", "20px").click(),
        (o) => o.radius === 20,
        1,
      ],
      [
        "the border width",
        () => option(page, "Border thickness", "2px").click(),
        (o) => o.borderWidth === 2,
        1,
      ],
      [
        "the density",
        () => option(page, "Space between blocks", "Airy").click(),
        (o) => o.density === "airy",
        1,
      ],
      [
        "the background type",
        () => option(page, "Background", "Gradient").click(),
        (o) => o.bgType === "gradient",
        1,
      ],
      [
        // Two steps: the upload sets the image and the type together, the slider drag is its own.
        "the background image and its overlay",
        async () => {
          await page
            .locator("input[type=file]")
            .last()
            .setInputFiles({ name: "bg.png", mimeType: "image/png", buffer: png });
          await expect(page.getByRole("button", { name: "Remove image" })).toBeVisible();
          await expect
            .poll(async () => typeof (await overridesOf(user.pageId)).bgImage)
            .toBe("string");
          await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });
          const overlay = page.getByLabel("Image overlay", { exact: true });
          await overlay.evaluate((el: HTMLInputElement) => {
            const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
            for (const value of [10, 20, 30, 40]) {
              set.call(el, String(value));
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
          });
        },
        (o) => o.overlayOpacity === 0.4,
        2,
      ],
    ];
    expect(table.length).toBeGreaterThanOrEqual(12);

    for (const [label, act, check, steps] of table) {
      const was = await settled();
      const lookBefore = await previewLook();
      await act();
      await expect
        .poll(async () => check(await overridesOf(user.pageId)), {
          message: `${label}: the change is stored`,
          timeout: 20_000,
        })
        .toBe(true);
      const now = await settled();
      const lookNow = await previewLook();

      // One press at a time: a step that checks a background image in Storage first ignores a
      // second press while it waits (M6-06), so each press gets a moment to land.
      for (let i = 0; i < steps; i++) {
        await undoButton(page).click();
        await page.waitForTimeout(250);
      }
      await expectOverridesEqual(
        user.pageId,
        was,
        `${label}: Undo restores the overrides from before`,
      );
      await expect
        .poll(previewLook, { message: `${label}: Undo restores the preview`, timeout: 10_000 })
        .toBe(lookBefore);
      for (let i = 0; i < steps; i++) {
        await redoButton(page).click();
        await page.waitForTimeout(250);
      }
      await expectOverridesEqual(
        user.pageId,
        now,
        `${label}: Redo restores the overrides from after`,
      );
      await expect
        .poll(previewLook, { message: `${label}: Redo restores the preview`, timeout: 10_000 })
        .toBe(lookNow);
      await settled();
    }

    // The preview follows the history: undo everything back to the start.
    await expectAppliedTheme(page, "Noir", "Edited");
    while ((await undoButton(page).getAttribute("aria-disabled")) !== "true") {
      await undoButton(page).click();
    }
    await expect.poll(accent).toBe(accentAtStart);
    // Back to the theme as it was loaded: the header no longer says it was edited.
    await expectAppliedTheme(page, "Noir");
    await expectOverridesEqual(user.pageId, {}, "all the way back");
  });

  test("M6-08 an accent swatch, which also moves the button colors, is one step; nudging a slider is one step; shortcuts work in a hex field", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "dt2");
    await openDesignWithCard(page);
    await expectAppliedTheme(page, "Noir");

    await option(page, "Accent", "Accent Terracotta").click();
    await expectAppliedTheme(page, "Noir", "Edited");
    // The swatch sets the accent and the button colors; one Undo takes all of it back.
    await expect.poll(async () => (await overridesOf(user.pageId)).accent).toBe("#C46A4F");
    await page.keyboard.press(UNDO_KEY);
    await expectAppliedTheme(page, "Noir");
    await expectOverridesEqual(user.pageId, {}, "the swatch undone in one step");
    await expect(undoButton(page)).toBeDisabled();

    // A hex field with focus: the shortcut is the app's, not the browser's.
    const hex = page.getByLabel("Cards and panels hex", { exact: true });
    await hex.click();
    await hex.selectText();
    await page.keyboard.type("#334455", { delay: 20 });
    await expect(hex).toHaveValue("#334455");
    await expect.poll(async () => (await overridesOf(user.pageId)).surface).toBe("#334455");
    await page.keyboard.press(UNDO_KEY);
    await expect.poll(async () => (await overridesOf(user.pageId)).surface).toBeUndefined();
    await expect(hex).toBeFocused();
    await expect(undoButton(page)).toBeDisabled();
  });

  test("M6-08 nudging a slider with the arrow keys, several presses in a row, is one step", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "dt3");
    // A background image makes the Overlay slider show; the file itself is not needed for this.
    await setTheme(user.pageId, NOIR, {
      bgType: "image",
      bgImage: `${supabaseUrl()}/storage/v1/object/public/page-media/${user.userId}/abcdefgh12.png`,
    });
    await openDesignWithCard(page);
    const overlay = page.getByLabel("Image overlay", { exact: true });
    await expect(overlay).toBeVisible();
    const start = Number(await overlay.inputValue());
    await overlay.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await expect(overlay).toHaveValue(String(start + 6));
    await expect
      .poll(async () => (await overridesOf(user.pageId)).overlayOpacity)
      .toBe((start + 6) / 100);
    await page.keyboard.press(UNDO_KEY);
    await expect(overlay).toHaveValue(String(start));
    await expect(undoButton(page)).toBeDisabled();
    await page.keyboard.press(REDO_KEY);
    await expect(overlay).toHaveValue(String(start + 6));
  });
});

test.describe("M6-08 themes", () => {
  test.describe.configure({ timeout: 120_000 });

  test("M6-08 applying Ivory: the toast Undo and Ctrl+Z both restore the previous theme exactly, and each is one step", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "dth1");
    await setTheme(user.pageId, NOIR, { accent: "#C46A4F", radius: 12 });
    const previous = await storedTheme(user.pageId);
    expect(previous).toEqual({ ref: NOIR, overrides: { accent: "#C46A4F", radius: 12 } });
    await openDesignWithCard(page);
    const isPrevious = (t: { ref: string | null; overrides: Record<string, unknown> }) =>
      t.ref === previous.ref && JSON.stringify(t.overrides) === JSON.stringify(previous.overrides);
    const isIvory = (t: { ref: string | null; overrides: Record<string, unknown> }) =>
      t.ref === IVORY && Object.keys(t.overrides).length === 0;

    // The toast's Undo restores the theme, and is recorded as a step of its own.
    await themeCard(page, "Ivory").click();
    await expectStoredTheme(user.pageId, isIvory);
    await page.getByTestId("theme-undo").click();
    await expectStoredTheme(user.pageId, isPrevious);
    await page.keyboard.press(UNDO_KEY); // back to Ivory applied
    await expectStoredTheme(user.pageId, isIvory);
    await page.keyboard.press(UNDO_KEY); // back to the start
    await expectStoredTheme(user.pageId, isPrevious);
    await expect(undoButton(page)).toBeDisabled();

    // The shortcut: one Ctrl+Z restores the exact previous theme, Shift+Ctrl+Z applies Ivory again.
    await themeCard(page, "Ivory").click();
    await expectStoredTheme(user.pageId, isIvory);
    await page.keyboard.press(UNDO_KEY);
    await expectStoredTheme(user.pageId, isPrevious);
    await expectAppliedTheme(page, "Noir", "Edited");
    // Applying was one step: nothing is left to undo from here.
    await expect(undoButton(page)).toBeDisabled();
    await page.keyboard.press(REDO_KEY);
    await expectStoredTheme(user.pageId, isIvory);
    await expect(redoButton(page)).toBeDisabled();
  });

  test("M6-08 Save as theme: Undo points the draft back but keeps the new theme in the grid; Redo points at it again, even after it was deleted (the notice shows)", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "dth2", "pro");
    const previous = await storedTheme(user.pageId);
    await openDesignWithCard(page);
    const before = await themeCards(page).count();

    await page.getByTestId("save-as-theme").click();
    await expect.poll(async () => (await storedTheme(user.pageId)).ref).not.toBe(previous.ref);
    const saved = (await storedTheme(user.pageId)).ref!;
    await expect(themeCards(page)).toHaveCount(before + 1);

    await page.keyboard.press(UNDO_KEY);
    await expectStoredTheme(
      user.pageId,
      (t) =>
        t.ref === previous.ref &&
        JSON.stringify(t.overrides) === JSON.stringify(previous.overrides),
    );
    // The theme is not deleted: it stays in the grid and in the database.
    await expect(themeCards(page)).toHaveCount(before + 1);
    const { data } = await adminClient().from("themes").select("id").eq("id", saved).maybeSingle();
    expect(data?.id).toBe(saved);

    // The theme is deleted in the grid while the draft points elsewhere: that is not a step.
    await chooseThemeMenuItem(page, "My theme 1", "Delete");
    await page
      .getByTestId("delete-theme-dialog")
      .getByRole("button", { name: "Delete theme" })
      .click();
    await expect(themeCards(page)).toHaveCount(before);
    await expect(undoButton(page)).toBeDisabled();

    // Redo still applies, and the existing notice says the theme is gone.
    await page.keyboard.press(REDO_KEY);
    await expectStoredTheme(user.pageId, (t) => t.ref === saved);
    await expect(page.getByTestId("theme-deleted-notice")).toHaveText(
      "The theme this page used was deleted. It now uses the default theme.",
    );
    await expectNoThemeApplied(page);
    await page.keyboard.press(UNDO_KEY);
    await expect(page.getByTestId("theme-deleted-notice")).toHaveCount(0);
  });

  test("M6-08 a theme row deleted behind the screen's back between Undo and Redo: Redo still applies, nothing crashes, and a reload resolves to the default theme with the notice", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "dth3", "pro");
    await openDesignWithCard(page);
    await page.getByTestId("save-as-theme").click();
    await expect.poll(async () => (await storedTheme(user.pageId)).ref).not.toBe(NOIR);
    const saved = (await storedTheme(user.pageId)).ref!;
    await page.keyboard.press(UNDO_KEY);
    await expectStoredTheme(user.pageId, (t) => t.ref === NOIR);
    await adminClient().from("themes").delete().eq("id", saved);
    await page.keyboard.press(REDO_KEY);
    await expectStoredTheme(user.pageId, (t) => t.ref === saved);
    await expect(undoButton(page)).toBeEnabled();
    await expect(page.getByRole("tab", { name: "Design", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.reload();
    await expect(page.getByTestId("theme-deleted-notice")).toBeVisible();
    await expectNoThemeApplied(page);
  });
});

test.describe("M6-08 a background image that was deleted since", () => {
  test.describe.configure({ timeout: 120_000 });

  test("M6-08 undoing the removal of a background image restores it only while its file exists; otherwise the page says why", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const user = await themeUser(context, "dbg");
    owners.push(user.userId);
    await openDesignWithCard(page);
    const png = await makePngImage({ width: 240, height: 180, color: [90, 30, 120] });
    await page
      .locator("input[type=file]")
      .last()
      .setInputFiles({ name: "bg.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("button", { name: "Remove image" })).toBeVisible();
    await expect
      .poll(async () => typeof (await overridesOf(user.pageId)).bgImage, { timeout: 20_000 })
      .toBe("string");
    const withImage = await overridesOf(user.pageId);
    const path = mediaPathOf(String(withImage.bgImage), new URL(String(withImage.bgImage)).origin)!;
    expect(path).toBeTruthy();

    await page.getByRole("button", { name: "Remove image" }).click();
    await expect
      .poll(async () => (await overridesOf(user.pageId)).bgImage ?? null, { timeout: 20_000 })
      .toBeNull();
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });
    const removed = await overridesOf(user.pageId);

    // The file is still there: Undo restores the image, Redo removes it again.
    await page.keyboard.press(UNDO_KEY);
    await expectOverridesEqual(user.pageId, withImage, "Undo restores the background image");
    await page.keyboard.press(REDO_KEY);
    await expectOverridesEqual(user.pageId, removed, "Redo removes it again");
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });

    // The file is deleted (the cleanup did it): Undo changes nothing and says why.
    const { error } = await adminClient().storage.from("page-media").remove([path]);
    expect(error).toBeNull();
    const patches = patchesOf(page);
    await page.keyboard.press(UNDO_KEY);
    await expect(page.locator("[data-history-notice]")).toHaveText(
      "Can’t undo that. The earlier image was already deleted.",
    );
    await page.waitForTimeout(1500);
    expect(patches).toHaveLength(0);
    expect(await overridesOf(user.pageId)).toEqual(removed);
    await expect(undoButton(page)).toBeEnabled();
  });
});

test.describe("M6-08 saves, tabs and leaving", () => {
  test("M6-08 each Undo is a PATCH of draft only with rev + 1; a tab that is behind gets the stale message instead of overwriting", async ({
    page,
    context,
    browser,
  }) => {
    const user = await themeUser(context, "dst");
    const contextB = await browser.newContext(
      page.viewportSize() ? { viewport: page.viewportSize()! } : {},
    );
    try {
      await signInAs(contextB, user.email);
      const pageB = await contextB.newPage();
      await openDesignWithCard(pageB); // B loads at rev N
      await showTokens(pageB);
      await option(pageB, "Corner radius", "20px").click(); // N+1
      await expect(saveStatus(pageB)).toHaveText("Saved", { timeout: 20_000 });

      await openDesignWithCard(page); // A loads at N+1
      await showTokens(page);
      const patchesA = patchesOf(page);
      const storedRev = (await pageRow(user.pageId)).draft.rev;
      await option(page, "Border thickness", "2px").click(); // N+2
      await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });
      await undoButton(page).click(); // A's own Undo: N+3, one PATCH of `draft` only
      await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });
      await expectOverridesEqual(user.pageId, { radius: 20 }, "A's undo is stored");
      const last = patchesA[patchesA.length - 1]!;
      expect(last.keys).toEqual(["draft"]);
      expect(last.rev).toBe(storedRev + 2);

      // B's Undo is conditional on rev N+1: the database is at N+3, so it matches no row.
      const before = await pageRow(user.pageId);
      await undoButton(pageB).click();
      await expect(
        pageB.getByText("This page changed in another tab. Reload to keep editing."),
      ).toBeVisible({ timeout: 20_000 });
      const after = await pageRow(user.pageId);
      expect(after.draft).toEqual(before.draft);
    } finally {
      await contextB.close();
    }
  });

  test("M6-08 leaving the workspace leaves the history behind: the Editor opens on the saved draft with Undo disabled (M7-02 replaces 'Done')", async ({
    page,
    context,
  }, info) => {
    const user = await themeUser(context, "ddn");
    await openDesignWithCard(page);
    await showTokens(page);
    await option(page, "Corner radius", "20px").click();
    await expect(undoButton(page)).toBeEnabled();
    await expect.poll(async () => (await overridesOf(user.pageId)).radius).toBe(20);
    // Leave the workspace (Analytics, or Stats on a phone) and come back with the Editor link.
    const nav = phoneOnly(info)
      ? page.getByRole("navigation", { name: "App sections" })
      : page.getByRole("navigation", { name: "App", exact: true });
    await nav.getByRole("link", { name: /^(Analytics|Stats)$/ }).click();
    await page.waitForURL(/\/analytics$/);
    const editor = nav.getByRole("link", { name: "Editor" });
    const box = (await editor.boundingBox())!;
    // Away from the left edge, where Next's dev indicator sits over the first item on a phone.
    await editor.click({ position: { x: box.width - 8, y: box.height / 2 } });
    await page.waitForURL(/\/editor$/);
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await expect(undoButton(page)).toBeDisabled();
    expect((await overridesOf(user.pageId)).radius).toBe(20);
    // Coming back to Design, the history starts empty too.
    await openDesignWithCard(page);
    await expect(undoButton(page)).toBeDisabled();
  });
});
