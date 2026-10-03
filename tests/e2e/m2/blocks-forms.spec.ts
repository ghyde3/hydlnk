import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { cleanupUsers, phoneOnly } from "../fixtures/data";
import {
  addBlock,
  box,
  css,
  draftOf,
  expectDraft,
  openEditor,
  previewScreen,
  rows,
  showView,
  userWithDraft,
} from "./blocks-helpers";

/**
 * M2-15 .. M2-21, the editor side: the edit panel of each block type, mounted from BLOCK_FORMS
 * inside the editor. Phone project = 390x844, desktop = 1440x900.
 */

test.afterAll(cleanupUsers);

const URL_MESSAGE = "Enter a full web address, like https://example.com.";
const EMBED_MESSAGE =
  "Paste a link to a YouTube video or a Spotify track, album, playlist or episode.";

test.describe("M2-15 link block panel", () => {
  test("M2-15 adds a Link block: the row, the preview anchor and the stored draft", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "lk");
    await openEditor(page);
    const { row, panel, id } = await addBlock(page, "link");

    await expect(panel.getByLabel("Label", { exact: true })).toHaveValue("New link");
    await panel.getByLabel("Label", { exact: true }).fill("Portrait sessions - fall dates");
    await panel.getByLabel("Link", { exact: true }).fill("https://maraokafor.com/portraits");

    await expect(row.getByRole("button", { expanded: true })).toContainText("Link");
    await expect(row.getByRole("button", { expanded: true })).toContainText(
      "Portrait sessions - fall dates",
    );
    await expect(row.getByRole("button", { expanded: true })).toContainText(
      "https://maraokafor.com/portraits",
    );

    await showView(page, "Preview");
    const anchor = previewScreen(page).locator(`a[data-block-id="${id}"]`);
    await expect(anchor).toHaveText("Portrait sessions - fall dates");
    // The link goes through the click redirect (M4-22): the destination is not in the markup.
    await expect(anchor).toHaveAttribute("href", new RegExp(`^/r/[0-9a-f-]{36}/${id}$`));
    await expect(anchor).toHaveAttribute("rel", "nofollow noopener");
    const column = await box(previewScreen(page).locator("[data-block-id]").first());
    expect((await box(anchor)).width).toBeGreaterThan(column.width * 0.5);

    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) => b.id === id && b.type === "link" && b.label === "Portrait sessions - fall dates",
      ),
    );
  });

  test("M2-15 the URL field: type, placeholder, keyboard, 44px, Geist Mono 16px", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "lku");
    await openEditor(page);
    const { panel } = await addBlock(page, "link");
    const field = panel.getByLabel("Link", { exact: true });
    await expect(field).toHaveAttribute("type", "url");
    await expect(field).toHaveAttribute("inputmode", "url");
    await expect(field).toHaveAttribute("autocapitalize", "none");
    await expect(field).toHaveAttribute("placeholder", "https://");
    expect((await box(field)).height).toBeGreaterThanOrEqual(44);
    const style = await field.evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, family: s.fontFamily };
    });
    expect(style.size).toBe("16px");
    expect(style.family.toLowerCase()).toMatch(/mono/);
  });

  test("M2-15 blur turns a bare address into an https URL", async ({ page, context }) => {
    const user = await userWithDraft(context, "lkb");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "link");
    const field = panel.getByLabel("Link", { exact: true });
    await field.fill("maraokafor.com/portraits");
    await field.blur();
    await expect(field).toHaveValue("https://maraokafor.com/portraits");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) => b.id === id && b.type === "link" && b.url === "https://maraokafor.com/portraits",
      ),
    );
  });

  test("M2-15 javascript: stays as typed, shows the message and still autosaves", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "lkj");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "link");
    const field = panel.getByLabel("Link", { exact: true });
    await field.fill("javascript:alert(1)");
    await field.blur();

    await expect(field).toHaveValue("javascript:alert(1)");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = await field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(URL_MESSAGE);

    await expectDraft(user.pageId, (d) =>
      d.blocks.some((b) => b.id === id && b.type === "link" && b.url === "javascript:alert(1)"),
    );

    // Fixing the value clears the message.
    await field.fill("https://example.com");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(URL_MESSAGE)).toHaveCount(0);
  });

  test("M2-15 the preview anchor of an invalid URL has no href", async ({ page, context }) => {
    await userWithDraft(context, "lkn");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "link");
    await panel.getByLabel("Link", { exact: true }).fill("javascript:alert(1)");
    await showView(page, "Preview");
    const anchor = previewScreen(page).locator(`a[data-block-id="${id}"]`);
    await expect(anchor).toBeVisible();
    expect(await anchor.getAttribute("href")).toBeNull();
  });

  test("M2-15 a 300-character URL does not widen the page, and the panel has 44px controls", async ({
    page,
    context,
  }, testInfo) => {
    await userWithDraft(context, "lkw");
    await openEditor(page);
    const { panel } = await addBlock(page, "link");
    await panel.getByLabel("Link", { exact: true }).fill(`https://example.com/${"a".repeat(280)}`);
    await expectNoHorizontalScroll(page);
    if (phoneOnly(testInfo)) {
      await expectTapTargets(page, 'li[data-block-id] [id^="block-panel-"]');
    }
  });
});

test.describe("M2-16 header, text and divider panels", () => {
  test("M2-16 the chips add 'New section', 'New text block' and 'Divider'", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "htd");
    await openEditor(page);
    const header = await addBlock(page, "header");
    await expect(header.row).toContainText("New section");
    await expect(header.panel.getByLabel("Text", { exact: true })).toHaveValue("New section");

    const text = await addBlock(page, "text");
    await expect(text.row).toContainText("New text block");
    await expect(text.panel.getByRole("textbox", { name: "Text" })).toHaveValue("New text block");
    await expect(text.panel).toContainText("14 / 600");

    const divider = await addBlock(page, "divider");
    await expect(divider.row).toContainText("Divider");
  });

  test("M2-16 the divider panel has no field, only the four panel buttons (Duplicate block since M6-05)", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "dv");
    await openEditor(page);
    const { panel } = await addBlock(page, "divider");
    // M6-05 puts 'Duplicate block' in every panel, the divider's included (it was three buttons before).
    await expect(panel.getByRole("button")).toHaveText([
      "Move up",
      "Move down",
      "Duplicate block",
      "Delete block",
    ]);
    await expect(panel.locator("input, textarea, select")).toHaveCount(0);
  });

  test("M2-16 the text counter follows typing and stops at 600", async ({ page, context }) => {
    const user = await userWithDraft(context, "tx");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "text");
    const area = panel.getByRole("textbox", { name: "Text" });
    await area.fill("line one\nline two");
    await expect(panel).toContainText("17 / 600");
    await area.fill("x".repeat(650));
    await expect(panel).toContainText("600 / 600");
    expect((await area.inputValue()).length).toBe(600);
    await expectDraft(user.pageId, (d) =>
      d.blocks.some((b) => b.id === id && b.type === "text" && b.text.length === 600),
    );
    expect((await box(area)).height).toBeGreaterThanOrEqual(44);
  });

  test("M2-16 the preview shows an h2, a two-line p and an hr", async ({ page, context }) => {
    await userWithDraft(context, "tp");
    await openEditor(page);
    const header = await addBlock(page, "header");
    await header.panel.getByLabel("Text", { exact: true }).fill("<script>alert(1)</script>");
    const text = await addBlock(page, "text");
    await text.panel.getByRole("textbox", { name: "Text" }).fill("first line\nsecond line");
    await addBlock(page, "divider");

    await showView(page, "Preview");
    const screen = previewScreen(page);
    await expect(screen.locator("h2[data-block-type=header]")).toHaveText(
      "<script>alert(1)</script>",
    );
    const p = screen.locator("p[data-block-type=text]");
    await expect(p).toHaveText("first line\nsecond line");
    expect(await css(p, "white-space")).toBe("pre-line");
    const lines = await p.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
    });
    expect(lines).toBe(2);
    await expect(screen.locator("hr[data-block-type=divider]")).toBeVisible();
  });

  test("M2-16 the inputs are at least 44px tall on a phone", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(!phoneOnly(testInfo), "phone layout check");
    await userWithDraft(context, "hti");
    await openEditor(page);
    const header = await addBlock(page, "header");
    expect(
      (await box(header.panel.getByLabel("Text", { exact: true }))).height,
    ).toBeGreaterThanOrEqual(44);
    const text = await addBlock(page, "text");
    expect(
      (await box(text.panel.getByRole("textbox", { name: "Text" }))).height,
    ).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M2-17 social panel", () => {
  test("M2-17 one Instagram icon to start; Add icon grows to 8 and then disables; Remove is disabled at 1", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "so");
    await openEditor(page);
    const { row, panel, id } = await addBlock(page, "social");
    const iconRows = panel.getByRole("group");
    await expect(iconRows).toHaveCount(1);
    await expect(iconRows.first().getByRole("combobox", { name: "Platform" })).toHaveValue(
      "instagram",
    );
    await expect(iconRows.first().getByRole("button", { name: "Remove" })).toBeDisabled();
    await expect(row).toContainText("Instagram");
    await expect(row).toContainText("1 icon");

    const add = panel.getByRole("button", { name: "Add icon" });
    for (let n = 2; n <= 8; n++) {
      await expect(add).toBeEnabled();
      await add.click();
      await expect(iconRows).toHaveCount(n);
    }
    await expect(add).toBeDisabled();
    await expect(row).toContainText("8 icons");
    await expect(iconRows.first().getByRole("button", { name: "Remove" })).toBeEnabled();
    for (const button of await panel
      .getByRole("button", { name: /^(Move up|Move down|Remove|Add icon)$/ })
      .all()) {
      expect((await box(button)).height).toBeGreaterThanOrEqual(44);
      expect((await box(button)).width).toBeGreaterThanOrEqual(44);
    }

    await expectDraft(user.pageId, (d) =>
      d.blocks.some((b) => b.id === id && b.type === "social" && b.icons.length === 8),
    );
  });

  test("M2-17 the row title lists the platforms and the sub line counts icons", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "sr", (handle) =>
      draftOf(handle, [
        {
          id: "Sx4kT9pLq2Wa",
          type: "social",
          visible: true,
          icons: [
            { id: "Ig3xQ7mNa2Ks", platform: "instagram", url: "https://instagram.com/a" },
            { id: "Tk8vR1dLp5Wc", platform: "tiktok", url: "https://www.tiktok.com/@a" },
            { id: "Yt6bH4zJe9Uo", platform: "youtube", url: "https://www.youtube.com/@a" },
            { id: "Em2cF5sYt7Dn", platform: "email", address: "hello@example.com" },
          ],
        },
      ]),
    );
    await openEditor(page);
    const row = rows(page).first();
    await expect(row).toContainText("Instagram, TikTok, YouTube, Email");
    await expect(row).toContainText("4 icons");
  });

  test("M2-17 Email swaps the URL field for an email input and the preview builds mailto:", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "se");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "social");
    const icon = panel.getByRole("group").first();
    await icon.getByRole("combobox", { name: "Platform" }).selectOption("email");
    await expect(icon.locator('input[type="url"]')).toHaveCount(0);
    const email = icon.getByLabel("Email address");
    await expect(email).toHaveAttribute("type", "email");
    await email.fill("hello@maraokafor.com");
    await showView(page, "Preview");
    const anchor = previewScreen(page).locator(`[data-block-id="${id}"] a[aria-label="Email"]`);
    await expect(anchor).toHaveAttribute("href", "mailto:hello@maraokafor.com");
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) =>
          b.id === id &&
          b.type === "social" &&
          b.icons[0]?.platform === "email" &&
          "address" in b.icons[0],
      ),
    );
  });

  test("M2-17 a javascript: icon URL is flagged in the field and renders without href", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "sj");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "social");
    const field = panel.getByRole("group").first().getByLabel("Link", { exact: true });
    await field.fill("javascript:alert(1)");
    await field.blur();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await showView(page, "Preview");
    const anchor = previewScreen(page).locator(`[data-block-id="${id}"] a[aria-label="Instagram"]`);
    await expect(anchor).toBeVisible();
    expect(await anchor.getAttribute("href")).toBeNull();
  });

  test("M2-17 moving and removing icons keeps the others, and the panel fits a phone", async ({
    page,
    context,
  }, testInfo) => {
    await userWithDraft(context, "sm");
    await openEditor(page);
    const { panel } = await addBlock(page, "social");
    const add = panel.getByRole("button", { name: "Add icon" });
    await add.click();
    await add.click();
    const platforms = () =>
      panel
        .getByRole("combobox", { name: "Platform" })
        .evaluateAll((els) => els.map((el) => (el as HTMLSelectElement).value));
    const before = await platforms();
    expect(before).toHaveLength(3);
    await panel.getByRole("group").first().getByRole("button", { name: "Move down" }).click();
    expect(await platforms()).toEqual([before[1], before[0], before[2]]);
    await panel.getByRole("group").last().getByRole("button", { name: "Remove" }).click();
    expect(await platforms()).toEqual([before[1], before[0]]);
    await expectNoHorizontalScroll(page);
    if (phoneOnly(testInfo)) await expectTapTargets(page, 'li[data-block-id] [id^="block-panel-"]');
  });
});

test.describe("M2-18 grid panel", () => {
  test("M2-18 two cells to start; Remove is disabled at 2, Add cell at 6; the row shows the titles", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "gr");
    await openEditor(page);
    const { row, panel, id } = await addBlock(page, "grid");
    const cells = panel.getByRole("group");
    await expect(cells).toHaveCount(2);
    for (const remove of await panel.getByRole("button", { name: "Remove" }).all()) {
      await expect(remove).toBeDisabled();
    }
    await expect(row).toContainText("2 cards");

    await cells.nth(0).getByLabel("Title", { exact: true }).fill("Prints");
    await cells.nth(1).getByLabel("Title", { exact: true }).fill("Workshops");
    await expect(row).toContainText("Prints · Workshops");

    const add = panel.getByRole("button", { name: "Add cell" });
    for (let n = 3; n <= 6; n++) {
      await add.click();
      await expect(cells).toHaveCount(n);
    }
    await expect(add).toBeDisabled();
    await expect(row).toContainText("6 cards");
    await expect(cells.first().getByRole("button", { name: "Remove" })).toBeEnabled();
    await expectDraft(user.pageId, (d) =>
      d.blocks.some((b) => b.id === id && b.type === "grid" && b.cells.length === 6),
    );
  });

  test("M2-18 each cell has Title, Subtitle and a URL field with 40 and 60 character limits", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "gl");
    await openEditor(page);
    const { panel } = await addBlock(page, "grid");
    const cell = panel.getByRole("group").first();
    await cell.getByLabel("Title", { exact: true }).fill("t".repeat(60));
    await cell.getByLabel("Subtitle", { exact: true }).fill("s".repeat(90));
    await expect(cell.getByLabel("Title", { exact: true })).toHaveValue("t".repeat(40));
    await expect(cell.getByLabel("Subtitle", { exact: true })).toHaveValue("s".repeat(60));
    await expect(cell.getByLabel("Link", { exact: true })).toHaveAttribute("type", "url");
  });

  test("M2-18 the grid stays two columns in the preview with long words", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "gp");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "grid");
    const cells = panel.getByRole("group");
    await cells
      .nth(0)
      .getByLabel("Title", { exact: true })
      .fill("Supercalifragilisticexpialidocious");
    await cells.nth(1).getByLabel("Title", { exact: true }).fill("Workshops");
    await showView(page, "Preview");
    const grid = previewScreen(page).locator(`[data-block-id="${id}"]`);
    const rects = await grid
      .locator("a")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
    expect(rects).toHaveLength(2);
    expect(Math.abs(rects[0].top - rects[1].top)).toBeLessThan(2);
    const outer = await box(grid);
    expect(rects[0].width + rects[1].width).toBeLessThanOrEqual(outer.width + 1);
    for (const rect of rects) expect(rect.right).toBeLessThanOrEqual(outer.x + outer.width + 1);
  });
});

test.describe("M2-19 embed panel", () => {
  test("M2-19 Caption and a URL field; an invalid link shows the embed message", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "em");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "embed");
    await expect(panel.getByLabel("Caption", { exact: true })).toHaveValue("Video or music");
    const field = panel.getByLabel("Link", { exact: true });
    await field.fill("https://evil.example/x");
    await field.blur();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(panel).toContainText(EMBED_MESSAGE);

    await field.fill("youtu.be/aqz-KE-bpKQ");
    await field.blur();
    await expect(field).toHaveValue("https://youtu.be/aqz-KE-bpKQ");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await expect(panel).toContainText("YouTube video");
    await expect(panel).not.toContainText(EMBED_MESSAGE);
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) => b.id === id && b.type === "embed" && b.url === "https://youtu.be/aqz-KE-bpKQ",
      ),
    );
  });

  test("M2-19 the preview shows the click-to-play facade, with no request to YouTube", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "ef");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "embed");
    await panel.getByLabel("Caption", { exact: true }).fill("Behind the lens, ep. 4");
    await panel
      .getByLabel("Link", { exact: true })
      .fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    await showView(page, "Preview");
    const facade = previewScreen(page).locator(`[data-block-id="${id}"] button`);
    await expect(facade).toHaveAttribute("aria-label", "Play video: Behind the lens, ep. 4");
    await expect(previewScreen(page).locator("iframe")).toHaveCount(0);
    const { width, height } = await box(facade);
    expect(Math.abs(width / height - 16 / 9)).toBeLessThan(0.05);
    expect(height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("M2-20 and M2-21 image and card panels", () => {
  test("M2-20 the Image panel: upload control, Alt text hint, optional link; the preview shows the placeholder", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "im");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "image");
    await expect(panel.getByRole("button", { name: "Upload image" })).toBeVisible();
    await expect(panel.getByLabel("Alt text", { exact: true })).toBeVisible();
    await expect(panel).toContainText("Describe the image for people who can't see it");
    await expect(panel.getByLabel("Link (optional)")).toHaveAttribute("type", "url");
    expect(
      (await box(panel.getByRole("button", { name: "Upload image" }))).height,
    ).toBeGreaterThanOrEqual(44);

    await showView(page, "Preview");
    const placeholder = previewScreen(page).locator(`[data-block-id="${id}"]`);
    await expect(placeholder).toHaveText("Image");
    expect((await box(placeholder)).height).toBeCloseTo(120, 0);
    expect(await css(placeholder, "border-top-style")).toBe("dashed");
    await expectDraft(user.pageId, (d) => d.blocks.some((b) => b.id === id && b.type === "image"));
  });

  test("M2-21 the Card panel: title, caption, link and upload; the preview shows the banner and View", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "cd");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "card");
    await expect(panel.getByLabel("Title", { exact: true })).toHaveValue("New card");
    await panel.getByLabel("Title", { exact: true }).fill("Night Market");
    await panel.getByLabel("Caption", { exact: true }).fill("");
    await panel.getByLabel("Link", { exact: true }).fill("https://maraokafor.com/night-market");
    await expect(panel.getByRole("button", { name: "Upload image" })).toBeVisible();
    await showView(page, "Preview");
    const card = previewScreen(page).locator(`a[data-block-id="${id}"]`);
    await expect(card).toContainText("Night Market");
    await expect(card).toContainText("View");
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card).toHaveAttribute("href", new RegExp(`^/r/[0-9a-f-]{36}/${id}$`));
  });
});
