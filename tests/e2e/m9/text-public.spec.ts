import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { expectNoHorizontalScroll, url } from "../helpers";
import { showView } from "../m2/blocks-helpers";
import {
  L1,
  L2,
  TEXT_ID,
  accessToken,
  alertFor,
  bold,
  box,
  draftWith,
  editorOf,
  isPhone,
  italic,
  link,
  liveText,
  openBlock,
  openEditor,
  pageRow,
  previewBlock,
  publishButton,
  selectText,
  statusChip,
  textBlock,
  tool,
  userWithBlocks,
} from "./text-helpers";

test.afterAll(cleanupUsers);

/**
 * M9-11 on the live page and at Publish: strikethrough and underline draw <s> and <u>, a paragraph
 * with an alignment is a `.pg-text-line` span with `data-align`, the editor's preview and the live
 * page draw the same block, and hostile marks written straight to the draft are refused or
 * normalized at Publish. Every test makes its own page (mara's seed data is never touched).
 */

const strike = (start: number, end: number) => ({ type: "strike", start, end });
const underline = (start: number, end: number) => ({ type: "underline", start, end });
const align = (start: number, end: number, value: unknown) => ({
  type: "align",
  start,
  end,
  align: value,
});

const textOf = (page: Page) => page.locator(`p.pg-text[data-block-id="${TEXT_ID}"]`);

/** The spec's phone fixture: bold, italic, strike, underline, two links, a centered and a right-aligned paragraph, and a 200-character unbroken line. */
function fixture() {
  const unbroken = "u".repeat(200);
  const lines = [
    "Bold words, italic words and a first link here",
    "Struck words, underlined words and a second link",
    "A right-aligned paragraph with some plain filler text in it",
    unbroken,
    "A last plain line to close the block.",
  ];
  const text = lines.join("\n");
  const at = (needle: string) => Array.from(text.slice(0, text.indexOf(needle))).length;
  const span = (needle: string) => [at(needle), at(needle) + Array.from(needle).length] as const;
  const [b0, b1] = span("Bold words");
  const [i0, i1] = span("italic words");
  const [l0, l1] = span("a first link");
  const [s0, s1] = span("Struck words");
  const [u0, u1] = span("underlined words");
  const [m0, m1] = span("a second link");
  const lineStart = (index: number) => Array.from(lines.slice(0, index).join("\n")).length + (index > 0 ? 1 : 0);
  const lineEnd = (index: number) => lineStart(index) + Array.from(lines[index]!).length;
  const marks = [
    bold(b0, b1),
    italic(i0, i1),
    link(l0, l1, L1, "https://example.com/first"),
    strike(s0, s1),
    underline(u0, u1),
    link(m0, m1, L2, "https://example.com/second"),
    align(lineStart(0), lineEnd(0), "center"),
    align(lineStart(2), lineEnd(2), "right"),
  ];
  expect(Array.from(text).length).toBeLessThanOrEqual(600);
  return { text, marks, lines };
}

test.describe("M9-11 the live page", () => {
  test("M9-11 strike and underline draw <s> and <u>, a centered and a right-aligned paragraph align inside the column, long text wraps", async ({
    page,
  }) => {
    const { text, marks } = fixture();
    const fx = await liveText("m9pub", textBlock(text, marks));
    await page.goto(fx.url);
    const p = textOf(page);
    await expect(p.locator("span.pg-text-line")).toHaveCount(5);
    // The line breaks are the spans' own: they are not written as text.
    expect(await p.evaluate((el) => el.textContent)).toBe(text.replaceAll("\n", ""));
    const lines = p.locator("span.pg-text-line");
    expect(await lines.nth(0).getAttribute("data-align")).toBe("center");
    expect(await lines.nth(1).getAttribute("data-align")).toBeNull();
    expect(await lines.nth(2).getAttribute("data-align")).toBe("right");
    expect(await lines.nth(0).evaluate((el) => getComputedStyle(el).textAlign)).toBe("center");
    expect(await lines.nth(2).evaluate((el) => getComputedStyle(el).textAlign)).toBe("right");
    expect(await p.evaluate((el) => el.getAttribute("style"))).toBeNull();
    expect(await p.locator("[style]").count()).toBe(0);
    // Strike and underline.
    expect(await p.locator("s").first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
    expect(await p.locator("u").first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("underline");
    await expect(p.locator("s")).toHaveText("Struck words");
    await expect(p.locator("u")).toHaveText("underlined words");
    // Wraps inside the column, nothing scrolls sideways, every anchor is at least 44px tall.
    await expectNoHorizontalScroll(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    );
    expect(await p.evaluate((el) => getComputedStyle(el).overflowWrap)).toBe("anywhere");
    for (const anchor of await page.locator("a").all()) {
      expect((await box(anchor)).height, await anchor.innerText()).toBeGreaterThanOrEqual(43.5);
    }
    const column = await box(page.locator(".pg-column"));
    const pb = await box(p);
    expect(pb.x).toBeGreaterThanOrEqual(column.x - 0.5);
    expect(pb.x + pb.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
    if (!isPhone(page)) expect(pb.width).toBeLessThanOrEqual(480.5);
    // The aligned lines sit where they say: the right-aligned text ends at the paragraph's right edge, the centered one is centered.
    const edges = await p.evaluate((el) => {
      const rect = (node: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        return {
          left: Math.min(...rects.map((r) => r.left)),
          right: Math.max(...rects.map((r) => r.right)),
        };
      };
      const lines = Array.from(el.querySelectorAll(":scope > span.pg-text-line"));
      const own = el.getBoundingClientRect();
      return { own: { left: own.left, right: own.right }, centered: rect(lines[0]!), right: rect(lines[2]!) };
    });
    expect(Math.abs(edges.right.right - edges.own.right)).toBeLessThanOrEqual(1);
    const centeredMiddle = (edges.centered.left + edges.centered.right) / 2;
    expect(Math.abs(centeredMiddle - (edges.own.left + edges.own.right) / 2)).toBeLessThanOrEqual(1);
  });

  test("M9-11 a block without an align mark renders exactly as before: no line spans, same <style> as another page with a text block", async ({
    page,
  }) => {
    const a = await liveText("m9old1", textBlock("Hello big world", [bold(0, 5), italic(3, 9), link(10, 15, L1)]));
    const b = await liveText("m9old2", textBlock("A different sentence", [strike(0, 1)]));
    const html = async (fx: { url: string }) => (await (await page.request.get(fx.url)).text());
    const first = await html(a);
    const second = await html(b);
    // The stylesheet holds the line rules (the page has a text block); the markup holds no line span.
    const body = (document: string) => document.slice(document.indexOf("<body"));
    expect(body(first)).not.toContain("pg-text-line");
    expect(body(second)).not.toContain("pg-text-line");
    const style = (document: string) => /<style[\s\S]*?<\/style>/.exec(document)?.[0] ?? "";
    expect(style(first)).toBe(style(second));
    expect(style(first)).toContain(".pg-text-line");
  });
});

test.describe("M9-11 parity and the chip", () => {
  test("M9-11 the preview and the live page draw the same block after Publish; changing only an alignment flips the chip to 'Unpublished changes'", async ({
    page,
    context,
  }) => {
    const text = "Struck words\nunderlined words\n\nthe right-aligned one";
    const block = textBlock(text, [
      strike(0, 12),
      underline(13, 29),
      align(13, 29, "center"),
      align(31, 50, "right"),
    ]);
    const user = await userWithBlocks(context, "m9par", [block]);
    await openEditor(page);
    await showView(page, "Preview");
    const previewHtml = await previewBlock(page, TEXT_ID).evaluate((el) => el.outerHTML);
    expect(previewHtml).toContain("<s>Struck words</s>");
    expect(previewHtml).toContain('<span class="pg-text-line" data-align="center">');
    expect(previewHtml).toContain('<span class="pg-text-line" data-align="right">');
    await showView(page, "Blocks");
    await expect(statusChip(page)).toHaveText("Not published");
    await publishButton(page).click();
    await expect(page.locator('[data-publish-status="published"]')).toBeVisible({ timeout: 20_000 });
    const liveHtml = await (await page.request.get(url(user.handle))).text();
    const liveBlock = new RegExp(`<p class="pg-text"[^>]*data-block-id="${TEXT_ID}"[^>]*>[\\s\\S]*?</p>`).exec(
      liveHtml,
    )?.[0];
    expect(liveBlock).toBe(previewHtml);

    // Only an alignment changes.
    await openBlock(page, TEXT_ID);
    await selectText(page, TEXT_ID, 40);
    await tool(page, TEXT_ID, "Align left").click();
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await expect(editorOf(page, TEXT_ID)).toContainText("the right-aligned one");
    await tool(page, TEXT_ID, "Align right").click();
    await expect(statusChip(page)).toHaveText("Published");
  });
});

test.describe("M9-11 abuse: hostile marks written straight to the draft", () => {
  /** The draft written as the owner, with the publishable key and the JWT, as raw JSON. */
  async function writeDraft(
    context: import("@playwright/test").BrowserContext,
    user: { handle: string; pageId: string },
    blocks: unknown[],
  ) {
    const before = await pageRow(user.pageId);
    const next = { ...draftWith(user.handle, blocks), rev: before.draft.rev + 1 };
    const write = await restAs(await accessToken(context), `/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      body: { draft: next },
    });
    expect(write.status, JSON.stringify(write.body)).toBe(200);
    return before;
  }

  test("M9-11 style keys, half-line aligns and out-of-range offsets are normalized at Publish; nothing unnormalized reaches pages.published", async ({
    page,
    context,
  }) => {
    const user = await userWithBlocks(context, "m9ab1", [textBlock("seed")]);
    const hostile = textBlock("Hello world\nsecond line", [
      { ...underline(0, 5), style: "color:red", class: "x", href: "javascript:alert(1)" },
      strike(-4, 3),
      bold(0.4, 99),
      italic(6, 6.9),
      { ...align(14, 17, "center"), style: "text-align:right" },
      underline(500, 900),
    ]);
    await writeDraft(context, user, [hostile]);
    await openEditor(page);
    await publishButton(page).click();
    await expect(page.locator('[data-publish-status="published"]')).toBeVisible({ timeout: 20_000 });
    const published = (await pageRow(user.pageId)).published as {
      blocks: { text: string; marks: Record<string, unknown>[] }[];
    };
    const marks = published.blocks[0]!.marks;
    const length = Array.from(published.blocks[0]!.text).length;
    for (const mark of marks) {
      expect(Object.keys(mark).every((key) => ["type", "start", "end", "align", "id", "url"].includes(key))).toBe(true);
      expect(Number.isInteger(mark.start) && Number.isInteger(mark.end)).toBe(true);
      expect(mark.start as number).toBeGreaterThanOrEqual(0);
      expect(mark.end as number).toBeLessThanOrEqual(length);
    }
    // The align that cut a line in half is the whole line.
    expect(marks.filter((m) => m.type === "align")).toEqual([{ type: "align", start: 12, end: 23, align: "center" }]);
    expect(JSON.stringify(published)).not.toContain("javascript:");
    expect(JSON.stringify(published)).not.toContain("color:red");
    const response = await page.goto(url(user.handle));
    expect(response?.status()).toBe(200);
    expect(await page.content()).not.toContain("javascript:alert");
  });

  const refused: [string, () => unknown[]][] = [
    ["an align value that is markup", () => [align(0, 5, 'center"><script>alert(1)</script>')]],
    ["an align value of justify", () => [align(0, 5, "justify")]],
    ["a mark of another type", () => [{ type: "code", start: 0, end: 3 }]],
    ["40 inline marks", () => Array.from({ length: 40 }, (_, i) => strike(i, i + 1))],
    ["25 align marks", () => Array.from({ length: 25 }, (_, i) => align(i * 3, i * 3 + 2, "right"))],
  ];
  for (const [name, make] of refused) {
    test(`M9-11 ${name} fails Publish with the formatting message and never reaches the live page`, async ({
      page,
      context,
    }) => {
      const seeded = textBlock("A safe sentence for the live page.");
      const user = await userWithBlocks(context, `m9ab-${name.slice(0, 6).replace(/\W/g, "")}`, [seeded]);
      const { toPublishForm } = await import("@/lib/document");
      await adminClient()
        .from("pages")
        .update({
          published: toPublishForm(draftWith(user.handle, [seeded]), null),
          published_at: new Date().toISOString(),
        })
        .eq("id", user.pageId);
      const bad = textBlock(
        Array.from({ length: 25 }, (_, i) => `ab${i}`).join("\n").padEnd(100, "x"),
        make(),
        {},
        "text-hostile-01",
      );
      const before = await writeDraft(context, user, [seeded, bad]);
      await openEditor(page);
      await publishButton(page).click();
      await expect(alertFor(page, "Fix 1 block before publishing.")).toBeVisible();
      expect((await pageRow(user.pageId)).published).toEqual(before.published);
      const html = await (await page.request.get(url(user.handle))).text();
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("text-hostile-01");
    });
  }

  test("M9-11 a hostile mark in a hidden block does not stop Publish", async ({ page, context }) => {
    const user = await userWithBlocks(context, "m9ab6", [textBlock("seed")]);
    const hidden = textBlock("Hidden text", [align(0, 5, "justify"), link(0, 5, L1, "javascript:alert(1)")], { visible: false }, "text-hidden-01");
    const shown = textBlock("Shown text", [strike(0, 5)]);
    await writeDraft(context, user, [shown, hidden]);
    await openEditor(page);
    await publishButton(page).click();
    await expect(page.locator('[data-publish-status="published"]')).toBeVisible({ timeout: 20_000 });
    const live = await (await page.request.get(url(user.handle))).text();
    expect(live).toContain("<s>Shown</s>");
    expect(live).not.toContain("Hidden text");
  });
});
