/**
 * The rich editor's Markdown corpus (M16-13): bodies it holds byte for byte (`SUPPORTED`) and bodies
 * it cannot hold, which open in the plain Markdown box (`LOSSY`). Shared by the round-trip tests
 * and the parity of the editor's document with marked's (m17-body-editor-tokens).
 */

export const IMAGE = "https://x.example/storage/v1/object/public/page-media/u/f.webp";

export const SUPPORTED: Record<string, string> = {
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
  // A tight numbered item keeps its inline formatting (Tiptap's ordered list reads its own tokens).
  "numbered list with marks, a link and code": "1. **bold** and [l](https://a.co) `c`\n2. two",
  "numbered list with an escape": "1. a\\~b",
  "numbered list with an entity": "1. a &amp; b",
  "numbered list in a bullet list": "- one\n  1. nested *x*\n- two",
  "numbered list in a numbered list": "1. one\n   1. *two*",
  "numbered list in a quote": "> 1. *q*\n> 2. ~~r~~",
  "numbered list from 3": "3. **x**",
  quote: "> Quoted words.",
  "code block": "```\nconst a = 1;\n```",
  "code block with a language": "```js\nlet a = 1;\n```",
  "inline code": "Run `pnpm verify` first.",
  rule: "Above.\n\n---\n\nBelow.",
  "hard break": "line one  \nline two",
  image: `![A photo](${IMAGE})`,
  "image in a paragraph": `Before ![alt](${IMAGE}) after.`,
  "image in a numbered list": `1. ![alt](${IMAGE})`,
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

export const LOSSY: Record<string, string> = {
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

/** The editor's document pieces, as `fromMarkdown` builds them (marks in the order it gives). */
type Doc = { type: "doc"; content: unknown[] };
const doc = (...content: unknown[]): Doc => ({ type: "doc", content });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, ...marks: string[]) =>
  marks.length > 0 ? { type: "text", text: value, marks: marks.map((type) => ({ type })) } : { type: "text", text: value };
const link = (value: string, href: string) => ({ type: "text", text: value, marks: [{ type: "link", attrs: { href, title: null } }] });
const hardBreak = { type: "hardBreak" };
const item = (...content: unknown[]) => ({ type: "listItem", content });
const emptyItem = item({ type: "paragraph", content: [] });
const bullets = (...items: unknown[]) => ({ type: "bulletList", content: items });
const numbers = (...items: unknown[]) => ({ type: "orderedList", content: items });

/**
 * Documents the rich editor can hold whose Markdown the live page used to read differently (third
 * adversarial pass, findings 4 and 5): each is written, lexed and read back as `reads` (itself
 * unless given), and written again to the same bytes.
 */
export const DOCUMENTS: Record<string, { doc: Doc; reads?: Doc }> = {
  // Overlapping marks: nested Markdown, never HTML (the page draws HTML as text).
  "bold a, bold and italic b, italic c": { doc: doc(para(text("a", "bold"), text("b", "italic", "bold"), text("c", "italic"))) },
  "the same, then a letter": { doc: doc(para(text("x "), text("a", "bold"), text("b", "italic", "bold"), text("c", "italic"), text("d"))) },
  "strike a, strike and bold b, bold c": { doc: doc(para(text("a", "strike"), text("b", "bold", "strike"), text("c", "bold"))) },
  "italic a, italic and strike b, strike c": { doc: doc(para(text("a", "italic"), text("b", "strike", "italic"), text("c", "strike"))) },
  "italic a, bold and italic b, bold c, a full stop": { doc: doc(para(text("a", "italic"), text("b", "bold", "italic"), text("c", "bold"), text("."))) },
  // A line after a hard break that is a setext underline, "--" included, stays text.
  "a signature: Thanks, / -- / Gary": { doc: doc(para(text("Thanks,"), hardBreak, text("--"), hardBreak, text("Gary"))) },
  "a line of = after a hard break": { doc: doc(para(text("Title"), hardBreak, text("=="))) },
  "a paragraph of two dashes": { doc: doc(para(text("--"))) },
  // Empty list items are dropped on save, in both kinds of list: Markdown cannot say one under an
  // item's text, nor as a first numbered item, and the library's writer threw on an empty numbered one.
  "a nested empty bullet": {
    doc: doc(bullets(item(para(text("a")), bullets(emptyItem)))),
    reads: doc(bullets(item(para(text("a"))))),
  },
  "an empty first numbered item": {
    doc: doc(numbers(emptyItem, item(para(text("b"))))),
    reads: doc(numbers(item(para(text("b"))))),
  },
  "an empty last numbered item": {
    doc: doc(numbers(item(para(text("a"))), emptyItem)),
    reads: doc(numbers(item(para(text("a"))))),
  },
  "an empty middle bullet": {
    doc: doc(bullets(item(para(text("a"))), emptyItem, item(para(text("c"))))),
    reads: doc(bullets(item(para(text("a"))), item(para(text("c"))))),
  },
  "a list of only empty items": { doc: doc(para(text("x")), bullets(emptyItem, emptyItem)), reads: doc(para(text("x"))) },
  // Bare links followed by text keep their address (finding 4).
  "a bare link, then text that would lengthen it": { doc: doc(para(link("http://x.co", "http://x.co"), text(".evil.example/path"))) },
  "a www link, then a letter": { doc: doc(para(link("www.x.co", "http://www.x.co"), text("m"))) },
  "two bare links side by side": { doc: doc(para(link("http://a.co", "http://a.co"), link("http://b.co", "http://b.co"))) },
  "a bare link, then an @ and a domain": { doc: doc(para(link("http://a.co", "http://a.co"), text("@b.co"))) },
  "a link whose address has an unbalanced )": { doc: doc(para(link("t", "http://x.co/a)b"), text(" after"))) },
  "a link whose address has an unbalanced (": { doc: doc(para(link("t", "http://x.co/a(b"), text(" and "), link("u", "https://x.co/(c)d)"))) },
};
