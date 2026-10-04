import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { expectNoHorizontalScroll } from "../helpers";
import { css, draftOf, rowOf, showView, userWithDraft } from "../m2/blocks-helpers";
import { accessToken, expectDraft, pageRow } from "../m2/editor-helpers";
import type { Block, DraftDoc } from "@/lib/document";
import { DESIGN_URL, waitForDesignHydrated } from "./design-helpers";
import {
  NOIR,
  liveHtml,
  openEditorPage,
  publishFromEditor,
  setTheme,
  statusChip,
} from "./themes-helpers";

/**
 * M3-17 and M3-18, the per-block override controls in the editor: Button style, Color and Corner
 * radius on link blocks and cards, nothing else. Each test makes its own page (Noir, outline
 * buttons, radius 12). The abuse cases write hostile overrides with the publishable key and the
 * user's own JWT, then click Publish. The same rules are proven below the UI in
 * tests/unit/themes-lib.test.ts, themes-overrides-form.test.ts and themes-publish.test.ts.
 *
 * The block row's chip, "Theme default (Outline)" and the Publish alert's Dismiss live in editor
 * files the themes area does not own: the tests for them skip until the integration step wires
 * them in.
 */

test.afterAll(cleanupUsers);

const A = "Zq1LinkAlpha1";
const B = "Zq1LinkBravo2";
const C = "Zq1CardCharlie";
const H = "Zq1HeadDelta11";

const blocks = (): Block[] => [
  {
    id: A,
    type: "link",
    visible: true,
    label: "Studio rental by the hour",
    url: "https://maraokafor.example/studio",
  },
  {
    id: B,
    type: "link",
    visible: true,
    label: "Prints and archive",
    url: "https://maraokafor.example/prints",
  },
  {
    id: C,
    type: "card",
    visible: true,
    title: "Night Market",
    caption: "View the gallery",
    url: "https://maraokafor.example/market",
    image: null,
  },
  { id: H, type: "header", visible: true, text: "Book a session" },
];

async function setup(context: BrowserContext, label: string) {
  return userWithDraft(
    context,
    label,
    (handle) => draftOf(handle, blocks(), { theme: { ref: NOIR, overrides: {} } }),
    { plan: "pro" },
  );
}

const panelOf = (page: Page, id: string): Locator =>
  rowOf(page, id).locator('[id^="block-panel-"]');

async function expand(page: Page, id: string): Promise<Locator> {
  const collapsed = rowOf(page, id).locator('button[aria-expanded="false"]');
  if ((await collapsed.count()) > 0) await collapsed.first().click();
  const panel = panelOf(page, id);
  await expect(panel).toBeVisible();
  return panel;
}

const styleSelect = (panel: Locator) => panel.locator('select[data-field="override-button-style"]');
const radiusSelect = (panel: Locator) => panel.locator('select[data-field="override-radius"]');
const colorField = (panel: Locator) => panel.locator('input[data-field="override-color"]');

/** The preview's rendering of a block (a phone shows the preview as its own tab). */
async function previewOf(page: Page, id: string): Promise<Locator> {
  await showView(page, "Preview");
  return page.getByTestId("preview-screen").locator(`[data-block-id="${id}"]`);
}

async function overridesOf(pageId: string, id: string): Promise<unknown> {
  const draft = (await pageRow(pageId)).draft as DraftDoc;
  const block = draft.blocks.find((b) => b.id === id);
  return block && "overrides" in block ? block.overrides : undefined;
}

async function expectOverrides(pageId: string, id: string, expected: unknown): Promise<void> {
  // jsonb does not keep key order, so the comparison is a deep equality, not a string compare.
  await expect
    .poll(async () => (await overridesOf(pageId, id)) ?? null, {
      message: `the stored overrides of ${id}`,
      timeout: 15_000,
    })
    .toEqual(expected);
}

const chipOf = (page: Page, id: string): Locator => rowOf(page, id).getByTestId("override-chip");

test.describe("M3-17 per-block override: button style", () => {
  test("M3-17 a link block offers a 16px Button style select with Theme default, Fill, Outline, Soft, Shadow and Pill; no Schedule; links only", async ({
    page,
    context,
  }, info) => {
    await setup(context, "o17a");
    await openEditorPage(page);
    const panel = await expand(page, A);

    const select = styleSelect(panel);
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options).toHaveLength(6);
    expect(options[0]).toMatch(/^Theme default( \(Outline\))?$/);
    expect(options.slice(1)).toEqual(["Fill", "Outline", "Soft", "Shadow", "Pill"]);
    expect(await css(select, "font-size")).toBe("16px");
    await expect(panel.getByText("Button style", { exact: true })).toBeVisible();
    await expect(panel.getByText(/schedule/i)).toHaveCount(0);

    if (info.project.name === "phone") {
      expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalScroll(page);
    }

    // A card has Color and Corner radius but no Button style. A header used to have no override
    // controls; since M6-46 it has its own style group with one control, Text color, and still no
    // Button style (only a link has one).
    const card = await expand(page, C);
    await expect(styleSelect(card)).toHaveCount(0);
    await expect(radiusSelect(card)).toBeVisible();
    await expect(colorField(card)).toBeVisible();
    const header = await expand(page, H);
    await expect(header.getByTestId("override-controls")).toHaveCount(1);
    await expect(header.getByTestId("override-controls").locator("label")).toHaveText([
      "Text color",
    ]);
    await expect(styleSelect(header)).toHaveCount(0);
    await expect(radiusSelect(header)).toHaveCount(0);
  });

  test("M3-17 'Theme default' names the page's current theme style", async ({ page, context }) => {
    const user = await setup(context, "o17b");
    await setTheme(user.pageId, "00000000-0000-4000-8000-000000000003", {}); // Smoke: Pill
    await openEditorPage(page);
    const first = (await styleSelect(await expand(page, A))
      .locator("option")
      .first()
      .textContent())!;
    // The editor provides the page's tokens to the block forms (PageTokensProvider).
    expect(first).toBe("Theme default (Pill)");
  });

  test("M3-17 Fill on one block changes only that block; Theme default undoes it; it autosaves, survives a reload and reaches the live page after Publish", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "o17c");
    await openEditorPage(page);
    await publishFromEditor(page);
    const liveBefore = await liveHtml(user.handle);

    const panel = await expand(page, A);
    await styleSelect(panel).selectOption("fill");
    await expectOverrides(user.pageId, A, { buttonStyle: "fill" });

    let a = await previewOf(page, A);
    const b = await previewOf(page, B);
    await expect(a).toHaveAttribute("data-button-style", "fill");
    await expect(b).toHaveAttribute("data-button-style", "outline");
    expect(await css(a, "background-color")).not.toBe("rgba(0, 0, 0, 0)");
    expect(await css(b, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await showView(page, "Blocks");

    await expect(chipOf(page, B)).toHaveCount(0);

    // Not live until Publish.
    expect(await liveHtml(user.handle)).toBe(liveBefore);

    // A reload shows the override again.
    await openEditorPage(page);
    await expect(styleSelect(await expand(page, A))).toHaveValue("fill");

    await publishFromEditor(page);
    const live = await liveHtml(user.handle);
    expect(live).toMatch(new RegExp(`data-block-id="${A}"[^>]*data-button-style="fill"`));
    expect(live).toMatch(new RegExp(`data-block-id="${B}"[^>]*data-button-style="outline"`));

    // Theme default removes the override (and the key, and the chip).
    await openEditorPage(page);
    await styleSelect(await expand(page, A)).selectOption("");
    await expectOverrides(user.pageId, A, null);
    a = await previewOf(page, A);
    await expect(a).toHaveAttribute("data-button-style", "outline");
    await showView(page, "Blocks");
    await expect(chipOf(page, A)).toHaveCount(0);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
  });

  test("M3-17 the block row shows a 'Fill override' chip (mono 11px, #F6EEDF on #6B5226), hidden on a phone; Theme default removes it", async ({
    page,
    context,
  }, info) => {
    await setup(context, "o17e");
    await openEditorPage(page);
    const panel = await expand(page, A);
    await styleSelect(panel).selectOption("fill");
    const chip = chipOf(page, A);
    await expect(chip).toHaveCount(1);
    if (info.project.name === "desktop") {
      await expect(chip).toHaveText("Fill override");
      expect(await css(chip, "font-size")).toBe("11px");
      expect(await css(chip, "background-color")).toBe("rgb(246, 238, 223)");
      expect(await css(chip, "color")).toBe("rgb(107, 82, 38)");
    } else {
      await expect(chip).toBeHidden();
    }
    await expect(chipOf(page, B)).toHaveCount(0);
    await styleSelect(panel).selectOption("");
    await expect(chipOf(page, A)).toHaveCount(0);
  });

  test("M3-18 the chip counts the overrides: one reads by name, two read '2 overrides'", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "desktop", "the chip is hidden on a phone");
    await setup(context, "o18h");
    await openEditorPage(page);
    const panel = await expand(page, A);
    await radiusSelect(panel).selectOption("0");
    const chip = chipOf(page, A);
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText("Radius override");
    await colorField(panel).fill("#C46A4F");
    await expect(chip).toHaveText("2 overrides");
    await styleSelect(panel).selectOption("fill");
    await expect(chip).toHaveText("3 overrides");
  });

  test("M3-17 changing the page's button style in Design leaves the block's override in place", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "o17d");
    await openEditorPage(page);
    await styleSelect(await expand(page, A)).selectOption("fill");
    await expectOverrides(user.pageId, A, { buttonStyle: "fill" });

    await page.goto(DESIGN_URL);
    await waitForDesignHydrated(page);
    await page
      .getByRole("group", { name: "Button style" })
      .getByRole("button", { name: "Soft" })
      .click();
    await expect
      .poll(
        async () => ((await pageRow(user.pageId)).draft as DraftDoc).theme.overrides.buttonStyle,
      )
      .toBe("soft");
    await expectOverrides(user.pageId, A, { buttonStyle: "fill" });

    await openEditorPage(page);
    await expect(styleSelect(await expand(page, A))).toHaveValue("fill");
    const a = await previewOf(page, A);
    const b = await previewOf(page, B);
    await expect(a).toHaveAttribute("data-button-style", "fill");
    await expect(b).toHaveAttribute("data-button-style", "soft");
  });
});

test.describe("M3-18 per-block overrides: color and corner radius", () => {
  test("M3-18 link and card blocks offer exactly the override controls, 44px tall on a phone", async ({
    page,
    context,
  }, info) => {
    await setup(context, "o18a");
    await openEditorPage(page);

    const link = await expand(page, A);
    const linkControls = link.getByTestId("override-controls");
    await expect(linkControls.getByText("Button style", { exact: true })).toBeVisible();
    await expect(linkControls.getByText("Color", { exact: true })).toBeVisible();
    await expect(linkControls.getByText("Corner radius", { exact: true })).toBeVisible();
    // Three controls, and none for a font, spacing or a background.
    await expect(linkControls.locator("label")).toHaveCount(3);
    await expect(linkControls.getByText(/font|spacing|background|gap/i)).toHaveCount(0);

    // The swatch is a button since M9-07 (it opens the color picker); the hex field is the input.
    const swatch = link.locator('button[data-field="override-color-swatch"]');
    await expect(swatch).toBeVisible();
    const hex = colorField(link);
    expect(await css(hex, "font-size")).toBe("16px");
    const radius = radiusSelect(link);
    expect(await radius.locator("option").allTextContents()).toEqual([
      "Theme default",
      "0",
      "4",
      "12",
      "20",
    ]);

    // Only one block is open at a time, so the link's controls are measured before the card opens.
    if (info.project.name === "phone") {
      for (const control of [hex, radius, swatch]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await expectNoHorizontalScroll(page);

    const card = await expand(page, C);
    await expect(card.getByTestId("override-controls").locator("label")).toHaveCount(2);
    if (info.project.name === "phone") {
      for (const control of [colorField(card), radiusSelect(card)]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await expectNoHorizontalScroll(page);
  });

  test("M3-18 Color on a Fill link sets its background and border with an auto-contrast ink; siblings keep the theme accent", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "o18b");
    await openEditorPage(page);
    const panel = await expand(page, A);
    await styleSelect(panel).selectOption("fill");
    await colorField(panel).fill("#C46A4F");
    await expectOverrides(user.pageId, A, {
      buttonStyle: "fill",
      buttonBg: "#C46A4F",
      accent: "#C46A4F",
      buttonText: "#F7F3EC",
    });

    const a = await previewOf(page, A);
    const b = await previewOf(page, B);
    expect(await css(a, "background-color")).toBe("rgb(196, 106, 79)");
    expect(await css(a, "border-top-color")).toBe("rgb(196, 106, 79)");
    expect(await css(a, "color")).toBe("rgb(247, 243, 236)");
    // The sibling is still outline in the theme's accent (Noir brass #C9A86A), not terracotta.
    expect(await css(b, "border-top-color")).toBe("rgb(201, 168, 106)");
    await showView(page, "Blocks");

    // A light colour gets the dark ink (perceived brightness above 0.55).
    await colorField(panel).fill("#F0D9A8");
    await expectOverrides(user.pageId, A, {
      buttonStyle: "fill",
      buttonBg: "#F0D9A8",
      accent: "#F0D9A8",
      buttonText: "#15110B",
    });
    expect(await css(await previewOf(page, A), "color")).toBe("rgb(21, 17, 11)");
    await showView(page, "Blocks");

    // Theme default clears the colour and nothing else.
    await panel.getByRole("button", { name: "Theme default" }).click();
    await expectOverrides(user.pageId, A, { buttonStyle: "fill" });
  });

  test("M3-18 Corner radius 0 changes only that block; chips count the overrides; Theme default removes it", async ({
    page,
    context,
  }) => {
    const user = await setup(context, "o18c");
    await openEditorPage(page);
    const panel = await expand(page, A);

    await radiusSelect(panel).selectOption("0");
    await expectOverrides(user.pageId, A, { radius: 0 });
    let a = await previewOf(page, A);
    let b = await previewOf(page, B);
    expect(await css(a, "border-top-left-radius")).toBe("0px");
    expect(await css(b, "border-top-left-radius")).toBe("12px");
    await showView(page, "Blocks");

    // The card: radius 20.
    const card = await expand(page, C);
    await radiusSelect(card).selectOption("20");
    await expectOverrides(user.pageId, C, { radius: 20 });
    expect(await css(await previewOf(page, C), "border-top-left-radius")).toBe("20px");
    await showView(page, "Blocks");

    await radiusSelect(card).selectOption("");
    await expand(page, A); // one block is open at a time
    await radiusSelect(panel).selectOption("");
    await expect.poll(async () => (await overridesOf(user.pageId, C)) === undefined).toBe(true);
    a = await previewOf(page, A);
    b = await previewOf(page, B);
    expect(await css(a, "border-top-left-radius")).toBe(await css(b, "border-top-left-radius"));
  });

  test("M3-18 colour and radius autosave, survive a reload, and reach the live page only after Publish", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "desktop", "data flow: one viewport");
    const user = await setup(context, "o18d");
    await openEditorPage(page);
    await publishFromEditor(page);
    const liveBefore = await liveHtml(user.handle);

    const panel = await expand(page, A);
    await colorField(panel).fill("#C46A4F");
    await radiusSelect(panel).selectOption("20");
    await expectOverrides(user.pageId, A, {
      buttonBg: "#C46A4F",
      accent: "#C46A4F",
      buttonText: "#F7F3EC",
      radius: 20,
    });

    await openEditorPage(page);
    const again = await expand(page, A);
    await expect(colorField(again)).toHaveValue("#C46A4F");
    await expect(radiusSelect(again)).toHaveValue("20");
    expect(await liveHtml(user.handle)).toBe(liveBefore);

    await publishFromEditor(page);
    const live = await liveHtml(user.handle);
    expect(live).toMatch(new RegExp(`data-block-id="${A}"[^>]*style="[^"]*--t-radius:20px`));
    expect(live).toMatch(new RegExp(`data-block-id="${A}"[^>]*style="[^"]*--t-button-bg:#C46A4F`));
    expect(live).not.toMatch(new RegExp(`data-block-id="${B}"[^>]*style="[^"]*--t-radius`));
  });
});

test.describe("M3-18 direct-API abuse: block overrides", () => {
  const publishButton = (page: Page) =>
    page.getByTestId("workspace-toolbar").getByRole("button", { name: "Publish", exact: true });

  async function patchBlockOverrides(
    context: BrowserContext,
    pageId: string,
    overrides: Record<string, unknown>,
  ) {
    const row = await pageRow(pageId);
    const draft = JSON.parse(JSON.stringify(row.draft)) as DraftDoc;
    draft.blocks = draft.blocks.map((block) =>
      block.id === A ? ({ ...block, overrides } as Block) : block,
    );
    const result = await restAs(await accessToken(context), `/pages?id=eq.${pageId}`, {
      method: "PATCH",
      body: { draft },
    });
    expect(result.status).toBeLessThan(300);
    expect(Array.isArray(result.body) && result.body.length === 1).toBe(true);
  }

  test("M3-18 Publish keeps only the allowed override keys: a font and a background are dropped, the colour stays, the live block is unchanged", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "security flow: one viewport");
    const user = await setup(context, "o18e");
    // 'accent' is the Color control's key (the document has no key called 'color').
    await patchBlockOverrides(context, user.pageId, {
      fontHeading: "Geist",
      bg: "#000000",
      accent: "#C46A4F",
    });
    await openEditorPage(page);
    await publishButton(page).click();
    await expect(page.getByText("Published.", { exact: true })).toBeVisible({ timeout: 20_000 });

    const published = (await pageRow(user.pageId)).published as { blocks: Block[] };
    const stored = published.blocks.find((block) => block.id === A) as { overrides?: unknown };
    expect(stored.overrides).toEqual({ accent: "#C46A4F" });

    const live = await liveHtml(user.handle);
    expect(live).not.toMatch(/--t-font-heading:Geist/);
    expect(live).not.toContain("--t-bg:#000000");
    const a = live.match(new RegExp(`<a[^>]*data-block-id="${A}"[^>]*>`))![0];
    expect(a).toContain("--t-accent:#C46A4F");
    expect(a).not.toMatch(/--t-bg|--t-font/);
  });

  for (const [name, overrides] of [
    ["a radius of -5", { radius: -5 }],
    ["a colour of 'red'", { accent: "red" }],
  ] as const) {
    test(`M3-18 ${name} makes Publish fail and leaves pages.published unchanged`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "security flow: one viewport");
      const user = await setup(context, "o18f");
      await openEditorPage(page);
      await publishFromEditor(page);
      const before = await pageRow(user.pageId);
      const liveBefore = await liveHtml(user.handle);

      await patchBlockOverrides(context, user.pageId, overrides);
      await openEditorPage(page);
      await publishButton(page).click();
      await expect(page.getByRole("alert").filter({ hasText: /before publishing/ })).toBeVisible();

      const after = await pageRow(user.pageId);
      expect(after.published).toEqual(before.published);
      expect(after.published_at).toBe(before.published_at);
      expect(await liveHtml(user.handle)).toBe(liveBefore);
    });
  }

  test("M3-18 the editor's expanded link panel shows no override control beyond Button style, Color and Corner radius", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "covered at both widths above");
    const user = await setup(context, "o18g");
    await openEditorPage(page);
    const panel = await expand(page, A);
    await expectDraft(user.pageId, (draft) => draft.blocks.length === 4);
    // M9-30 adds "Lock this link" under the link's own fields; the override section is unchanged.
    const names = await panel.getByTestId("override-controls").locator("label").allTextContents();
    expect(names.map((text) => text.trim())).toEqual(["Button style", "Color", "Corner radius"]);
    const all = await panel.locator("label").allTextContents();
    expect(all.map((text) => text.trim()).slice(0, 2)).toEqual(["Label", "Link"]);
  });
});
