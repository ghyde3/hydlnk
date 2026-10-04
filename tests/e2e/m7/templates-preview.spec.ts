import { expect, test, type Request } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { TEMPLATES } from "@/lib/templates";
import {
  SYSTEM_IDS,
  TEMPLATE_NAMES,
  cardOf,
  dialogAxe,
  dialogOf,
  drawn,
  emptyPageUser,
  expectNoHorizontalScroll,
  expectTapTargets,
  insideOf,
  openDialog,
  openEditor,
  previewOf,
  previewRootOf,
  rect,
  richUser,
  setDraft,
  pageRow,
  startButton,
  templateButton,
  templateThemeTokens,
} from "./templates-helpers";

/**
 * M7-07, the template picker's cards: a live preview, what is inside and the style, on every card.
 * Each test makes its own user; mara's rows are never touched. The pure parts (the Inside line, the
 * font URL, what the preview document holds) are in tests/unit/m7-templates-*.test.ts.
 */

test.afterAll(cleanupUsers);

const INSIDE = {
  Musician: "6 blocks: header, embed, 2 links, card, social",
  Podcaster: "8 blocks: header, 4 links, embed, text, social",
  Artist: "6 blocks: image, header, grid, link, text, social",
  Shop: "7 blocks: header, card, grid, 2 links, text, social",
  Coach: "6 blocks: text, 2 links, card, embed, social",
  Streamer: "5 blocks: 3 links, grid, social",
} as const;
const STYLE = {
  Musician: "Midnight",
  Podcaster: "Smoke",
  Artist: "Ivory",
  Shop: "Paper",
  Coach: "Sage",
  Streamer: "Ember",
} as const;

test.describe("M7-07 the cards", () => {
  test("M7-07 each card shows its name, description, a live preview, Inside, Style and Use this template, top to bottom, and the strip of colors is gone", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough for the card's content");
    await emptyPageUser(context, "tp7-a");
    await openEditor(page);
    await openDialog(page);

    const dialog = dialogOf(page);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(
      dialog.getByRole("heading", { level: 2, name: "Start from a template" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Pick a starting point, then change anything you like."),
    ).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(TEMPLATE_NAMES);
    await expect(dialog.getByTestId("template-colors")).toHaveCount(0);

    for (const template of TEMPLATES) {
      const name = template.name as keyof typeof INSIDE;
      const card = cardOf(page, name);
      await card.scrollIntoViewIfNeeded();
      const heading = card.getByRole("heading", { level: 3, name, exact: true });
      const description = card.getByText(template.description, { exact: true });
      const preview = previewOf(page, name);
      const inside = card.getByTestId("template-inside");
      const style = card.getByTestId("template-style");
      const use = templateButton(page, name);

      // The words of the spec, and the same words the catalog derives.
      await expect(inside).toHaveText(`Inside: ${INSIDE[name]}`);
      expect(await inside.innerText()).toBe(insideOf(template));
      await expect(style).toHaveText(`Style: ${STYLE[name]}`);
      await expect(use).toHaveText("Use this template");

      // Top to bottom.
      const ys = [heading, description, preview, inside, style, use].map(async (locator) => {
        const box = await rect(locator);
        return { top: box.y, bottom: box.y + box.height };
      });
      const boxes = await Promise.all(ys);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i]!.top, `${name} item ${i}`).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 1);
      }
      // The card's accessible name is its name and description.
      await expect(
        dialog.getByRole("listitem", { name: `${name} ${template.description}`, exact: true }),
      ).toHaveCount(1);
    }
  });

  test("M7-07 the dialog is the same on Free, Pro and Studio", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough");
    const seen: string[] = [];
    for (const plan of ["free", "pro", "studio"] as const) {
      await context.clearCookies();
      const user = await emptyPageUser(context, `tp7-${plan}`, plan);
      // The previews draw the person's own name: the same name, so the text can be the same.
      const row = await pageRow(user.pageId);
      await setDraft(user.pageId, {
        ...row.draft,
        profile: { ...row.draft.profile, name: "Same Name" },
      });
      await openEditor(page);
      await openDialog(page);
      // The pictures are drawn as their cards come into view: all of them, then compare.
      for (const template of TEMPLATES) await drawn(page, template.name);
      await dialogOf(page).evaluate((el) => (el.scrollTop = 0));
      const text = await dialogOf(page).innerText();
      expect(text).not.toMatch(/\bPro\b|\bStudio\b|upgrade|\bplans?\b/);
      seen.push(text);
      await page.keyboard.press("Escape");
      await expect(dialogOf(page)).toHaveCount(0);
    }
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });
});

test.describe("M7-07 the preview is the real page, small", () => {
  test("M7-07 every preview is drawn in its template's theme, is inert and hidden from assistive technology, and adds no heading, landmark or tab stop", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the phone run checks the layout; the structure is the same");
    await emptyPageUser(context, "tp7-b");
    await openEditor(page);
    await openDialog(page);
    const headingsOpen = await page.getByRole("heading", { level: 1 }).count();
    const tokens = await templateThemeTokens();

    for (const template of TEMPLATES) {
      const root = await drawn(page, template.name);
      const box = previewOf(page, template.name);
      await expect(box).toHaveAttribute("aria-hidden", "true");
      await expect(box).toHaveAttribute("inert", "");

      // The theme's own values, as `--t-*` on the page root, and no HYDLNK variable inside it.
      const theme = tokens.get(template.theme.id)!;
      const result = await root.evaluate((el) => {
        const own: Record<string, string> = {};
        const style = (el as HTMLElement).style;
        for (let i = 0; i < style.length; i++) {
          const name = style.item(i);
          own[name] = style.getPropertyValue(name).trim();
        }
        const css = getComputedStyle(el);
        const hl = Array.from(el.querySelectorAll<HTMLElement>("*")).some((node) =>
          Array.from({ length: node.style.length }, (_, i) => node.style.item(i)).some((n) =>
            n.startsWith("--hl-"),
          ),
        );
        return {
          own,
          bgColor: css.backgroundColor,
          bgImage: css.backgroundImage,
          bgType: el.getAttribute("data-bg-type"),
          hlInside: hl,
          html: el.outerHTML,
        };
      });
      expect((result.own["--t-bg"] ?? "").toLowerCase()).toBe(String(theme.bg).toLowerCase());
      expect((result.own["--t-accent"] ?? "").toLowerCase()).toBe(
        String(theme.accent).toLowerCase(),
      );
      expect(Object.keys(result.own).some((name) => name.startsWith("--hl-"))).toBe(false);
      expect(result.hlInside).toBe(false);
      expect(result.html).not.toContain("--hl-");
      if (result.bgType === "gradient") {
        // A gradient is drawn as an image; the page color is its end stop.
        expect(result.bgImage).toContain("linear-gradient");
      } else {
        const hex = String(theme.bg);
        const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
        expect(result.bgColor).toBe(rgb);
      }
    }

    // Nothing of a preview is in the accessibility tree: no extra h1, no main or banner or link.
    const dialog = dialogOf(page);
    await expect(dialog.getByRole("heading", { level: 1 })).toHaveCount(0);
    await expect(dialog.getByRole("main")).toHaveCount(0);
    await expect(dialog.getByRole("banner")).toHaveCount(0);
    await expect(dialog.getByRole("link")).toHaveCount(0);
    await expect(dialog.getByRole("navigation")).toHaveCount(0);
    // The page keeps the h1s it has: closing the dialog changes none.
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toHaveCount(0);
    expect(await page.getByRole("heading", { level: 1 }).count()).toBe(headingsOpen);
    await openDialog(page);

    // No tab stop: Tab through the whole dialog twice and never land inside a preview.
    const stops: boolean[] = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(
          () => document.activeElement?.closest("[data-testid=template-preview]") !== null,
        ),
      );
    }
    expect(stops.some(Boolean)).toBe(false);
    // And they never can be clicked: the pointer lands on the card, not on a block.
    const first = await rect(previewOf(page, "Musician"));
    const target = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x!, y!)?.closest("[data-testid=template-preview]") ?? null,
      [first.x + first.width / 2, first.y + first.height / 2],
    );
    expect(target).toBeNull();
  });

  test("M7-07 the preview draws the template's blocks, not the page's: a draft with 50 blocks previews the same", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough");
    const user = await emptyPageUser(context, "tp7-c");
    const row = await pageRow(user.pageId);
    await setDraft(user.pageId, {
      ...row.draft,
      blocks: Array.from({ length: 50 }, (_, i) => ({
        id: `Zq7Divider${String(i).padStart(3, "0")}`,
        type: "divider",
        visible: true,
      })),
    });
    await openEditor(page);
    await openDialog(page);
    for (const template of TEMPLATES) {
      const root = await drawn(page, template.name);
      await expect(root.locator("[data-block-type]")).toHaveCount(template.blocks.length);
      await expect(root.locator("[data-block-type='divider']")).toHaveCount(0);
    }
  });

  test("M7-07 the person's own profile is drawn in every preview: the bio they wrote, or the template's sample bio when theirs is empty", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough");
    await emptyPageUser(context, "tp7-d");
    await openEditor(page);
    await openDialog(page);
    for (const template of TEMPLATES) {
      const root = await drawn(page, template.name);
      await expect(root.locator(".pg-bio")).toHaveText(template.bio);
    }
  });
});

test.describe("M7-07 no cost to the page", () => {
  test("M7-07 opening the dialog sends at most one font stylesheet request and nothing else: no view beacon, no /r/, no iframe, no Supabase or Storage call", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough for the network log");
    await emptyPageUser(context, "tp7-e");
    // The fonts are not under test: answer them locally, the request is still logged.
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await openEditor(page);
    await page.waitForLoadState("networkidle");

    // While the dialog is closed it has asked for nothing.
    await expect(page.locator("[data-template-fonts]")).toHaveCount(0);
    const framesBefore = page.frames().length;
    const log: string[] = [];
    const onRequest = (request: Request) => log.push(request.url());
    page.on("request", onRequest);

    await openDialog(page);
    for (const template of TEMPLATES) await drawn(page, template.name);
    await page.waitForTimeout(1_000);
    page.off("request", onRequest);

    const fonts = log.filter((url) => url.includes("fonts.googleapis.com"));
    expect(fonts.length).toBeLessThanOrEqual(1);
    const link = page.locator("[data-template-fonts]");
    await expect(link).toHaveCount(1);
    const href = (await link.getAttribute("href"))!;
    expect(href).toContain("fonts.googleapis.com/css2");
    if (fonts.length === 1) expect(fonts[0]).toBe(href);

    // The families of all six themes, together.
    const tokens = await templateThemeTokens();
    const wanted = new Set<string>();
    for (const template of TEMPLATES) {
      const theme = tokens.get(template.theme.id)!;
      wanted.add(String(theme.fontHeading));
      wanted.add(String(theme.fontBody));
    }
    const named = new URL(href).searchParams.getAll("family").map((f) => f.split(":")[0]);
    for (const family of wanted) expect(named).toContain(family);

    expect(log.filter((url) => /\/r\/|\/api\/e\b|\/api\/e\?|beacon/.test(url))).toEqual([]);
    expect(log.filter((url) => /\/rest\/v1\/|\/storage\/v1\/|:54321/.test(url))).toEqual([]);
    expect(page.frames().length).toBe(framesBefore);
    await expect(dialogOf(page).locator("iframe")).toHaveCount(0);

    // Closing it takes the stylesheet link away again.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-template-fonts]")).toHaveCount(0);
  });
});

test.describe("M7-07 edge states", () => {
  test("M7-07 a 60 character name, an empty name and a photo of the person's own draw in all six previews without overflowing the card", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the phone run checks the same boxes at 390px");
    const user = await richUser(context, "tp7-f");
    for (const name of ["N".repeat(60), ""]) {
      const row = await pageRow(user.pageId);
      await setDraft(user.pageId, { ...row.draft, profile: { ...row.draft.profile, name } });
      await openEditor(page);
      await openDialog(page);
      for (const template of TEMPLATES) {
        const root = await drawn(page, template.name);
        const card = cardOf(page, template.name);
        const cardBox = await rect(card);
        const previewBox = await rect(previewOf(page, template.name));
        expect(previewBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
        expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
        expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(
          cardBox.y + cardBox.height + 1,
        );
        // The card itself does not grow sideways, and the picture is clipped to its box.
        expect(
          await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          template.name,
        ).toBe(true);
        expect(
          await previewOf(page, template.name).evaluate((el) => getComputedStyle(el).overflow),
        ).toBe("hidden");
        // The photo, when there is one, is the person's own, from our own address.
        if (name === "N".repeat(60)) {
          const src = await root.locator("img.pg-avatar-img").getAttribute("src");
          expect(src).toContain(user.images.photo.path);
          expect(src).toMatch(/^http:\/\/localhost:\d+\/media\//); // the root origin (one CDN cache key per image)
        }
      }
      await expectNoHorizontalScroll(page);
      await page.keyboard.press("Escape");
      await expect(dialogOf(page)).toHaveCount(0);
    }
  });
});

test.describe("M7-07 accessibility", () => {
  test("M7-07 axe finds no serious or critical violation in the open dialog", async ({
    page,
    context,
  }) => {
    await emptyPageUser(context, "tp7-g");
    await openEditor(page);
    await openDialog(page);
    for (const template of TEMPLATES) await drawn(page, template.name);
    expect(await dialogAxe(page)).toEqual([]);
    // With a choice open in a card too.
    await templateButton(page, "Musician").click();
    await expect(page.getByRole("group", { name: "Apply the Musician template" })).toBeVisible();
    expect(await dialogAxe(page)).toEqual([]);
  });
});

test.describe("M7-07 on a phone", () => {
  test("M7-07 the dialog is a sheet, the cards stack in one column with the preview filling the card, nothing scrolls sideways, every target is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone only");
    await emptyPageUser(context, "tp7-h");
    await openEditor(page);
    const viewport = page.viewportSize()!;
    await openDialog(page);
    const dialog = dialogOf(page);
    const sheet = await rect(dialog);
    expect(Math.round(sheet.width)).toBe(viewport.width);
    expect(Math.round(sheet.height)).toBe(viewport.height);
    const xs = await dialog
      .locator("li[data-template-id]")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
    expect(new Set(xs).size).toBe(1);

    for (const template of TEMPLATES) {
      await drawn(page, template.name);
      const card = await rect(cardOf(page, template.name));
      const preview = await rect(previewOf(page, template.name));
      // Filling the card's width (its padding is 14px each side).
      expect(preview.width).toBeGreaterThanOrEqual(card.width - 32);
      expect(preview.height).toBeGreaterThanOrEqual(150);
      expect(preview.height).toBeLessThanOrEqual(230);
      // The page inside is scaled to the box: 390px laid out, drawn at the box's width.
      const scaled = await previewRootOf(page, template.name).evaluate(
        (el) => el.getBoundingClientRect().width,
      );
      expect(Math.abs(scaled - preview.width)).toBeLessThanOrEqual(2);
    }
    await expectNoHorizontalScroll(page);
    await dialog.evaluate((el) => (el.scrollTop = 0));
    await expectTapTargets(page, "dialog");

    // It scrolls inside itself; the page behind does not move.
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 500);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(startButton(page)).toBeFocused();
  });

  test("M7-07 a phone dialog still has accessible cards and the axe pass", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone only");
    await emptyPageUser(context, "tp7-i");
    await openEditor(page);
    await openDialog(page);
    for (const template of TEMPLATES) await drawn(page, template.name);
    expect(await dialogAxe(page)).toEqual([]);
  });
});

test.describe("M7-07 on a desktop", () => {
  test("M7-07 the dialog is centered, at most 720px wide, two columns, previews the same height, nothing cut off", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop only");
    await emptyPageUser(context, "tp7-j");
    await openEditor(page);
    await openDialog(page);
    const dialog = dialogOf(page);
    const viewport = page.viewportSize()!;
    const box = await rect(dialog);
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);

    const points = await dialog.locator("li[data-template-id]").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
      }),
    );
    expect(new Set(points.map((p) => p.x)).size).toBe(2);
    expect(points[0]!.y).toBe(points[1]!.y);
    expect(points[2]!.y).toBeGreaterThan(points[0]!.y);

    const heights = new Set<number>();
    for (const template of TEMPLATES) {
      await drawn(page, template.name);
      heights.add(Math.round((await rect(previewOf(page, template.name))).height));
      const card = cardOf(page, template.name);
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      // Every part of the card is inside it.
      const cardBox = await rect(card);
      for (const part of [
        card.getByRole("heading", { level: 3 }),
        card.getByTestId("template-inside"),
        card.getByTestId("template-style"),
        templateButton(page, template.name),
      ]) {
        const partBox = await rect(part);
        expect(partBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
        expect(partBox.x + partBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
        expect(partBox.y + partBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
      }
    }
    expect(heights.size).toBe(1);
    await expectNoHorizontalScroll(page);
    // M7-07 supersedes nothing about focus: it still starts on the first card.
    await page.keyboard.press("Escape");
    await expect(startButton(page)).toBeFocused();
  });
});

test.describe("M7-07 the themes the previews use", () => {
  test("M7-07 the six templates apply system themes that exist, and the style line names them", async () => {
    const tokens = await templateThemeTokens();
    const ids: Record<string, string> = {
      Midnight: SYSTEM_IDS.Midnight,
      Smoke: SYSTEM_IDS.Smoke,
      Ivory: SYSTEM_IDS.Ivory,
      Paper: SYSTEM_IDS.Paper,
      Sage: SYSTEM_IDS.Sage,
      Ember: SYSTEM_IDS.Ember,
    };
    for (const template of TEMPLATES) {
      expect(template.theme.id).toBe(ids[template.theme.name]);
      expect(tokens.has(template.theme.id), template.theme.name).toBe(true);
    }
  });
});
