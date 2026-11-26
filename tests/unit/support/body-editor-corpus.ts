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
