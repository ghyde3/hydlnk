import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { expectNoHorizontalScroll, url } from "../helpers";
import {
  L1,
  L2,
  L3,
  TEXT_ID,
  accessToken,
  alertFor,
  bold,
  box,
  draftWith,
  isPhone,
  italic,
  link,
  liveText,
  longFixture,
  openBlock,
  openEditor,
  pageRow,
  previewBlock,
  publishButton,
  selectText,
  statusChip,
  textBlock,
  toolbarOf,
  userWithBlocks,
} from "./text-helpers";
import { showView } from "../m2/blocks-helpers";

test.afterAll(cleanupUsers);

/**
 * M6-28 on the live page: marks draw <strong>, <em> and links through the click redirect, the text
 * itself is never parsed, tenant text is escaped, and long text wraps. Every test makes its own page.
 */

const SYNTAX = "**bold** _italic_ <b>x</b> https://example.com javascript:alert(1)";
const URL_SENTENCE = "Enter a full web address, like https://example.com.";

const textOf = (page: import("@playwright/test").Page) =>
  page.locator(`p.pg-text[data-block-id="${TEXT_ID}"]`);

test.describe("M6-28 a text with no marks is literal", () => {
  test("M6-28 Markdown, HTML, a URL and javascript: stay plain text; line breaks are kept", async ({
    page,
  }) => {
    const fx = await liveText("txlit", textBlock(`${SYNTAX}\nsecond line`));
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(fx.url);
    const p = textOf(page);
    await expect(p).toHaveText(`${SYNTAX}\nsecond line`);
    expect(await p.locator("strong, em, a, b, i, u, script, img, br").count()).toBe(0);
    expect(await p.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-line");
    expect(await p.evaluate((el) => el.childNodes.length)).toBe(1);
    // The same page has no anchor in the text at all.
    expect(await page.locator("p.pg-text a").count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test("M6-28 the M2-16 escaping examples render as visible text", async ({ page }) => {
    const tricks = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "</p><p class='pg-text'>fake",
    ];
    const fx = await liveText(
      "txesc",
      ...tricks.map((t, i) => textBlock(t, undefined, {}, `text-escape-0${i}`)),
    );
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(fx.url);
    for (const [i, t] of tricks.entries()) {
      await expect(page.locator(`p.pg-text[data-block-id="text-escape-0${i}"]`)).toHaveText(t);
    }
    expect(await page.locator("p.pg-text > *").count()).toBe(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe("M6-28 marks on the live page", () => {
  test("M6-28 bold, italic and nested ranges draw strong and em; links go through /r and read in the accent color", async ({
    page,
  }) => {
    const text = "Hello big world and a link";
    const fx = await liveText(
      "txmark",
      textBlock(text, [bold(0, 5), italic(3, 9), link(20, 26, L1, "https://example.com/book?x=1")]),
    );
    await page.goto(fx.url);
    const p = textOf(page);
    await expect(p).toHaveText(text);
    // Overlapping bold and italic nest as <strong><em>.
    await expect(p.locator("strong")).toHaveCount(2);
    await expect(p.locator("strong > em")).toHaveCount(1);
    await expect(p.locator("strong > em")).toHaveText("lo");
    await expect(p.locator("em")).toHaveCount(2);
    // The link.
    const anchor = p.locator("a");
    await expect(anchor).toHaveCount(1);
    await expect(anchor).toHaveText("a link");
    await expect(anchor).toHaveAttribute("href", `/r/${fx.pageId}/${L1}`);
    await expect(anchor).toHaveAttribute("rel", "nofollow noopener");
    expect(await page.content()).not.toContain("example.com/book");
    // Accent color, always underlined.
    const accent = await page.locator("[data-page-root]").evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--t-accent)";
      el.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(await anchor.evaluate((el) => getComputedStyle(el).color)).toBe(accent);
    expect(await anchor.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe(
      "underline",
    );
    // Bold and italic use no color of their own: they inherit the paragraph's.
    const paragraphColor = await p.evaluate((el) => getComputedStyle(el).color);
    expect(
      await p
        .locator("strong")
        .first()
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe(paragraphColor);
    expect(
      await p
        .locator("em")
        .first()
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe(paragraphColor);
  });

  test("M6-28 link text such as <img src=x onerror=alert(1)> is visible text and opens no dialog", async ({
    page,
  }) => {
    const text = "Visit <img src=x onerror=alert(1)> today";
    const payload = "<img src=x onerror=alert(1)>";
    const start = text.indexOf(payload);
    const fx = await liveText(
      "txxss",
      textBlock(text, [link(start, start + payload.length, L1, "https://example.com/x")]),
    );
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(fx.url);
    await expect(textOf(page)).toHaveText(text);
    await expect(textOf(page).locator("a")).toHaveText("<img src=x onerror=alert(1)>");
    expect(await page.locator("p.pg-text img").count()).toBe(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test("M6-28 a long text with formatting and a 200-character link wraps; every anchor is at least 44px tall; the column holds", async ({
    page,
  }) => {
    const fixture = longFixture();
    expect(Array.from(fixture.text)).toHaveLength(600);
    const fx = await liveText("txlong", textBlock(fixture.text, fixture.marks));
    await page.goto(fx.url);
    const p = textOf(page);
    await expect(p.locator("a")).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      innerWidth,
    );
    expect(await p.evaluate((el) => getComputedStyle(el).overflowWrap)).toBe("anywhere");
    // Every link of the text, and every other anchor on the page.
    for (const anchor of await page.locator("a").all()) {
      const b = await box(anchor);
      expect(b.height, await anchor.innerText()).toBeGreaterThanOrEqual(43.5);
    }
    // The unbroken 200-character link wraps inside the column.
    const unbroken = p.locator("a").nth(1);
    const ub = await box(unbroken);
    const column = await box(page.locator(".pg-column"));
    expect(ub.x).toBeGreaterThanOrEqual(column.x - 0.5);
    expect(ub.x + ub.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
    const pb = await box(p);
    if (!isPhone(page)) {
      // 1440: the text stays in the 480px column, links underlined in the accent color.
      expect(pb.width).toBeLessThanOrEqual(480.5);
      expect(await unbroken.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe(
        "underline",
      );
      const align = await page.locator("[data-page-root]").getAttribute("data-align");
      expect(["center", "left"]).toContain(align);
      expect(await p.evaluate((el) => getComputedStyle(el).textAlign)).toBe(
        align === "left" ? "start" : "center",
      );
    }
  });

  test("M6-28 link padding does not change the line spacing", async ({ page }) => {
    const text = "one two three four five six seven eight nine ten eleven twelve";
    const plain = await liveText("txlh1", textBlock(text));
    const marked = await liveText("txlh2", textBlock(text, [link(4, 7, L1), link(30, 40, L2)]));
    await page.goto(plain.url);
    const plainHeight = (await box(textOf(page))).height;
    await page.goto(marked.url);
    const markedHeight = (await box(textOf(page))).height;
    expect(markedHeight).toBeCloseTo(plainHeight, 0);
  });
});

test.describe("M6-28 abuse: hostile marks written straight to the draft", () => {
  for (const [index, hostile] of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user@host.example/",
  ].entries()) {
    test(`M6-28 a link to ${hostile.slice(0, 32)} fails Publish and never renders an anchor`, async ({
      page,
      context,
    }) => {
      const safe = textBlock("A safe sentence for the live page.", [link(2, 6, L1)]);
      const user = await userWithBlocks(context, `txab${index}`, [safe]);
      const { toPublishForm } = await import("@/lib/document");
      const { error: seed } = await adminClient()
        .from("pages")
        .update({
          published: toPublishForm(draftWith(user.handle, [safe]), null),
          published_at: new Date().toISOString(),
        })
        .eq("id", user.pageId);
      expect(seed).toBeNull();
      const before = await pageRow(user.pageId);

      const bad = textBlock(
        "Click here for the thing",
        [link(0, 5, L2, hostile)],
        {},
        "text-hostile-01",
      );
      const next = { ...draftWith(user.handle, [safe, bad]), rev: before.draft.rev + 1 };
      const write = await restAs(await accessToken(context), `/pages?id=eq.${user.pageId}`, {
        method: "PATCH",
        body: { draft: next },
      });
      expect(write.status, JSON.stringify(write.body)).toBe(200);

      await openEditor(page);
      await publishButton(page).click();
      const alert = alertFor(page, "Fix 1 block before publishing.");
      await expect(alert).toBeVisible();
      const row = page.locator('li[data-block-id="text-hostile-01"]');
      await expect(row.getByText(URL_SENTENCE, { exact: true })).toBeVisible();
      // The failing row is open and the link's row takes the focus.
      await expect(row.locator(`li[data-item-id="${L2}"]`)).toBeFocused();

      const after = await pageRow(user.pageId);
      expect(after.published).toEqual(before.published);
      const html = await (await page.request.get(url(user.handle))).text();
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("host.example");
      expect(html).not.toContain("Click here for the thing");
    });
  }

  test("M6-28 marks that point past the end are clipped at Publish and never throw in the preview or on the live page", async ({
    page,
    context,
  }) => {
    const odd = textBlock("Hello world", [
      bold(-4, 3),
      italic(8, 999),
      link(2.5, 40, L1),
      bold(50, 60),
      bold(0.2, 0.8),
    ]);
    const user = await userWithBlocks(context, "txclip", [odd]);
    await openEditor(page);
    await showView(page, "Preview");
    await expect(previewBlock(page, TEXT_ID)).toHaveText("Hello world");
    await showView(page, "Blocks");
    await publishButton(page).click();
    await expect(page.locator('[data-publish-status="published"]')).toBeVisible({
      timeout: 20_000,
    });
    const published = (await pageRow(user.pageId)).published as {
      blocks: { marks?: Record<string, unknown>[] }[];
    };
    expect(published.blocks[0]!.marks).toEqual([
      { type: "bold", start: 0, end: 3 },
      { type: "link", start: 2, end: 11, id: L1, url: "https://example.com/book" },
      { type: "italic", start: 8, end: 11 },
    ]);
    const live = await page.goto(url(user.handle));
    expect(live?.status()).toBe(200);
    await expect(textOf(page)).toHaveText("Hello world");
  });

  test("M6-28 a published document holding a link with another scheme never renders an anchor", async ({
    page,
  }) => {
    const fx = await liveText("txpub", textBlock("Click here", [link(0, 5, L1)]));
    const tampered = JSON.parse(JSON.stringify(fx.doc)) as {
      blocks: { marks: { url: string }[] }[];
    };
    tampered.blocks[0]!.marks[0]!.url = "javascript:alert(1)";
    const { error } = await adminClient()
      .from("pages")
      .update({ published: tampered })
      .eq("id", fx.pageId);
    expect(error).toBeNull();
    const response = await page.goto(fx.url);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("a[href^='javascript']")).toHaveCount(0);
    expect(await page.content()).not.toContain("javascript:alert");
  });
});

test.describe("M6-28 parity and the status chip", () => {
  test("M6-28 the block's markup is the same in the preview and on the live page after Publish; a mark change flips the chip", async ({
    page,
    context,
  }) => {
    const text = "Hello big world and a link here";
    const block = textBlock(text, [
      bold(0, 5),
      italic(3, 9),
      link(20, 26, L3, "https://example.com/book"),
    ]);
    const user = await userWithBlocks(context, "txpar", [block]);
    await openEditor(page);
    await showView(page, "Preview");
    const previewHtml = await previewBlock(page, TEXT_ID).evaluate((el) => el.outerHTML);
    expect(previewHtml).toContain("<strong>");
    await showView(page, "Blocks");

    await expect(statusChip(page)).toHaveText("Not published");
    await publishButton(page).click();
    await expect(page.locator('[data-publish-status="published"]')).toBeVisible({
      timeout: 20_000,
    });
    const liveHtml = await (await page.request.get(url(user.handle))).text();
    const liveBlock =
      /<p class="pg-text"[^>]*data-block-id="text-fixture-01"[^>]*>[\s\S]*?<\/p>/.exec(
        liveHtml,
      )?.[0];
    expect(liveBlock).toBe(previewHtml);
    expect(liveBlock).toContain(`/r/${user.pageId}/${L3}`);

    // A change to the marks flips the chip to 'Unpublished changes'; the text and its row title stay.
    const panel = await openBlock(page, TEXT_ID);
    await selectText(page, TEXT_ID, 26, 30);
    await toolbarOf(page, TEXT_ID).getByRole("button", { name: "Bold" }).click();
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await expect(panel.locator("textarea")).toHaveValue(text);
    await expect(page.locator(`li[data-block-id="${TEXT_ID}"]`)).toContainText(text);
  });
});
