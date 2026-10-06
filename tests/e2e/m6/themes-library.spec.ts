import { expect, test, type Locator } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import type { TokenSet } from "@/lib/theme";
import { url } from "../helpers";
import { ownThemesRow, publishFromEditor, systemThemesRow } from "../m3/themes-helpers";
import {
  NEW_THEME_NAMES,
  NOIR,
  SYSTEM_IDS,
  SYSTEM_NAMES,
  expectNoHorizontalScroll,
  expectStoredTheme,
  expectTapTargets,
  expectAppliedTheme,
  messageOf,
  openDesignWithCard,
  previewFontFamilies,
  previewLook,
  previewRootOf,
  rootVars,
  savedThemesCard,
  seedTheme,
  showPreview,
  showTokens,
  storedTheme,
  themeCard,
  themeCards,
  themeUser,
} from "./themes-helpers";

/**
 * M6-43: the Design screen with sixteen system themes. The rows themselves (count, ids, contrast,
 * variety) are proven in supabase/tests/database/130-more-themes.test.sql and
 * tests/unit/m6-themes-catalog.test.ts; the access rules in themes-api.spec.ts. Here: the grid, the
 * swatches, applying each new theme and publishing one, and the layout at both viewports.
 */

test.afterAll(cleanupUsers);

type Row = { id: string; name: string; tokens: TokenSet };

async function systemRows(): Promise<Row[]> {
  const { data, error } = await adminClient()
    .from("themes")
    .select("id, name, tokens")
    .is("owner_id", null)
    .order("id", { ascending: true });
  if (error) throw new Error(`reading the system themes failed: ${error.message}`);
  return data as unknown as Row[];
}

const swatchOf = (card: Locator): Locator => card.locator("[data-swatch]");

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

/** `#RRGGBB` as the `rgb(r, g, b)` a computed style reports. */
function rgb(hex: string): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

const families = (tokens: TokenSet): string[] => [
  ...new Set([tokens.fontHeading, tokens.fontBody]),
];

test.describe("M6-43 the grid of sixteen", () => {
  test("M6-43 the Saved themes grid shows the 16 system cards in id order, then the user's own, with real swatches", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "p43a", "pro");
    await seedTheme(user.userId, "Night shift", { accent: "#112233" });
    await seedTheme(user.userId, "Day shift", {
      bg: "#101820",
      bgType: "gradient",
      gradientAngle: 90,
      gradientFrom: "#C46A4F",
      gradientTo: "#1B1814",
    });
    const rows = await systemRows();
    expect(rows.map((row) => row.name)).toEqual(SYSTEM_NAMES);
    await openDesignWithCard(page);

    const cards = themeCards(page);
    await expect(cards).toHaveCount(18);
    const names = await savedThemesCard(page).locator("[data-theme-name]").allTextContents();
    // M7-06: the user's own row comes first, then the sixteen.
    expect(names).toEqual(["Night shift", "Day shift", ...SYSTEM_NAMES]);

    // Every card has its 48px swatch with a filled and an outlined accent bar over it.
    for (const row of rows) {
      const card = themeCard(page, row.name);
      const swatch = swatchOf(card);
      expect((await box(swatch)).height).toBe(48);
      await expect(swatch.locator("> span")).toHaveCount(2);
      const css = await swatch.evaluate((el) => {
        const style = getComputedStyle(el);
        return { image: style.backgroundImage, color: style.backgroundColor };
      });
      if (row.tokens.bgType === "gradient") {
        // The actual gradient: its two colors are in the swatch.
        expect(css.image, `${row.name} swatch is a gradient`).toContain("linear-gradient");
        const from = row.tokens.gradientFrom ?? row.tokens.surface;
        const to = row.tokens.gradientTo ?? row.tokens.bg;
        expect(css.image).toContain(rgb(from));
        expect(css.image).toContain(rgb(to));
        // (A computed style leaves the default 180deg, top to bottom, out.)
        if (row.tokens.gradientAngle !== 180) {
          expect(css.image).toContain(`${row.tokens.gradientAngle}deg`);
        }
      } else {
        expect(css.image, `${row.name} swatch is its bg color`).toBe("none");
        expect(css.color).toBe(rgb(row.tokens.bg));
      }
    }
    // A user's own gradient theme shows its gradient too.
    const own = await swatchOf(themeCard(page, "Day shift")).evaluate(
      (el) => getComputedStyle(el).backgroundImage,
    );
    expect(own).toContain("90deg");
    expect(own).toContain(rgb("#C46A4F"));

    // The applied one is tagged.
    await expect(themeCard(page, "Noir").locator("[data-theme-tag]")).toHaveText("Applied");
    await expect(savedThemesCard(page).locator("[data-theme-tag]")).toHaveCount(1);
  });

  test("M6-43 pressing a new card applies it with Applied and Undo, and the preview takes its colors and fonts", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "p43b", "free");
    const before = await storedTheme(user.pageId);
    const sunset = (await systemRows()).find((row) => row.name === "Sunset")!;
    await openDesignWithCard(page);

    await themeCard(page, "Sunset").click();
    await expect(messageOf(page)).toContainText("Applied Sunset.");
    await expect(messageOf(page).getByRole("button", { name: "Undo" })).toBeVisible();
    await expectAppliedTheme(page, "Sunset");
    await expect(themeCard(page, "Sunset")).toHaveAttribute("aria-pressed", "true");
    await expectStoredTheme(user.pageId, (theme) => theme.ref === SYSTEM_IDS.Sunset);
    expect((await storedTheme(user.pageId)).overrides).toEqual({});

    await showPreview(page);
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe(sunset.tokens.bg);
    expect((await previewLook(page)).vars.accent).toBe(sunset.tokens.accent);
    expect(await previewFontFamilies(page)).toEqual(families(sunset.tokens));

    // Undo restores the earlier theme, as M3-20 says.
    await showTokens(page);
    await messageOf(page).getByRole("button", { name: "Undo" }).click();
    await expectStoredTheme(user.pageId, (theme) => theme.ref === NOIR);
    expect(await storedTheme(user.pageId)).toEqual(before);
  });
});

test.describe("M6-43 each new theme on the page", () => {
  test("M6-43 applying each of the nine new themes renders the preview in its background and its two fonts; publishing one gives the live page the same variables", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const user = await themeUser(context, "p43c", "free");
    const rows = await systemRows();
    await openDesignWithCard(page);

    for (const name of NEW_THEME_NAMES) {
      const row = rows.find((candidate) => candidate.name === name)!;
      await showTokens(page);
      await themeCard(page, name).click();
      await expect(messageOf(page)).toContainText(`Applied ${name}.`);
      await expectAppliedTheme(page, name);
      await expectStoredTheme(user.pageId, (theme) => theme.ref === row.id);

      await showPreview(page);
      const root = previewRootOf(page);
      await expect.poll(async () => (await previewLook(page)).vars.bg).toBe(row.tokens.bg);
      const look = await previewLook(page);
      if (row.tokens.bgType === "gradient") {
        expect(look.bg.image, `${name} draws its gradient`).toContain("linear-gradient");
        const from = row.tokens.gradientFrom ?? row.tokens.surface;
        const to = row.tokens.gradientTo ?? row.tokens.bg;
        expect(look.bg.image).toContain(rgb(from));
        expect(look.bg.image).toContain(rgb(to));
      } else {
        expect(look.bg.image).toBe("none");
        expect(look.bg.color).toBe(rgb(row.tokens.bg));
      }
      // Only this theme's two families are loaded in the preview.
      expect(await previewFontFamilies(page), `${name} fonts`).toEqual(families(row.tokens));
      await expect(root).toBeVisible();
      await expectNoHorizontalScroll(page);
    }

    // Publish with one of them: the live page carries the same CSS variable values.
    await showTokens(page);
    await themeCard(page, "Plum").click();
    await expectStoredTheme(user.pageId, (theme) => theme.ref === SYSTEM_IDS.Plum);
    await showPreview(page);
    await expect.poll(async () => (await previewLook(page)).vars.bg).toBe("#2A1245");
    const previewVars = await rootVars(previewRootOf(page));

    await publishFromEditor(page);
    const live = await context.newPage();
    await live.goto(url(user.handle));
    const liveVars = await rootVars(live.locator("[data-page-root]"));
    expect(liveVars).toEqual(previewVars);
    expect(liveVars["gradient-from"]).toBe("#2A1245");
    expect(liveVars["gradient-to"]).toBe("#6B2F7A");
    expect(liveVars["gradient-angle"]).toBe("135deg");
    await live.close();
  });
});

test.describe("M6-43 layout", () => {
  test("M6-43 on a phone the rows show two cards and a part of a third, every card and every More button is 44px, nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone only");
    const user = await themeUser(context, "p43d", "pro");
    await seedTheme(user.userId, "Night shift");
    await seedTheme(user.userId, "Day shift");
    await openDesignWithCard(page);

    // M7-06: each row is a horizontal scroll container; the two cards of a row and a sliver of the next.
    const row = systemThemesRow(page).getByRole("region");
    const rowBox = await box(row);
    const cards = themeCards(page);
    await expect(cards).toHaveCount(18);
    const third = await box(systemThemesRow(page).getByTestId("theme-card").nth(2));
    expect(third.x).toBeLessThan(rowBox.x + rowBox.width);
    expect(third.x + third.width).toBeGreaterThan(rowBox.x + rowBox.width);
    const firstSystem = await box(themeCard(page, "Noir"));
    const firstOwn = await box(themeCard(page, "Night shift"));
    expect(firstOwn.y, "the user's own row sits above the sixteen").toBeLessThan(firstSystem.y);
    for (const index of [0, 1, 2, 3, 17]) {
      expect((await box(cards.nth(index))).height).toBeGreaterThanOrEqual(44);
    }
    for (const name of ["Night shift", "Day shift"]) {
      const b = await box(page.getByRole("button", { name: `More for ${name}`, exact: true }));
      expect(b.height, `More for ${name}`).toBeGreaterThanOrEqual(44);
      expect(b.width, `More for ${name}`).toBeGreaterThanOrEqual(44);
    }
    await expectTapTargets(page, "[data-testid=saved-themes-card]");
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test("M6-43 on a desktop the rows fill the 720px column, the card keeps its height as saved themes are added and the preview column stays put", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop only");
    const user = await themeUser(context, "p43e", "pro");
    await openDesignWithCard(page);

    const card = savedThemesCard(page);
    const cardBox = await box(card);
    expect(Math.round(cardBox.width)).toBeLessThanOrEqual(720);
    for (const row of [ownThemesRow(page), systemThemesRow(page)]) {
      const r = await box(row.getByRole("region"));
      expect(r.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(r.x + r.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(r.width).toBeGreaterThanOrEqual(cardBox.width - 4);
    }

    // The Themes card is the same height whatever the number of saved themes (M7-06); the preview
    // column does not move.
    const column = page.getByTestId("workspace-preview");
    const columnBefore = await box(column);
    const heightBefore = cardBox.height;
    for (const n of [1, 2, 3, 4, 5]) await seedTheme(user.userId, `Extra ${n}`);
    await page.reload();
    await expect(savedThemesCard(page)).toBeVisible();
    await expect(themeCards(page)).toHaveCount(21);
    const columnAfter = await box(column);
    const heightAfter = (await box(card)).height;
    expect(Math.abs(heightAfter - heightBefore)).toBeLessThanOrEqual(1);
    expect(Math.round(columnAfter.x)).toBe(Math.round(columnBefore.x));
    expect(Math.round(columnAfter.y)).toBe(Math.round(columnBefore.y));
    expect(Math.round(columnAfter.width)).toBe(330);
    await expectNoHorizontalScroll(page);
  });
});
