import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, makeUser, phoneOnly } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { setOverrides } from "../m3/design-helpers";
import { openEditor, statusChip } from "../m2/editor-helpers";
import {
  NOIR,
  PLAIN_LINK,
  FILL_LINK,
  expectNoHorizontalScroll,
  expectTapTargets,
  headerStatus,
  isPhone,
  messageOf,
  openDesignWithCard,
  pageRow,
  previewButton,
  applyPreviewButton,
  previewFontFamilies,
  previewLook,
  previewRootOf,
  savedThemesCard,
  seedTheme,
  showPreview,
  showTokens,
  storedTheme,
  expectStoredTheme,
  themeCard,
  themeCards,
  themeUser,
  trackWrites,
  SYSTEM_IDS,
} from "./themes-helpers";

/**
 * M6-44: previewing a theme on the page before applying it. A preview is derived state: the page
 * with the theme's tokens, nothing written, nothing published. Every test makes its own user (a
 * copy of mara's published page, Noir, one block with its own button style); mara is never touched.
 */

test.afterAll(cleanupUsers);

const NOIR_FONTS = ["Instrument Serif", "Geist"];
const PAPER_FONTS = ["Bricolage Grotesque", "DM Sans"];

async function box(locator: ReturnType<Page["locator"]>) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

test.describe("M6-44 the Preview button on every card", () => {
  test("M6-44 every card, system and saved, has a 44px Preview button on its own row; the card still applies; no Pro chip", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "p44a", "free");
    await seedTheme(user.userId, "Night shift", { accent: "#112233" });
    await openDesignWithCard(page);

    await expect(themeCards(page)).toHaveCount(17);
    for (const name of Object.keys(SYSTEM_IDS)) {
      await expect(previewButton(page, name)).toBeVisible();
    }
    await expect(previewButton(page, "Night shift")).toBeVisible();
    await expect(page.locator("[data-testid=theme-preview]")).toHaveCount(17);

    // White, a 1px --hl-line-3 border, 44px tall, as wide as the card, on its own row.
    for (const name of ["Noir", "Paper", "Sunset", "Night shift"]) {
      const button = previewButton(page, name);
      const card = themeCard(page, name);
      const b = await box(button);
      const c = await box(card);
      expect(b.height, `${name} Preview height`).toBeGreaterThanOrEqual(44);
      expect(
        Math.abs(b.width - c.width),
        `${name} Preview is as wide as its card`,
      ).toBeLessThanOrEqual(1);
      expect(b.y, `${name} Preview sits under its card`).toBeGreaterThan(c.y + c.height - 1);
      const style = await button.evaluate((el) => {
        const css = getComputedStyle(el);
        return { bg: css.backgroundColor, border: css.borderTopWidth, color: css.borderTopColor };
      });
      expect(style.bg).toBe("rgb(255, 255, 255)");
      expect(style.border).toBe("1px");
      expect(style.color).not.toBe("rgba(0, 0, 0, 0)");
    }
    // On a saved theme the Preview row is above Rename and Delete.
    const preview = await box(previewButton(page, "Night shift"));
    const rename = await box(page.getByRole("button", { name: "Rename Night shift" }));
    const remove = await box(page.getByRole("button", { name: "Delete Night shift" }));
    expect(rename.y).toBeGreaterThanOrEqual(preview.y + preview.height - 1);
    expect(remove.y).toBeGreaterThanOrEqual(preview.y + preview.height - 1);
    expect(Math.abs(preview.x - rename.x)).toBeLessThanOrEqual(1);

    // The same on a Free account: no Pro chip anywhere in the card.
    await expect(savedThemesCard(page)).not.toContainText(/\bPro\b/);
    await expect(savedThemesCard(page).getByText(/upgrade/i)).toHaveCount(0);

    // Pressing the card itself still applies, with Applied and Undo.
    await themeCard(page, "Paper").click();
    await expect(messageOf(page)).toContainText("Applied Paper.");
    await expect(messageOf(page).getByRole("button", { name: "Undo" })).toBeVisible();
    await expectStoredTheme(user.pageId, (theme) => theme.ref === SYSTEM_IDS.Paper);
  });
});

test.describe("M6-44 previewing a theme", () => {
  test("M6-44 Preview shows the page in the theme with the real profile and blocks, writes nothing, and Stop puts it back", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "p44b", "free");
    // A page-level override that applying Paper would clear: the preview leaves it out.
    await setOverrides(user.pageId, { accent: "#C46A4F", radius: 20 });
    const before = await pageRow(user.pageId);
    await openDesignWithCard(page);
    await expect(headerStatus(page)).toHaveText("Theme · Noir · edited");

    const own = await previewLook(page);
    expect(own.vars.accent).toBe("#C46A4F");
    expect(await previewFontFamilies(page)).toEqual(NOIR_FONTS);
    const ownBlocks = await previewRootOf(page).locator("a").count();

    const writes = trackWrites(page);
    await previewButton(page, "Paper").click();

    // The page as it would look with Paper applied: Paper's tokens, no page-level overrides. (On a
    // phone pressing Preview has already opened the Preview tab.)
    await expect(page.getByTestId("theme-preview-status")).toHaveText("Previewing Paper.");
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#FBFAF7");
    const paper = await previewLook(page);
    expect(paper.vars.accent).toBe("#2F4B9A");
    expect(paper.vars.radius).toBe("8px");
    expect(paper.bg.color).toBe("rgb(251, 250, 247)");
    // The real profile and blocks.
    await expect(previewRootOf(page)).toContainText(before.draft.profile.name);
    expect(await previewRootOf(page).locator("a").count()).toBe(ownBlocks);

    // Only Paper's two families are requested.
    expect(await previewFontFamilies(page)).toEqual(PAPER_FONTS);

    if (isPhone(page)) {
      const bar = page.getByTestId("theme-preview-bar");
      await expect(bar).toContainText("Previewing Paper");
      await expect(applyPreviewButton(page, "Paper")).toBeFocused();
      await expect(bar.getByRole("button", { name: "Back to my style" })).toBeVisible();
    } else {
      await expect(page.getByTestId("theme-preview-header")).toContainText("Previewing Paper");
      await expect(page.getByText("Live preview", { exact: true })).toHaveCount(0);
      await expect(applyPreviewButton(page, "Paper")).toBeFocused();
      await expect(page.getByRole("button", { name: "Stop previewing" })).toBeVisible();
    }
    // The card tags and the Design header still describe the applied theme.
    await expect(headerStatus(page)).toHaveText("Theme · Noir · edited");
    await expect(themeCard(page, "Noir").locator("[data-theme-tag]")).toHaveText("Edited");

    // Nothing was written: no draft or theme request, the stored draft and rev are as they were.
    await page.waitForTimeout(1500);
    expect(writes.requests).toEqual([]);
    const during = await pageRow(user.pageId);
    expect(during.draft).toEqual(before.draft);
    expect(during.published).toEqual(before.published);

    // Stop previewing / Back to my style puts the page back.
    if (isPhone(page)) {
      await page.getByRole("button", { name: "Back to my style" }).click();
      await expect(page.getByRole("tab", { name: "Style" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } else {
      await page.getByRole("button", { name: "Stop previewing" }).click();
    }
    await expect(previewButton(page, "Paper")).toBeFocused();
    await expect(page.getByTestId("theme-preview-status")).toHaveText("");
    await showPreview(page);
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#16120E");
    expect((await previewLook(page)).vars.accent).toBe("#C46A4F");
    expect(await previewFontFamilies(page)).toEqual(NOIR_FONTS);

    // A reload shows the page in its own theme: a preview is never stored.
    await page.reload();
    await expect(savedThemesCard(page)).toBeVisible();
    await showPreview(page);
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#16120E");
    const after = await pageRow(user.pageId);
    expect(after.draft).toEqual(before.draft);
    expect(writes.requests).toEqual([]);

    // Opening /editor shows the page in its own theme and the status chip as it was: the page-level
    // overrides set above are still unpublished changes, and the preview changed nothing about it.
    await openEditor(page);
    await expect(statusChip(page)).toContainText("Unpublished changes");
    const editorRoot = page.locator("[data-page-root]").first();
    const editorVars = await editorRoot.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        bg: style.getPropertyValue("--t-bg").trim().toUpperCase(),
        accent: style.getPropertyValue("--t-accent").trim().toUpperCase(),
      };
    });
    expect(editorVars).toEqual({ bg: "#16120E", accent: "#C46A4F" });
  });

  test("M6-44 each block keeps its own style in the preview and a second Preview replaces the first", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the second press needs the card list, which a phone leaves");
    await themeUser(context, "p44c", "free");
    await openDesignWithCard(page);

    await previewButton(page, "Smoke").click();
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#1C2023");
    // The block with its own Fill style keeps it; the plain link follows Smoke's Pill.
    const styles = await previewRootOf(page).evaluate(
      (root, ids) =>
        ids.map(
          (id) =>
            root
              .querySelector(
                `[data-block-id="${id}"] [data-button-style], [data-block-id="${id}"][data-button-style]`,
              )
              ?.getAttribute("data-button-style") ?? null,
        ),
      [FILL_LINK, PLAIN_LINK],
    );
    expect(styles[0]).toBe("fill");
    expect(styles[1]).toBe("pill");

    await previewButton(page, "Ember").click();
    await expect(page.getByTestId("theme-preview-header")).toContainText("Previewing Ember");
    await expect(page.getByTestId("theme-preview-status")).toHaveText("Previewing Ember.");
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#1B1412");
    await expect(applyPreviewButton(page, "Ember")).toBeFocused();
    await expect(page.getByRole("button", { name: "Apply Smoke" })).toHaveCount(0);
  });
});

test.describe("M6-44 ending a preview", () => {
  test("M6-44 a control, Save as theme and Done end the preview first, then do their normal job", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop: the controls sit beside the preview");
    const user = await themeUser(context, "p44d", "free");
    await openDesignWithCard(page);

    // A color change.
    await previewButton(page, "Paper").click();
    await expect(page.getByTestId("theme-preview-header")).toBeVisible();
    await page.getByRole("button", { name: "Accent Brass" }).click();
    await expect(page.getByTestId("theme-preview-header")).toHaveCount(0);
    await expect(page.getByText("Live preview", { exact: true })).toBeVisible();
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#16120E");
    await expectStoredTheme(
      user.pageId,
      (theme) => theme.ref === NOIR && theme.overrides.accent !== undefined,
    );
    expect((await storedTheme(user.pageId)).ref).toBe(NOIR);

    // Save as theme: it saves the page's own look, not the previewed theme.
    await previewButton(page, "Paper").click();
    await expect(page.getByTestId("theme-preview-header")).toBeVisible();
    await page.getByTestId("save-as-theme").click();
    await expect(page.getByTestId("theme-preview-header")).toHaveCount(0);
    await expect(messageOf(page)).toContainText("Saved as My theme 1.");
    const { data } = await adminClient()
      .from("themes")
      .select("tokens")
      .eq("owner_id", user.userId)
      .single();
    expect((data!.tokens as { bg: string }).bg).toBe("#16120E");

    // Done: the editor opens, the draft is the page's own.
    await previewButton(page, "Ember").click();
    await expect(page.getByTestId("theme-preview-header")).toBeVisible();
    await page.getByRole("link", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/editor$/);
    const stored = await storedTheme(user.pageId);
    expect(stored.ref).not.toBe(SYSTEM_IDS.Ember);
  });

  test("M6-44 Apply Paper applies exactly like the card: one PATCH, Applied with Undo, the card tagged, Undo restores", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop; the phone flow is in its own test");
    const user = await themeUser(context, "p44e", "free");
    await setOverrides(user.pageId, { accent: "#C46A4F" });
    const before = await storedTheme(user.pageId);
    await openDesignWithCard(page);

    await previewButton(page, "Paper").click();
    await expect(applyPreviewButton(page, "Paper")).toBeFocused();
    const patches: { body: Record<string, unknown> }[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages")) {
        patches.push({ body: JSON.parse(request.postData() ?? "{}") as Record<string, unknown> });
      }
    });
    await applyPreviewButton(page, "Paper").click();

    await expect(messageOf(page)).toContainText("Applied Paper.");
    await expect(messageOf(page).getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByTestId("theme-preview-header")).toHaveCount(0);
    await expect(page.getByText("Live preview", { exact: true })).toBeVisible();
    await expect(themeCard(page, "Paper")).toHaveAttribute("aria-pressed", "true");
    await expect(themeCard(page, "Paper").locator("[data-theme-tag]")).toHaveText("Applied");
    await expect(headerStatus(page)).toHaveText("Theme · Paper");
    await expect(previewButton(page, "Paper")).toBeFocused();
    await expectStoredTheme(user.pageId, (theme) => theme.ref === SYSTEM_IDS.Paper);
    expect((await storedTheme(user.pageId)).overrides).toEqual({});

    // One autosave PATCH, carrying only the draft column.
    await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]!.body)).toEqual(["draft"]);

    // The Undo stays at least 8 seconds, and restores the previous theme and overrides.
    await page.waitForTimeout(8_000);
    await expect(messageOf(page).getByRole("button", { name: "Undo" })).toBeVisible();
    await messageOf(page).getByRole("button", { name: "Undo" }).click();
    await expectStoredTheme(user.pageId, (theme) => theme.ref === NOIR);
    expect(await storedTheme(user.pageId)).toEqual(before);
  });
});

test.describe("M6-44 saved themes and other people's themes", () => {
  test("M6-44 a saved theme previews with its own tokens; another user's theme is never in the grid or readable", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough for the data rules");
    const user = await themeUser(context, "p44f", "free");
    const other = await makeUser("p44fo", { plan: "pro" });
    await seedTheme(other.id, "Someone else's look", { accent: "#FF00AA" });
    const mine = await seedTheme(user.userId, "Night shift", { bg: "#101820", accent: "#33FFAA" });
    await openDesignWithCard(page);

    await expect(page.locator("body")).not.toContainText("Someone else's look");
    await expect(page.getByRole("button", { name: /Preview Someone/ })).toHaveCount(0);

    const writes = trackWrites(page);
    await previewButton(page, "Night shift").click();
    await expect(page.getByTestId("theme-preview-status")).toHaveText("Previewing Night shift.");
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#101820");
    expect((await previewLook(page)).vars.accent).toBe("#33FFAA");
    expect(writes.requests).toEqual([]);
    expect(mine.id).toBeTruthy();

    // Direct API: user B's JWT and the publishable key read none of user A's themes.
    const token = await accessTokenFor(other.email);
    const read = await restAs(token, `/themes?owner_id=eq.${user.userId}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual([]);
    const byId = await restAs(token, `/themes?id=eq.${mine.id}`);
    expect(byId.body).toEqual([]);
  });
});

test.describe("M6-44 on a phone", () => {
  test("M6-44 Preview opens the Preview tab with a bar above the tab bar; Apply returns to Style with Applied and Undo; Back to my style leaves the page as it was", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone only");
    const user = await themeUser(context, "p44g", "free");
    await openDesignWithCard(page);
    const before = await pageRow(user.pageId);
    const writes = trackWrites(page);

    // Every Preview button is at least 44px tall; the grid and the bar do not scroll sideways.
    for (const name of ["Noir", "Paper", "Sunset"]) {
      expect((await box(previewButton(page, name))).height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalScroll(page);

    await previewButton(page, "Paper").click();
    await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const bar = page.getByTestId("theme-preview-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("Previewing Paper");
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#FBFAF7");
    // The page fills the width.
    const screen = await box(page.getByTestId("preview-screen"));
    expect(screen.width).toBeGreaterThanOrEqual(340);
    // 44px buttons, wrapping onto rows, above the bottom tab bar.
    for (const name of ["Apply Paper", "Back to my style"]) {
      expect((await box(bar.getByRole("button", { name }))).height).toBeGreaterThanOrEqual(44);
    }
    const barBox = await box(bar);
    const viewportHeight = page.viewportSize()!.height;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(viewportHeight - 60);
    await expectNoHorizontalScroll(page);
    expect(writes.requests).toEqual([]);

    // The bar never covers the end of the page: scrolled to the bottom, the last content ends above it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await box(previewRootOf(page).locator(".pg-column"));
    expect(last.y + last.height).toBeLessThanOrEqual(barBox.y + 1);

    // Back to my style: the Style tab, the page unchanged, focus on the card's Preview.
    await bar.getByRole("button", { name: "Back to my style" }).click();
    await expect(page.getByRole("tab", { name: "Style" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("theme-preview-bar")).toHaveCount(0);
    await expect(previewButton(page, "Paper")).toBeFocused();
    expect((await pageRow(user.pageId)).draft).toEqual(before.draft);

    // Apply Paper: back on the Style tab with Applied and Undo above the tab bar.
    await previewButton(page, "Paper").click();
    await page
      .getByTestId("theme-preview-bar")
      .getByRole("button", { name: "Apply Paper" })
      .click();
    await expect(page.getByRole("tab", { name: "Style" })).toHaveAttribute("aria-selected", "true");
    await expect(messageOf(page)).toContainText("Applied Paper.");
    await expect(messageOf(page).getByRole("button", { name: "Undo" })).toBeVisible();
    const message = await box(messageOf(page));
    expect(message.y + message.height).toBeLessThanOrEqual(viewportHeight - 60);
    await expectStoredTheme(user.pageId, (theme) => theme.ref === SYSTEM_IDS.Paper);
    await expectTapTargets(page, "[data-testid=saved-themes-card]");
    await expectNoHorizontalScroll(page);
    await showTokens(page);
  });
});

test.describe("M6-44 on a desktop", () => {
  test("M6-44 the two buttons sit under the header inside the 330px column, the bezel stays 310x660 and sticky, the grid is unchanged", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop only");
    await themeUser(context, "p44h", "free");
    await openDesignWithCard(page);
    const column = page.locator("#design-panel-preview");
    const gridBefore = await box(page.getByTestId("theme-grid"));
    const bezelBefore = await box(page.getByTestId("preview-bezel"));
    expect(Math.round(bezelBefore.width)).toBe(310);
    expect(Math.round(bezelBefore.height)).toBe(660);

    await previewButton(page, "Paper").click();
    const header = page.getByTestId("theme-preview-header");
    await expect(header).toBeVisible();
    const col = await box(column);
    expect(Math.round(col.width)).toBe(330);
    const title = await box(header.locator("span").first());
    for (const name of ["Apply Paper", "Stop previewing"]) {
      const b = await box(page.getByRole("button", { name }));
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(col.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(col.x + col.width + 1);
      expect(b.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
    }
    const bezelAfter = await box(page.getByTestId("preview-bezel"));
    expect(Math.round(bezelAfter.width)).toBe(310);
    expect(Math.round(bezelAfter.height)).toBe(660);
    const gridAfter = await box(page.getByTestId("theme-grid"));
    expect(Math.round(gridAfter.width)).toBe(Math.round(gridBefore.width));
    expect(Math.round(gridAfter.height)).toBe(Math.round(gridBefore.height));
    await expectNoHorizontalScroll(page);
    // Sticky: scrolled down, the column stays in view.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const stuck = await box(column);
    expect(stuck.y).toBeGreaterThanOrEqual(0);
    expect(stuck.y).toBeLessThan(40);
  });
});
