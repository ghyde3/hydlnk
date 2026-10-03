// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer, type PageRendererProps } from "@/components/page/page-renderer";
import { toPublishForm, type Block, type DraftDoc, type PublishDoc } from "@/lib/document";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

/**
 * M6-28: the renderer. The text itself is never parsed: no marks means literal text; marks draw
 * <strong>, <em> and <a> around React text nodes; a link points at the click redirect and never
 * carries its destination in the markup.
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const TEXT_ID = "text-render-0001";
const L1 = "link-render-0001";
const L2 = "link-render-0002";

const bold = (start: number, end: number) => ({ type: "bold", start, end });
const italic = (start: number, end: number) => ({ type: "italic", start, end });
const link = (start: number, end: number, id = L1, url = "https://example.com/book?x=1") => ({
  type: "link",
  start,
  end,
  id,
  url,
});

function textBlock(value: string, marks?: unknown[], extra: Record<string, unknown> = {}): Block {
  return {
    id: TEXT_ID,
    type: "text",
    visible: true,
    text: value,
    ...(marks ? { marks } : {}),
    ...extra,
  } as unknown as Block;
}

function publishedDoc(...list: Block[]): PublishDoc {
  return toPublishForm(draftWith(...list) as DraftDoc, noirTokens);
}

function render(doc: PublishDoc, props: Partial<Omit<PageRendererProps, "doc">> = {}): string {
  return renderToStaticMarkup(
    createElement(PageRenderer, { doc, pageId: PAGE_ID, mode: "live", ...props }),
  );
}

const paragraph = (html: string): HTMLElement =>
  new DOMParser()
    .parseFromString(`<body>${html}</body>`, "text/html")
    .querySelector<HTMLElement>("p.pg-text")!;

const renderText = (
  value: string,
  marks?: unknown[],
  props: Partial<Omit<PageRendererProps, "doc">> = {},
) => paragraph(render(publishedDoc(textBlock(value, marks)), props));

describe("M6-28 a text block with no marks renders literally", () => {
  const SYNTAX = "**bold** _italic_ <b>x</b> https://example.com javascript:alert(1)";

  it("shows Markdown, HTML and URLs as plain text: no strong, em, a, no auto-link", () => {
    const p = renderText(SYNTAX);
    expect(p.textContent).toBe(SYNTAX);
    expect(p.querySelector("strong, em, a, b, i, u, script, img")).toBeNull();
    expect(p.children).toHaveLength(0);
    expect(p.childNodes).toHaveLength(1);
  });

  it("escapes the markup in the HTML string itself", () => {
    const html = render(publishedDoc(textBlock(SYNTAX)));
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<strong");
    expect(html).not.toContain("<em");
    expect(html).not.toMatch(/<a[\s>]/);
  });

  it("keeps the line breaks of the text and relies on pre-line, not <br>", () => {
    const p = renderText("one\ntwo\n\nthree");
    expect(p.textContent).toBe("one\ntwo\n\nthree");
    expect(p.querySelector("br")).toBeNull();
  });

  it("the M2-16 escaping examples hold", () => {
    for (const value of [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "&lt;already&gt; & \"quoted\" 'single'",
      "</p><p class='pg-text'>fake",
    ]) {
      const html = render(publishedDoc(textBlock(value)));
      const p = paragraph(html);
      expect(p.textContent).toBe(value);
      expect(p.children).toHaveLength(0);
      expect(html).not.toContain("<script");
      expect(html).not.toMatch(/<img/);
    }
  });

  it("renders the same markup as before for a block without marks", () => {
    const html = render(publishedDoc(textBlock("Plain")));
    expect(html).toContain(
      `<p class="pg-text" data-block-id="${TEXT_ID}" data-block-type="text">Plain</p>`,
    );
  });
});

describe("M6-28 marks draw strong, em and a", () => {
  it("bold wraps the range in <strong>", () => {
    const p = renderText("Hello world", [bold(6, 11)]);
    expect(p.innerHTML).toBe("Hello <strong>world</strong>");
  });

  it("italic wraps the range in <em>", () => {
    expect(renderText("Hello world", [italic(0, 5)]).innerHTML).toBe("<em>Hello</em> world");
  });

  it("overlapping bold and italic ranges nest as <strong><em>", () => {
    expect(renderText("Hello world", [bold(0, 11), italic(6, 11)]).innerHTML).toBe(
      "<strong>Hello </strong><strong><em>world</em></strong>",
    );
    expect(renderText("Hello", [bold(0, 5), italic(0, 5)]).innerHTML).toBe(
      "<strong><em>Hello</em></strong>",
    );
  });

  it("two bold ranges that touch are one <strong>", () => {
    expect(renderText("Hello world", [bold(0, 5), bold(5, 11)]).innerHTML).toBe(
      "<strong>Hello world</strong>",
    );
  });

  it("a link is an anchor to the click redirect with rel nofollow noopener", () => {
    const p = renderText("Book a session now", [link(5, 14)]);
    const anchor = p.querySelector("a")!;
    expect(anchor.textContent).toBe("a session");
    expect(anchor.getAttribute("href")).toBe(`/r/${PAGE_ID}/${L1}`);
    expect(anchor.getAttribute("rel")).toBe("nofollow noopener");
    expect(anchor.className).toBe("pg-text-link");
    expect(anchor.getAttributeNames().sort()).toEqual(["class", "href", "rel"]);
    expect(p.textContent).toBe("Book a session now");
  });

  it("the destination is never in the markup", () => {
    const html = render(
      publishedDoc(
        textBlock("Book a session now", [
          link(5, 14, L1, "https://secret-destination.example/path?token=1"),
        ]),
      ),
    );
    expect(html).not.toContain("secret-destination");
    expect(html).not.toContain("token=1");
    expect(html).toContain(`/r/${PAGE_ID}/${L1}`);
  });

  it("a link with formatting inside stays one anchor", () => {
    const p = renderText("Book a session now", [link(5, 18), bold(11, 18)]);
    expect(p.querySelectorAll("a")).toHaveLength(1);
    expect(p.querySelector("a")!.innerHTML).toBe("a sess<strong>ion now</strong>");
  });

  it("bold across a link boundary is split, with the link between", () => {
    const p = renderText("Book a session now", [bold(0, 18), link(5, 6)]);
    expect(p.querySelectorAll("a")).toHaveLength(1);
    expect(p.textContent).toBe("Book a session now");
    expect(p.querySelector("a")!.innerHTML).toBe("<strong>a</strong>");
  });

  it("two links give two anchors with their own ids", () => {
    const p = renderText("one two three", [
      link(0, 3, L1, "https://a.example"),
      link(8, 13, L2, "https://b.example"),
    ]);
    expect([...p.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      `/r/${PAGE_ID}/${L1}`,
      `/r/${PAGE_ID}/${L2}`,
    ]);
  });

  it("every piece of text is escaped, link text included", () => {
    const value = "x <img src=x onerror=alert(1)> y";
    const html = render(publishedDoc(textBlock(value, [link(2, 30), bold(0, 1)])));
    const p = paragraph(html);
    expect(p.textContent).toBe(value);
    expect(p.querySelector("img")).toBeNull();
    expect(p.querySelector("a")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toMatch(/<img/);
  });

  it("an emoji is one position in the renderer too", () => {
    const p = renderText("a\u{1F44D}b", [bold(1, 2)]);
    expect(p.innerHTML).toBe("a<strong>\u{1F44D}</strong>b");
  });

  it("marks that point past the end never throw and draw what fits", () => {
    const doc = publishedDoc(textBlock("Hello", [bold(3, 5)]));
    // A document built by hand with marks the Publish form would have clipped.
    const raw = {
      ...doc,
      blocks: [
        {
          ...doc.blocks[0],
          marks: [
            bold(-4, 2),
            italic(3, 99),
            bold(0.5, 1.5),
            { type: "bold" },
            null,
            "x",
            link(4, 9, L1, "https://a.example"),
          ],
        },
      ],
    } as unknown as PublishDoc;
    expect(() => render(raw)).not.toThrow();
    expect(() => render(raw, { mode: "preview" })).not.toThrow();
    const p = paragraph(render(raw));
    expect(p.textContent).toBe("Hello");
  });

  it("a link with an unusable address draws no anchor (a draft in the preview)", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user@host.example/",
      "",
      "not a url",
    ]) {
      const raw = publishedDoc(textBlock("Hello world", [link(0, 5, L1, "https://ok.example")]));
      const doc = {
        ...raw,
        blocks: [{ ...raw.blocks[0], marks: [link(0, 5, L1, url)] }],
      } as unknown as PublishDoc;
      const p = paragraph(render(doc, { mode: "preview" }));
      expect(p.querySelector("a"), url).toBeNull();
      expect(p.textContent).toBe("Hello world");
      expect(render(doc)).not.toContain("javascript:");
    }
  });

  it("the dock thumbnail draws the link as an inert span, never an anchor", () => {
    const html = render(publishedDoc(textBlock("Book a session now", [link(5, 14)])), {
      thumbnail: true,
      mode: "preview",
    });
    const p = paragraph(html);
    expect(p.querySelector("a")).toBeNull();
    expect(p.querySelector("span.pg-text-link")?.textContent).toBe("a session");
    expect(html).not.toContain("/r/");
  });
});

describe("M6-28 parity: the preview and the live page draw the same markup", () => {
  it("is identical in both modes for every kind of mark", () => {
    const doc = publishedDoc(
      textBlock("Hello big world, book a session now\nsecond line", [
        bold(0, 5),
        italic(3, 9),
        link(17, 27),
        bold(28, 40),
      ]),
    );
    expect(render(doc, { mode: "preview" })).toBe(render(doc, { mode: "live" }));
  });

  it("the form built from a draft renders the same as the same form read back", () => {
    const draft = draftWith(textBlock("  Hello world ", [bold(2, 7), link(8, 13)])) as DraftDoc;
    const form = toPublishForm(draft, noirTokens);
    const stored = JSON.parse(JSON.stringify(form)) as PublishDoc;
    expect(render(stored)).toBe(render(form));
    expect(paragraph(render(form)).innerHTML).toContain("<strong>Hello</strong>");
  });
});

describe("M6-28 the stylesheet", () => {
  it("styles links with the accent color, underlined, with padding for a 44px box", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/components/page/page-renderer.css", "utf8");
    const rule = /\[data-page-root\] \.pg-text-link \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/color:\s*var\(--t-accent\)/);
    expect(rule).toMatch(/text-decoration:\s*underline/);
    expect(rule).toMatch(/padding-block:\s*(1[4-9]|[2-9]\d)px/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    // No color literals in the text rules, and the block still wraps long words and keeps line breaks.
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    const text = /\[data-page-root\] \.pg-text \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(text).toMatch(/white-space:\s*pre-line/);
    expect(text).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("M6-28 fixture sanity", () => {
  it("the standard text block of the fixtures still renders as plain text", () => {
    const p = paragraph(render(publishedDoc(blocks.text as Block)));
    expect(p.children).toHaveLength(0);
  });
});
