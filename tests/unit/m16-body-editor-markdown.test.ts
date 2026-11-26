// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  bodyBytes,
  canEditRich,
  fromMarkdown,
  toMarkdown,
} from "@/components/posts/body-editor/markdown";

/**
 * The post body is Markdown, edited in Tiptap (M16-13). What the rich editor can hold it must give
 * back byte for byte; everything else opens in the plain Markdown box and is never rewritten.
 */

const IMAGE = "https://x.example/storage/v1/object/public/page-media/u/f.webp";

const SUPPORTED: Record<string, string> = {
  paragraph: "Just a paragraph.",
  "two paragraphs": "One.\n\nTwo.",
  "heading 2": "## A heading",
  "headings 3 and 4": "### Third\n\n#### Fourth",
  bold: "Some **bold** text.",
  italic: "Some *italic* text.",
  strike: "Some ~~struck~~ text.",
  "bold and italic": "Both ***at once*** here.",
  link: "A [link](https://example.com/a?b=1&c=2) here.",
  "bold link": "A [**bold link**](https://example.com) here.",
  "extra blank lines": "One.\n\n\n\nTwo.",
  "bullet list": "- one\n- two\n- three",
  "numbered list": "1. first\n2. second\n3. third",
  "nested list": "- a\n  - nested\n- b",
  quote: "> Quoted words.",
  "code block": "```\nconst a = 1;\n```",
  "code block with a language": "```js\nlet a = 1;\n```",
  "inline code": "Run `pnpm verify` first.",
  rule: "Above.\n\n---\n\nBelow.",
  "hard break": "line one  \nline two",
  image: `![A photo](${IMAGE})`,
  "image in a paragraph": `Before ![alt](${IMAGE}) after.`,
  everything: [
    "## Heading",
    "A paragraph with **bold**, *italic*, ~~strike~~ and a [link](https://example.com).",
    "- one\n- two",
    "1. first\n2. second",
    "> quoted",
    "```\ncode here\n```",
    "---",
    `![alt](${IMAGE})`,
    "End.",
  ].join("\n\n"),
};

describe("the Markdown round trip of the rich editor", () => {
  for (const [name, markdown] of Object.entries(SUPPORTED)) {
    it(`${name}: toMarkdown(fromMarkdown(x)) === x`, () => {
      expect(toMarkdown(fromMarkdown(markdown))).toBe(markdown);
      expect(canEditRich(markdown)).toBe(true);
    });
  }

  it("an empty body is editable and stays empty", () => {
    expect(canEditRich("")).toBe(true);
    expect(toMarkdown(fromMarkdown(""))).toBe("");
  });

  it("line endings and a final newline do not send a body to source mode", () => {
    expect(canEditRich("One.\r\n\r\nTwo.\r\n")).toBe(true);
    expect(canEditRich("One.\n\nTwo.\n")).toBe(true);
  });
});

describe("the loss guard: what the rich editor cannot hold opens as plain Markdown", () => {
  const LOSSY: Record<string, string> = {
    table: "| a | b |\n| - | - |\n| 1 | 2 |",
    "block HTML": '<div class="x">raw</div>',
    "inline HTML": "Some <b>bold</b> text.",
    "an HTML comment": "Text\n\n<!-- note -->",
    "heading 1": "# Title",
    "heading 5": "##### Small",
    "setext heading": "Title\n-----",
    "task list": "- [ ] todo\n- [x] done",
    footnote: "A claim.[^1]\n\n[^1]: The source.",
    "link with a title": '[a](https://example.com "Title")',
    "reference link": "[a][ref]\n\n[ref]: https://example.com",
    "javascript link": "[x](javascript:alert(1))",
    "mailto link": "[x](mailto:a@example.com)",
    "star bullets": "* one\n* two",
    "underscore emphasis": "__bold__ and _it_",
    "indented code": "    code by indent",
    "image with a title": `![a](${IMAGE} "T")`,
    "escaped characters the editor would rewrite": "Escapes 1\\. and \\<b>",
    "bold around a link, the other way round": "A **[bold link](https://example.com)** here.",
  };
  for (const [name, markdown] of Object.entries(LOSSY)) {
    it(name, () => {
      expect(canEditRich(markdown)).toBe(false);
    });
  }

  it("never throws on hostile input", () => {
    for (const body of ["\u0000", "[".repeat(5000), "> ".repeat(2000), "```", "![](", "<script>"]) {
      expect(typeof canEditRich(body)).toBe("boolean");
    }
  });
});

describe("bodyBytes", () => {
  it("counts UTF-8 bytes, as the schema does", () => {
    expect(bodyBytes("")).toBe(0);
    expect(bodyBytes("abc")).toBe(3);
    expect(bodyBytes("é")).toBe(2);
    expect(bodyBytes("😀")).toBe(4);
  });
});
