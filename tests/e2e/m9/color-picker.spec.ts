import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { rowOf } from "../m2/blocks-helpers";
import {
  emptyUser,
  openEditor,
  pageRow,
  seededUser,
  setDraft,
  statusChip,
} from "../m2/editor-helpers";
import { liveHtml, publishFromEditor } from "../m3/design-helpers";
import {
  expectOverrides,
  openDesign,
  previewVar,
  reloadDesign,
  saveStatus,
} from "../m6/design-helpers";

/**
 * M9-07: react-colorful replaces the native color inputs of the Design colors and of a block's
 * Color override. These specs cover what is new: the swatch that opens an inline panel, the drag
 * that writes the draft as it moves and is one undo step, the keys, touch, the sizes, nothing
 * leaving the browser, and persistence. The hex field's rules (`#12`, hostile strings) are in
 * M3-08, M6-42 and M6-46, which now type into the hex field. Each test makes its own user.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const swatchOf = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: `${name} color`, exact: true });
const hexOf = (page: Page, name: string): Locator =>
  page.getByLabel(`${name} hex`, { exact: true });
const rowOfColor = (page: Page, key: string): Locator => page.locator(`[data-color-row="${key}"]`);
const undoButton = (page: Page): Locator => page.locator("[data-history-button='undo']");
const redoButton = (page: Page): Locator => page.locator("[data-history-button='redo']");

/** The panel a swatch opened, found by the swatch's aria-controls. */
async function panelOf(page: Page, name: string): Promise<Locator> {
  const id = await swatchOf(page, name).getAttribute("aria-controls");
  expect(id, `${name} swatch controls a panel`).toBeTruthy();
  return page.locator(`#${id}`);
}

async function openPanel(page: Page, name: string): Promise<Locator> {
  await swatchOf(page, name).click();
  await expect(swatchOf(page, name)).toHaveAttribute("aria-expanded", "true");
  const panel = await panelOf(page, name);
  await expect(panel).toBeVisible();
  // The library has laid the picker out.
  await expect(panel.locator(".react-colorful__saturation")).toBeVisible();
  // The whole panel is in view, so a drag (raw mouse or touch coordinates) lands on it.
  await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
  return panel;
}

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
};

/** A drag with the mouse inside `target`, from (fx0, fy0) to (fx1, fy1) as fractions of its box. */
async function drag(
  page: Page,
  target: Locator,
  [fx0, fy0]: [number, number],
  [fx1, fy1]: [number, number],
) {
  // In view, whatever the page did since the panel opened (an Undo on a phone moves the sticky bars).
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const b = await box(target);
  await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * fx1, b.y + b.height * fy1, { steps: 14 });
  await page.mouse.up();
}

test.describe("M9-07 the swatch and its panel", () => {
  test("M9-07 every color row's swatch is a 44px button named '<name> color' that opens an inline panel under the row; Escape and Done close it and return focus; another row's swatch closes it", async ({
    page,
    context,
  }) => {
    await seededUser(context, "cp1");
    await openDesign(page);
    expect(await page.locator('input[type="color"]').count()).toBe(0);

    for (const [key, name] of [
      ["bg", "Page background"],
      ["surface", "Cards and panels"],
      ["text", "Text"],
      ["textMuted", "Secondary text"],
      ["accent", "Accent"],
      ["buttonBg", "Button color"],
      ["buttonText", "Button text"],
      ["border", "Lines and borders"],
    ] as const) {
      const swatch = rowOfColor(page, key).getByRole("button", { name: /color$/ });
      await expect(swatch, key).toHaveCount(1);
      expect(name).toBeTruthy();
      const b = await box(swatch);
      expect([Math.round(b.width), Math.round(b.height)], key).toEqual([44, 44]);
      await expect(swatch).toHaveAttribute("aria-expanded", "false");
      expect(await swatch.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
    }

    const accent = swatchOf(page, "Accent");
    await accent.click();
    await expect(accent).toHaveAttribute("aria-expanded", "true");
    const panel = await panelOf(page, "Accent");
    // Inline in the row, directly under it: not a dialog, not a popover.
    expect(await panel.evaluate((el, row) => !!el.closest(row), '[data-color-row="accent"]')).toBe(
      true,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const fieldBox = await box(hexOf(page, "Accent"));
    expect((await box(panel)).y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1);
    await expect(panel.getByRole("slider")).toHaveCount(2);
    await expect(panel.getByRole("slider", { name: "Color" })).toHaveAttribute(
      "aria-valuetext",
      /^Saturation \d+%, Brightness \d+%$/,
    );
    await expect(panel.getByRole("slider", { name: "Hue" })).toHaveAttribute(
      "aria-valuetext",
      /^\d+ degrees$/,
    );

    // Escape: closed, focus on the swatch. Done: the same.
    await panel.getByRole("slider", { name: "Hue" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(accent).toBeFocused();
    await expect(accent).toHaveAttribute("aria-expanded", "false");
    await accent.click();
    await (
      await panelOf(page, "Accent")
    )
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await expect(accent).toBeFocused();
    await expect(page.locator(".react-colorful")).toHaveCount(0);

    // Another row's swatch closes this one.
    await accent.click();
    await expect(page.locator(".react-colorful")).toHaveCount(1);
    await swatchOf(page, "Page background").click();
    await expect(accent).toHaveAttribute("aria-expanded", "false");
    await expect(swatchOf(page, "Page background")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".react-colorful")).toHaveCount(1);
    // The 16px hex field and the open row's ring stay.
    expect(
      await hexOf(page, "Page background").evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("16px");
    expect(
      await swatchOf(page, "Page background").evaluate((el) => getComputedStyle(el).boxShadow),
    ).not.toBe("none");
  });

  test("M9-07 the square is at least 160px tall, the hue strip, its thumb and Done at least 44px, and the panel is as wide as the row; axe finds nothing serious with it open", async ({
    page,
    context,
  }) => {
    await seededUser(context, "cp2");
    await openDesign(page);
    const panel = await openPanel(page, "Accent");
    const square = await box(panel.getByRole("slider", { name: "Color" }));
    const hue = await box(panel.getByRole("slider", { name: "Hue" }));
    const thumb = await box(panel.locator(".react-colorful__hue-pointer"));
    const done = await box(panel.getByRole("button", { name: "Done", exact: true }));
    expect(square.height).toBeGreaterThanOrEqual(160);
    expect(hue.height).toBeGreaterThanOrEqual(44);
    expect(thumb.height).toBeGreaterThanOrEqual(44);
    expect(done.height).toBeGreaterThanOrEqual(44);
    const row = await box(rowOfColor(page, "accent"));
    const p = await box(panel);
    expect(p.x).toBeGreaterThanOrEqual(row.x - 0.5);
    expect(p.x + p.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
    expect(p.width).toBeGreaterThanOrEqual(row.width - 40);
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The library's focus outline is given back as the brass ring (reached by keyboard: focus-visible).
    await hexOf(page, "Accent").focus();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("slider", { name: "Color" })).toBeFocused();
    expect(
      await panel
        .getByRole("slider", { name: "Color" })
        .evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
    expect(await axeViolations(page)).toEqual([]);
    // The touch targets of the row (swatch, hex field, Done) are all at least 44px.
    for (const target of [swatchOf(page, "Accent"), hexOf(page, "Accent")]) {
      expect((await box(target)).height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("M9-07 picking", () => {
  test("M9-07 dragging in the square and on the hue strip writes the draft as it moves, the status reads Saved, and one drag is one undo step", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "cp3");
    await openDesign(page);
    const before = ((await pageRow(user.pageId)).draft.theme.overrides ?? {}) as Record<
      string,
      unknown
    >;
    const start = await hexOf(page, "Page background").inputValue();
    const panel = await openPanel(page, "Page background");

    await drag(page, panel.locator(".react-colorful__saturation"), [0.25, 0.3], [0.8, 0.75]);
    const dragged = await hexOf(page, "Page background").inputValue();
    expect(dragged).toMatch(/^#[0-9A-F]{6}$/);
    expect(dragged).not.toBe(start);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3_000 });
    await expectOverrides(user.pageId, (o) => o.bg === dragged);
    // The preview follows.
    await expect.poll(() => previewVar(page, "--t-bg")).toBe(dragged);

    // One drag, one step: a single Undo restores the color from before the drag, a single Redo the dragged one.
    await undoButton(page).click();
    await expect(hexOf(page, "Page background")).toHaveValue(start);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expectOverrides(user.pageId, (o) => (o.bg ?? null) === (before.bg ?? null));
    await redoButton(page).click();
    await expect(hexOf(page, "Page background")).toHaveValue(dragged);
    await expectOverrides(user.pageId, (o) => o.bg === dragged);

    // The hue strip drags the same way, and is one more step.
    await drag(
      page,
      (await panelOf(page, "Page background")).locator(".react-colorful__hue"),
      [0.2, 0.5],
      [0.9, 0.5],
    );
    const hued = await hexOf(page, "Page background").inputValue();
    expect(hued).not.toBe(dragged);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3_000 });
    await undoButton(page).click();
    await expect(hexOf(page, "Page background")).toHaveValue(dragged);
  });

  test("M9-07 one drag of the Accent is one undo step even though it moves the button colors too", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "cp4");
    await openDesign(page);
    const before = JSON.stringify((await pageRow(user.pageId)).draft.theme.overrides ?? {});
    const panel = await openPanel(page, "Accent");
    await drag(page, panel.locator(".react-colorful__saturation"), [0.2, 0.2], [0.85, 0.6]);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3_000 });
    const after = JSON.stringify((await pageRow(user.pageId)).draft.theme.overrides ?? {});
    expect(after).not.toBe(before);
    await undoButton(page).click();
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expect
      .poll(async () => JSON.stringify((await pageRow(user.pageId)).draft.theme.overrides ?? {}))
      .toBe(before);
    // The one Undo was all there was.
    await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
  });

  test("M9-07 the arrow keys move the square and the strip one step each and trigger nothing else", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "cp5");
    await openDesign(page);
    const panel = await openPanel(page, "Text");
    const field = hexOf(page, "Text");
    const start = await field.inputValue();
    const square = panel.getByRole("slider", { name: "Color" });
    const valueBefore = await square.getAttribute("aria-valuetext");
    await square.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(field).not.toHaveValue(start);
    const one = await field.inputValue();
    expect(one).toMatch(/^#[0-9A-F]{6}$/);
    expect(await square.getAttribute("aria-valuetext")).not.toBe(valueBefore);
    await page.keyboard.press("ArrowDown");
    await expect(field).not.toHaveValue(one);
    const hue = panel.getByRole("slider", { name: "Hue" });
    const hueBefore = await hue.getAttribute("aria-valuenow");
    await hue.focus();
    await page.keyboard.press("ArrowRight");
    await expect(hue).not.toHaveAttribute("aria-valuenow", hueBefore!);
    // Keys on the pickers undo and redo nothing: Redo is still unavailable, and the panel is still open.
    await expect(redoButton(page)).toHaveAttribute("aria-disabled", "true");
    await expect(swatchOf(page, "Text")).toHaveAttribute("aria-expanded", "true");
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 5_000 });
    await expectOverrides(
      user.pageId,
      (o) => typeof o.text === "string" && /^#[0-9A-F]{6}$/.test(o.text),
    );
  });

  test("M9-07 a finger drag on the square works and does not scroll the page; only the two areas take touch away from the page", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "touch is the phone's input");
    await seededUser(context, "cp6");
    await openDesign(page);
    const panel = await openPanel(page, "Accent");
    // touch-action: none on the two areas only.
    for (const name of ["Color", "Hue"]) {
      expect(
        await panel
          .getByRole("slider", { name })
          .evaluate((el) => getComputedStyle(el).touchAction),
        name,
      ).toBe("none");
    }
    expect(await panel.evaluate((el) => getComputedStyle(el).touchAction)).not.toBe("none");
    expect(
      await panel
        .getByRole("button", { name: "Done", exact: true })
        .evaluate((el) => getComputedStyle(el).touchAction),
    ).not.toBe("none");

    await panel.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const field = hexOf(page, "Accent");
    const start = await field.inputValue();
    const sq = await box(panel.locator(".react-colorful__saturation"));
    const client: CDPSession = await page.context().newCDPSession(page);
    const at = (fx: number, fy: number) => [
      { x: sq.x + sq.width * fx, y: sq.y + sq.height * fy, id: 0 },
    ];
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(0.3, 0.3),
    });
    for (const [fx, fy] of [
      [0.4, 0.4],
      [0.5, 0.55],
      [0.6, 0.7],
      [0.7, 0.85],
    ] as const) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(fx, fy) });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(field).not.toHaveValue(start);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3_000 });
  });

  test("M9-07 the picker sends nothing, keeps nothing in the browser and raises no policy violation", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "cp7");
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        (window as unknown as { __csp: string[] }).__csp.push(
          `${event.violatedDirective} ${event.blockedURI}`,
        ),
      );
    });
    await openDesign(page);
    await page.waitForLoadState("networkidle");
    const storage = () =>
      page.evaluate(() => ({
        local: Object.keys(localStorage).sort(),
        session: Object.keys(sessionStorage).sort(),
      }));
    const storageBefore = await storage();
    const requests: string[] = [];
    page.on("request", (request) => {
      const u = new URL(request.url());
      if (!/^(data|blob):$/.test(u.protocol) && !/\/_next\/|__nextjs/.test(u.pathname)) {
        requests.push(`${request.method()} ${u.origin}${u.pathname}`);
      }
    });
    const panel = await openPanel(page, "Accent");
    await drag(page, panel.locator(".react-colorful__saturation"), [0.2, 0.2], [0.7, 0.7]);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3_000 });
    // Only the autosave of the draft (a PATCH of the page row) went out; nothing to any other host.
    const foreign = requests.filter(
      (entry) => !/^PATCH [^ ]+\/rest\/v1\/pages$/.test(entry) && !/app\.localhost/.test(entry),
    );
    expect(foreign).toEqual([]);
    expect(await storage()).toEqual(storageBefore);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    expect(user.pageId).toBeTruthy();
  });
});

test.describe("M9-07 persistence", () => {
  test("M9-07 a picked color survives a reload, flips the status to Unpublished changes and reaches the live page only after Publish", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "cp8");
    await openDesign(page);
    const liveBefore = await liveHtml(user.handle);
    const panel = await openPanel(page, "Cards and panels");
    await drag(page, panel.locator(".react-colorful__saturation"), [0.3, 0.3], [0.75, 0.8]);
    const picked = await hexOf(page, "Cards and panels").inputValue();
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3_000 });
    await expectOverrides(user.pageId, (o) => o.surface === picked);
    expect(await liveHtml(user.handle)).toBe(liveBefore);

    await reloadDesign(page);
    await expect(hexOf(page, "Cards and panels")).toHaveValue(picked);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    await publishFromEditor(page);
    await expect
      .poll(async () => (await liveHtml(user.handle)).includes(`--t-surface:${picked}`))
      .toBe(true);
  });

  test("M9-07 a stored #RGB or #RRGGBBAA opens the picker on its six-digit equivalent and the draft is not rewritten until a color is picked", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "cp9");
    const row = await pageRow(user.pageId);
    await setDraft(user.pageId, {
      ...row.draft,
      theme: {
        ...row.draft.theme,
        overrides: { ...row.draft.theme.overrides, surface: "#FA0", border: "#336699CC" },
      },
    });
    await openDesign(page);
    const before = JSON.stringify((await pageRow(user.pageId)).draft.theme.overrides);
    for (const [name, six] of [
      ["Cards and panels", "rgb(255, 170, 0)"],
      ["Lines and borders", "rgb(51, 102, 153)"],
    ] as const) {
      await swatchOf(page, name).click();
      await expect(page.locator(".react-colorful")).toHaveCount(1);
      expect(
        await swatchOf(page, name).evaluate((el) => getComputedStyle(el).backgroundColor),
        name,
      ).toBe(six);
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(1_200);
    expect(JSON.stringify((await pageRow(user.pageId)).draft.theme.overrides)).toBe(before);
    // The field still shows what is stored.
    await expect(hexOf(page, "Cards and panels")).toHaveValue("#FA0");
  });
});

test.describe("M9-07 a block's color override", () => {
  test("M9-07 a block's Color control opens the same picker; a pick is written as #RRGGBB to that block only and Done returns focus to the swatch", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "cp10");
    const row = await pageRow(user.pageId);
    const id = "pickerheader001";
    await setDraft(user.pageId, {
      ...row.draft,
      blocks: [
        { id, type: "header", visible: true, text: "Hello" },
        { id: "pickerheader002", type: "header", visible: true, text: "Other" },
      ],
    });
    await openEditor(page);
    const toggle = rowOf(page, id).locator("button[aria-expanded]").first();
    await toggle.click();
    const section = rowOf(page, id).getByRole("region", { name: "Style this block" });
    await expect(section).toBeVisible();
    const swatch = section.locator('button[data-field="override-color-swatch"]');
    expect(await section.locator('input[type="color"]').count()).toBe(0);
    await expect(swatch).toHaveAttribute("aria-expanded", "false");
    expect(Math.round((await box(swatch)).height)).toBe(44);
    await swatch.click();
    await expect(swatch).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`#${await swatch.getAttribute("aria-controls")}`);
    await expect(panel).toBeVisible();
    await panel.getByRole("slider", { name: "Color" }).focus();
    await page.keyboard.press("ArrowRight");
    const typed = section.locator('input[data-field="override-color"]');
    await expect(typed).toHaveValue(/^#[0-9A-F]{6}$/);
    const picked = await typed.inputValue();
    await expect
      .poll(async () => {
        const blocks = (await pageRow(user.pageId)).draft.blocks as unknown as Array<{
          id: string;
          overrides?: { text?: string };
        }>;
        return [blocks[0]!.overrides?.text, blocks[1]!.overrides?.text];
      })
      .toEqual([picked, undefined]);
    await panel.getByRole("button", { name: "Done", exact: true }).click();
    await expect(swatch).toBeFocused();
    await expect(page.locator(".react-colorful")).toHaveCount(0);
  });
});

test.describe("M9-07 layout", () => {
  test("M9-07 at 390x844 the open panel is the row's width, nothing scrolls sideways and every swatch, hex field, Theme default and Done is at least 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "cp11");
    await openDesign(page);
    const panel = await openPanel(page, "Accent");
    const row = await box(rowOfColor(page, "accent"));
    const p = await box(panel);
    expect(row.width).toBeLessThanOrEqual(358.5);
    expect(p.x).toBeGreaterThanOrEqual(row.x - 0.5);
    expect(p.x + p.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
    expect(p.width).toBeGreaterThanOrEqual(row.width - 30);
    expect((await box(panel.getByRole("slider", { name: "Color" }))).height).toBeGreaterThanOrEqual(
      160,
    );
    await expectNoHorizontalScroll(page);
    for (const control of [
      swatchOf(page, "Accent"),
      hexOf(page, "Accent"),
      panel.getByRole("button", { name: "Done", exact: true }),
      panel.getByRole("slider", { name: "Hue" }),
    ]) {
      expect((await box(control)).height).toBeGreaterThanOrEqual(44);
    }
  });

  test("M9-07 at 1440x900 the panel sits under its row inside the 720px column, with no horizontal scroll, and the preview bezel follows a drag", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "cp12");
    await openDesign(page);
    const panel = await openPanel(page, "Page background");
    const p = await box(panel);
    const col = await box(page.locator("[data-design-section='color']"));
    expect(p.x).toBeGreaterThanOrEqual(col.x);
    expect(p.x + p.width).toBeLessThanOrEqual(col.x + col.width + 0.5);
    expect(col.width).toBeLessThanOrEqual(720.5);
    await expectNoHorizontalScroll(page);
    const bezel = page.getByTestId("preview-screen");
    const colorBefore = await bezel
      .locator("[data-page-root]")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await drag(page, panel.locator(".react-colorful__saturation"), [0.2, 0.2], [0.9, 0.85]);
    await expect
      .poll(() =>
        bezel.locator("[data-page-root]").evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .not.toBe(colorBefore);
  });
});
