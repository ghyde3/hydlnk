// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/core";
import { bodySchema } from "@/components/posts/body-editor/extensions";
import { canEditRich, fromMarkdown, toMarkdown } from "@/components/posts/body-editor/markdown";
import { lexBounded } from "@/lib/blog/markdown";
import { LOSSY, SUPPORTED } from "./support/body-editor-corpus";
import { ATTACKS, REALISTIC, fit, reseed } from "./support/markdown-families";

/**
 * The post body editor reads a body with the bounded lexer only (M16-04, M16-13): the loss guard
 * walks its tokens, the editor's document is built from them, and the serializer asks it how a URL
 * will read back. Nothing in the author's tab lexes with marked, which is quadratic on bodies the
 * lexer accepts (24 KB of `*a ` took 10.7 s in `canEditRich` through marked).
 *
 *   (a) parity: the document built from our tokens equals the one `MarkdownManager.parse` (marked's
 *       lexer, then the same token handlers) builds, on the editor's corpus and the realistic
 *       families;
 *   (b) time: `canEditRich` on the attack families finishes under 1 s, and so does writing any
 *       attack text followed by a URL (the serializer's read-back windows are bounded).
 */

const NBSP = " ";
const unix = (body: string) => body.replace(/\r\n?/g, "\n");

/** The document as the library builds it from marked's tokens (the old `fromMarkdown`). */
const reference = new MarkdownManager({ extensions: bodySchema() });
const viaMarked = (body: string): JSONContent => reference.parse(unix(body));

function elapsed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("the editor's document from our tokens equals the one marked's tokens give", () => {
  for (const [name, body] of Object.entries({ ...SUPPORTED, ...LOSSY })) {
    it(name, () => {
      expect(fromMarkdown(body), JSON.stringify(body)).toEqual(viaMarked(body));
    });
  }

  it("line endings are read as the editor reads them", () => {
    for (const body of ["One.\r\n\r\nTwo.\r\n", "a\rb", "- a\r\n- b"]) {
      expect(fromMarkdown(body)).toEqual(viaMarked(body));
    }
  });

  for (const [name, { gen }] of Object.entries(REALISTIC)) {
    it(`realistic: ${name}`, () => {
      for (const n of [1, 3, 12]) {
        reseed();
        const body = gen(n);
        expect(fromMarkdown(body), `${name} x ${n}`).toEqual(viaMarked(body));
      }
    });
  }

  it("a tight numbered item's text is a paragraph of its inline tokens (marks, links, breaks)", () => {
    const item = (body: string) => (fromMarkdown(body).content![0]!.content![0]!.content![0] as JSONContent).content;
    expect(item("1. **a** [l](https://a.co)")).toEqual([
      { type: "text", text: "a", marks: [{ type: "bold" }] },
      { type: "text", text: " " },
      { type: "text", text: "l", marks: [{ type: "link", attrs: { href: "https://a.co", title: null } }] },
    ]);
    // Tiptap's own ordered-list tokenizer keeps the continuation line's indent (" b"); the lexer, as
    // marked and CommonMark do, does not. The body is not held rich either way (the serializer drops
    // the indent, for bullet lists too).
    expect(item("1. a  \n   b")).toEqual([{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }]);
    expect(canEditRich("1. a  \n   b")).toBe(canEditRich("- a  \n  b"));
  });

  it("the lexer's tokens are not changed by building a document", () => {
    const body = "1. *a*\n2. b";
    const before = JSON.stringify(lexBounded(body));
    fromMarkdown(body);
    expect(JSON.stringify(lexBounded(body))).toBe(before);
  });

  it("a body the lexer refuses is never built into a document (it would be saved empty)", () => {
    const deep = "> ".repeat(200) + "a";
    expect(canEditRich(deep)).toBe(false);
    expect(() => fromMarkdown(deep)).toThrow();
  });
});

describe("the loss guard is fast on the bodies marked is quadratic on", () => {
  const BODIES: Record<string, string> = {
    '"*a " x 8000 (24 KB)': "*a ".repeat(8000),
    "[a]( + 4,800 NBSP": `[a](${NBSP.repeat(4800)}`,
    "the wide table (6,000 x 3,000)": ATTACKS["wide table 6,000 x 3,000"]!(0),
    "nested emphasis (24 KB)": ATTACKS["nested emphasis"]!(24_000),
    "nested emphasis (512 KiB)": fit(ATTACKS["nested emphasis"]!(512 * 1024)),
  };
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: canEditRich answers in under 1 s`, () => {
      let verdict: boolean | undefined;
      const ms = elapsed(() => (verdict = canEditRich(body)));
      expect(typeof verdict).toBe("boolean");
      expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(1000);
    });
  }

  it("every attack family at 64 KiB: canEditRich answers in under 1 s", () => {
    for (const [name, gen] of Object.entries(ATTACKS)) {
      const body = fit(gen(64 * 1024), 64 * 1024);
      const ms = elapsed(() => canEditRich(body));
      expect(ms, `${name}: ${ms.toFixed(0)} ms`).toBeLessThan(1000);
    }
  }, 120_000);
});

describe("writing text is fast: the serializer reads a URL back over a bounded window", () => {
  const paragraph = (text: string): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("any attack text (64 KiB, one text node) followed by a URL is written in under 1 s", () => {
    for (const [name, gen] of Object.entries(ATTACKS)) {
      const text = `${fit(gen(64 * 1024), 64 * 1024).replace(/[\r\n]/g, " ")} https://example.com/x_y`;
      let written = "";
      const ms = elapsed(() => (written = toMarkdown(paragraph(text))));
      expect(written.endsWith(" https://example.com/x_y"), name).toBe(true);
      expect(ms, `${name}: ${ms.toFixed(0)} ms`).toBeLessThan(1000);
    }
  }, 120_000);

  it("a 512 KiB word, many URL runs in one word, and many runs in a long word stay fast", () => {
    const TEXTS = {
      "a 512 KiB word then a URL": `${"*".repeat(512 * 1024)}https://example.com/a`,
      "URL runs split by <, one 512 KiB word": "https://a.co/x<".repeat((512 * 1024) / 15),
      "4,000-char words of runs and stars":
        `${"https://a.co<".repeat(300)}${"*".repeat(4000)} `.repeat(64),
    };
    for (const [name, text] of Object.entries(TEXTS)) {
      const ms = elapsed(() => toMarkdown(paragraph(text)));
      expect(ms, `${name}: ${ms.toFixed(0)} ms`).toBeLessThan(1000);
    }
  });

  it("a URL after a long paragraph of ordinary text is still written as typed", () => {
    const text = `${"words and more words ".repeat(2000)}see https://example.com/a_b*c~d`;
    expect(toMarkdown(paragraph(text)).endsWith(" https://example.com/a_b*c~d")).toBe(true);
  });
});
