// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer, type PageRendererProps } from "@/components/page/page-renderer";
import { toPublishForm, type Block, type DraftDoc, type PublishDoc } from "@/lib/document";
import { tenantInlineCss } from "@/lib/tenant-assets/css";
import { draftWith, fullDraft, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

/**
 * M9-11: the renderer. Strike and underline draw `<s>` and `<u>` in the nesting order
 * `<strong><em><s><u>`; a text block with an align mark draws every line as a `.pg-text-line` span
 * with `data-align` from the closed list; a block without the new marks renders byte for byte as
 * before (the golden strings below were captured from the renderer before this feature).
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const TEXT_ID = "text-render-0001";
const L1 = "link-render-0001";

const textBlock = (value: string, marks?: unknown[]): Block =>
  ({
    id: TEXT_ID,
    type: "text",
    visible: true,
    text: value,
    ...(marks ? { marks } : {}),
  }) as unknown as Block;

const publishedDoc = (...list: Block[]): PublishDoc =>
  toPublishForm(draftWith(...list) as DraftDoc, noirTokens);

const render = (doc: PublishDoc, props: Partial<Omit<PageRendererProps, "doc">> = {}) =>
  renderToStaticMarkup(
    createElement(PageRenderer, { doc, pageId: PAGE_ID, mode: "live", ...props }),
  );

const paragraph = (html: string): HTMLElement =>
  new DOMParser()
    .parseFromString(`<body>${html}</body>`, "text/html")
    .querySelector<HTMLElement>("p.pg-text")!;

const renderText = (
  value: string,
  marks?: unknown[],
  props: Partial<Omit<PageRendererProps, "doc">> = {},
) => paragraph(render(publishedDoc(textBlock(value, marks)), props));

const mark = (type: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({
  type,
  start,
  end,
  ...extra,
});

const OPEN = `<p class="pg-text" data-block-id="${TEXT_ID}" data-block-type="text">`;

/** The renderer's output for blocks without the new marks, from before M9-11. */
const GOLDEN: [string, string, unknown[] | undefined, string][] = [
  ["plain", "Plain", undefined, `${OPEN}Plain</p>`],
  ["lines", "a\nb\n\nc", undefined, `${OPEN}a\nb\n\nc</p>`],
  ["bold", "Hello world", [mark("bold", 0, 5)], `${OPEN}<strong>Hello</strong> world</p>`],
  [
    "bold and italic",
    "Hello world",
    [mark("bold", 0, 5), mark("italic", 3, 8)],
    `${OPEN}<strong>Hel</strong><strong><em>lo</em></strong><em> wo</em>rld</p>`,
  ],
  [
    "italic, link and bold",
    "Hello world again",
    [
      mark("italic", 0, 5),
      mark("link", 3, 9, { id: L1, url: "https://example.com/x" }),
      mark("bold", 6, 12),
    ],
    `${OPEN}<em>Hel</em><a class="pg-text-link" href="/r/${PAGE_ID}/${L1}" rel="nofollow noopener"><em>lo</em> <strong>wor</strong></a><strong>ld </strong>again</p>`,
  ],
  [
    "literal markup",
    "<b>x</b> **y**",
    [mark("bold", 0, 3)],
    `${OPEN}<strong>&lt;b&gt;</strong>x&lt;/b&gt; **y**</p>`,
  ],
];

describe("M9-11 old documents render byte for byte as before", () => {
  it.each(GOLDEN)("%s", (_name, value, marks, expected) => {
    for (const mode of ["live", "preview"] as const) {
      const html = render(publishedDoc(textBlock(value, marks)), { mode });
      expect(html).toContain(expected);
      expect(html).not.toContain("pg-text-line");
      expect(html).not.toMatch(/<[su][ >]/);
    }
  });

  it("the full fixture page has no new markup", () => {
    // An old document: none of the blocks added after M9-11 (items has a struck sold price).
    const old = {
      ...fullDraft,
      blocks: fullDraft.blocks.filter((b) => !["items", "hours", "page_link"].includes(b.type)),
    };
    const html = render(toPublishForm(old, noirTokens));
    expect(html).not.toContain("pg-text-line");
    expect(html).not.toMatch(/<s>|<u>/);
  });

  it("a thumbnail still draws its link as an inert span", () => {
    const html = render(
      publishedDoc(
        textBlock("Hello", [mark("link", 0, 5, { id: L1, url: "https://example.com/x" })]),
      ),
      { thumbnail: true },
    );
    expect(html).toContain(`${OPEN}<span class="pg-text-link">Hello</span></p>`);
  });
});

describe("M9-11 strike and underline", () => {
  it("draw <s> and <u>", () => {
    const p = renderText("Hello world", [mark("strike", 0, 5), mark("underline", 6, 11)]);
    expect(p.innerHTML).toBe("<s>Hello</s> <u>world</u>");
    expect(p.querySelector("[class], [style]")).toBeNull();
  });

  it("overlapping marks nest as strong, em, s, u", () => {
    const p = renderText("abcd", [
      mark("underline", 0, 4),
      mark("strike", 0, 4),
      mark("italic", 0, 4),
      mark("bold", 0, 4),
    ]);
    expect(p.innerHTML).toBe("<strong><em><s><u>abcd</u></s></em></strong>");
  });

  it("a link wraps whatever it covers", () => {
    const p = renderText("Hello world", [
      mark("strike", 0, 11),
      mark("underline", 2, 8),
      mark("link", 4, 9, { id: L1, url: "https://example.com/x" }),
    ]);
    const anchor = p.querySelector("a.pg-text-link")!;
    expect(anchor.textContent).toBe("o wor");
    expect(anchor.querySelector("s")).not.toBeNull();
    expect(anchor.parentElement).toBe(p);
    expect(p.textContent).toBe("Hello world");
  });

  it("the markup of a text is never parsed: typed tags and Markdown stay literal", () => {
    const p = renderText("<s>x</s> <u>y</u> **b**");
    expect(p.textContent).toBe("<s>x</s> <u>y</u> **b**");
    expect(p.children).toHaveLength(0);
  });
});

describe("M9-11 aligned paragraphs", () => {
  const html = (value: string, marks: unknown[]) => render(publishedDoc(textBlock(value, marks)));

  it("a block with an align mark draws every line as a span; the line breaks are not text", () => {
    const p = renderText("a\nb\n\nc", [mark("align", 0, 1, { align: "center" })]);
    const lines = [...p.querySelectorAll(":scope > span.pg-text-line")];
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.textContent)).toEqual(["a", "b", "", "c"]);
    expect(lines.map((line) => line.getAttribute("data-align"))).toEqual([
      "center",
      null,
      null,
      null,
    ]);
    expect(p.textContent).toBe("abc");
    expect(p.textContent).not.toContain("\n");
    expect(p.children).toHaveLength(4);
    expect(p.getAttribute("class")).toBe("pg-text");
  });

  it("writes data-align from the closed list for all three words, never a style", () => {
    const p = renderText("one\ntwo\nthree", [
      mark("align", 0, 3, { align: "left" }),
      mark("align", 4, 7, { align: "center" }),
      mark("align", 8, 13, { align: "right" }),
    ]);
    expect(
      [...p.querySelectorAll("span.pg-text-line")].map((l) => l.getAttribute("data-align")),
    ).toEqual(["left", "center", "right"]);
    expect(p.innerHTML).not.toContain("style");
  });

  it("a hostile align value never reaches the markup", () => {
    for (const value of ['center"><script>alert(1)</script>', "justify", "left; color:red"]) {
      const doc = publishedDoc(textBlock("hello", [mark("align", 0, 5, { align: "center" })]));
      // The stored form is parsed by the schema, so a bad value never gets here; the renderer still holds.
      (doc.blocks[0] as unknown as { marks: unknown[] }).marks = [
        mark("align", 0, 5, { align: value }),
      ];
      const out = render(doc);
      expect(out).not.toContain("<script");
      expect(out).not.toContain("justify");
      expect(out).not.toContain("color:red");
      expect(out).not.toContain('data-align="center"><');
    }
  });

  it("formatting inside lines: marks are cut at the line break", () => {
    const p = renderText("ab\ncd", [mark("bold", 1, 4), mark("align", 0, 2, { align: "right" })]);
    const lines = [...p.querySelectorAll("span.pg-text-line")];
    expect(lines.map((line) => line.innerHTML)).toEqual([
      "a<strong>b</strong>",
      "<strong>c</strong>d",
    ]);
  });

  it("links keep their anchors inside a line", () => {
    const p = renderText("go here\nnext", [
      mark("link", 3, 7, { id: L1, url: "https://example.com/x" }),
      mark("align", 8, 12, { align: "center" }),
    ]);
    const anchor = p.querySelector("a.pg-text-link")!;
    expect(anchor.getAttribute("href")).toBe(`/r/${PAGE_ID}/${L1}`);
    expect(anchor.closest("span.pg-text-line")!.textContent).toBe("go here");
  });

  it("parity: the preview, the live page and the share view draw the same block", () => {
    const doc = publishedDoc(
      textBlock("one two\nthree\n\nfour", [
        mark("strike", 0, 3),
        mark("underline", 4, 7),
        mark("align", 8, 13, { align: "center" }),
        mark("align", 15, 19, { align: "right" }),
      ]),
    );
    const live = render(doc, { mode: "live" });
    const preview = render(doc, { mode: "preview" });
    const shared = render(doc, { mode: "preview", inertEmbeds: true });
    expect(preview).toBe(live);
    expect(shared).toBe(live);
    expect(paragraph(live).outerHTML).toBe(paragraph(preview).outerHTML);
  });

  it("changing only an alignment changes the published form", () => {
    const a = publishedDoc(textBlock("one\ntwo", [mark("align", 4, 7, { align: "center" })]));
    const b = publishedDoc(textBlock("one\ntwo", [mark("align", 4, 7, { align: "right" })]));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(html("one\ntwo", [mark("align", 4, 7, { align: "center" })])).not.toBe(
      html("one\ntwo", [mark("align", 4, 7, { align: "right" })]),
    );
  });
});

describe("M9-11 the stylesheet", () => {
  const tokens = noirTokens;
  const css = (types: string[]) =>
    tenantInlineCss({ blocks: types.map((type) => ({ type })), tokens });

  it("holds the line rules only when the page has a text block", () => {
    expect(css(["text"])).toContain(".pg-text-line");
    expect(css(["text"])).toContain('.pg-text-line[data-align="center"]');
    expect(css(["link", "header"])).not.toContain(".pg-text-line");
    expect(css(["link"])).not.toContain("pg-text");
  });

  it("two pages with the same block types get the same style bytes, whatever the text", () => {
    const a = css(["text", "link"]);
    const b = css(["link", "text"]);
    expect(a).toBe(b);
    // The text and its marks reach the markup, never the stylesheet.
    const one = render(publishedDoc(textBlock("one", [mark("align", 0, 3, { align: "right" })])));
    const two = render(publishedDoc(textBlock("another one\ntwo", [mark("strike", 0, 3)])));
    const style = (html: string) => /<style[\s\S]*?<\/style>/.exec(html)?.[0] ?? "";
    expect(style(one)).toBe(style(two));
  });

  it("the new rules use no color literal, no media query and no --hl- variable", () => {
    const rules = css(["text"]);
    const lineRules = rules.slice(rules.indexOf(".pg-text-line"));
    const own = lineRules.slice(0, lineRules.indexOf(".pg-text-link"));
    expect(own).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(own).not.toContain("@media");
    expect(own).not.toContain("--hl-");
    expect(own).not.toMatch(/\bstyle\b/);
  });

});
