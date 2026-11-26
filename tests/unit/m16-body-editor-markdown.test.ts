// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Token, Tokens } from "marked";
import { decodeEntities, lexMarkdown } from "@/lib/blog/markdown";
import {
  bodyBytes,
  canEditRich,
  fromMarkdown,
  toMarkdown,
} from "@/components/posts/body-editor/markdown";
import { LOSSY, SUPPORTED } from "./support/body-editor-corpus";

/**
 * The post body is Markdown, edited in Tiptap (M16-13). What the rich editor can hold it must give
 * back byte for byte; everything else opens in the plain Markdown box and is never rewritten.
 */

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

describe("text typed like Markdown block syntax stays text (it is escaped at the line start)", () => {
  const para = (...content: unknown[]) => ({ type: "paragraph", content });
  const text = (value: string) => ({ type: "text", text: value });
  const doc = (...content: unknown[]) => ({ type: "doc", content });
  const textOf = (node: unknown): string => {
    const held = node as { text?: string; content?: unknown[]; type?: string };
    if (held.type === "hardBreak") return "\n";
    return (held.text ?? "") + (held.content ?? []).map(textOf).join("");
  };

  const TYPED = [
    "# text",
    "###### six",
    "#",
    "> not a quote",
    ">tight",
    "- not a list",
    "+ not a list",
    "1. not a list",
    "12) not a list",
    "---",
    "- - -",
    "===",
  ];
  for (const typed of TYPED) {
    it(`a paragraph typed as ${JSON.stringify(typed)} reopens in the rich editor as the same text`, () => {
      const written = toMarkdown(doc(para(text(typed))) as never);
      expect(canEditRich(written), written).toBe(true);
      const back = fromMarkdown(written);
      expect(back.content).toHaveLength(1);
      expect(back.content![0]!.type).toBe("paragraph");
      expect(textOf(back)).toBe(typed);
      expect(toMarkdown(back)).toBe(written);
    });
  }

  it("a line after a hard break is a line start too (no setext heading, no rule)", () => {
    for (const second of ["---", "===", "# x", "- x"]) {
      const written = toMarkdown(
        doc(para(text("Title"), { type: "hardBreak" }, text(second))) as never,
      );
      expect(canEditRich(written), written).toBe(true);
      const back = fromMarkdown(written);
      expect(back.content!.map((node) => node.type)).toEqual(["paragraph"]);
      expect(textOf(back)).toBe(`Title\n${second}`);
    }
  });

  it("the same inside a list item and a quote", () => {
    const item = { type: "listItem", content: [para(text("# in a list"))] };
    const list = toMarkdown(doc({ type: "bulletList", content: [item] }) as never);
    expect(canEditRich(list), list).toBe(true);
    expect(textOf(fromMarkdown(list))).toBe("# in a list");
    const quote = toMarkdown(
      doc({ type: "blockquote", content: [para(text("1. quoted"))] }) as never,
    );
    expect(canEditRich(quote), quote).toBe(true);
    expect(textOf(fromMarkdown(quote))).toBe("1. quoted");
  });

  it("escapes nothing that is not syntax, so ordinary text is written as typed", () => {
    for (const plain of ["#hashtag first", "-5 degrees", "1.5 litres", "a # b - c = d", "+1"]) {
      expect(toMarkdown(doc(para(text(plain))) as never)).toBe(plain);
    }
  });

  it("real headings, lists, quotes and rules are written as before", () => {
    const body = "## Heading\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n---\n\nEnd.";
    expect(toMarkdown(fromMarkdown(body))).toBe(body);
  });
});

describe("a URL typed in the rich editor is stored as typed (finding 2)", () => {
  const typed = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const EMBED = "https://www.youtube.com/watch?v=a_bcdEFG_12";

  it("a bare URL with _, * and ~ gets no backslashes, and reopens in the rich editor", () => {
    for (const url of [EMBED, "https://example.com/a_b*c~d", "http://x.example/~me/notes_1"]) {
      const md = toMarkdown(typed(url));
      expect(md).toBe(url);
      expect(canEditRich(md)).toBe(true);
      // Reopened it is a link whose text is its address; written again it is the same bytes.
      const doc = fromMarkdown(md);
      expect(doc.content?.[0]?.content?.[0]).toMatchObject({
        text: url,
        marks: [{ type: "link", attrs: { href: url } }],
      });
      expect(toMarkdown(doc)).toBe(url);
    }
  });

  it("a URL inside a sentence: only the URL is left as typed, the rest is escaped as before", () => {
    const md = toMarkdown(typed("see https://a.example/x_y_z, then *b* and c_d"));
    expect(md).toBe("see https://a.example/x_y_z, then \\*b\\* and c\\_d");
    expect(canEditRich(md)).toBe(true);
  });

  it("the stored bare URL is the one paragraph the live page turns into an embed", async () => {
    const { bareUrlOf, lexMarkdown } = await import("@/lib/blog/markdown");
    const [token] = lexMarkdown(toMarkdown(typed(EMBED)));
    expect(bareUrlOf(token!)).toBe(EMBED);
  });

  it("a URL whose trailing punctuation the serializer would escape is written as typed when marked reads it back the same (no backslash in the address)", () => {
    // Before: "www.example.com/a\\*b\\*", which marked read as a link to ".../a\\*b\\".
    const md = toMarkdown(typed("www.example.com/a*b*"));
    expect(md).toBe("www.example.com/a*b*");
    expect(drawn(md)).toEqual({
      text: "www.example.com/a*b*",
      links: ["http://www.example.com/a*b"],
    });
  });

  it("a bare link after a spaceless word longer than 4,096 characters is still a link (CJK)", () => {
    const word = "字".repeat(5000);
    for (const [text, href, written] of [
      ["https://a.co/x_y", "https://a.co/x_y", "<https://a.co/x_y>"],
      ["www.a.co", "http://www.a.co", "[www.a.co](http://www.a.co)"],
    ] as const) {
      const link = { type: "text", text, marks: [{ type: "link", attrs: { href, title: null } }] };
      const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: word }, link, { type: "text", text: " after" }] }] };
      const md = toMarkdown(doc);
      expect(md).toBe(`${word}${written} after`);
      expect(fromMarkdown(md).content![0]!.content!.slice(1)).toEqual([link, { type: "text", text: " after" }]);
    }
  });

  it("a link with its own text, and code, are written as before", () => {
    const link = "A [read_me](https://example.com/a_b) here.";
    expect(toMarkdown(fromMarkdown(link))).toBe("A [read\\_me](https://example.com/a_b) here.");
    expect(toMarkdown(fromMarkdown("Run `https://a.example/x_y` now."))).toBe(
      "Run `https://a.example/x_y` now.",
    );
  });
});

/**
 * One paragraph as `PostBody` draws it: its visible text, and the href of every link. Any token a
 * typed text must never become (emphasis, a link with its own text, an image, HTML, a block other
 * than one paragraph) is reported by name, so the comparison fails on it.
 */
function drawn(markdown: string): { text: string; links: string[] } {
  const blocks = lexMarkdown(markdown);
  if (blocks.length !== 1 || blocks[0]!.type !== "paragraph") {
    return { text: `<blocks ${blocks.map((b) => b.type).join(",")}>`, links: [] };
  }
  let text = "";
  const links: string[] = [];
  for (const token of (blocks[0] as Tokens.Paragraph).tokens as Token[]) {
    if (token.type === "text") text += decodeEntities((token as Tokens.Text).text);
    else if (token.type === "escape") text += (token as Tokens.Escape).text;
    else if (token.type === "link" && (token as Tokens.Link).text === token.raw) {
      // An autolink: its text is what was typed, and nothing in it is read as an entity.
      text += decodeEntities((token as Tokens.Link).text);
      links.push((token as Tokens.Link).href);
    } else text += `<${token.type} ${JSON.stringify(token.raw)}>`;
  }
  return { text, links };
}

const plain = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** The property: typed text is drawn as exactly that text, and writing it is stable. */
function expectTypedStaysText(text: string) {
  const md = toMarkdown(plain(text));
  const out = drawn(md);
  expect(out.text, JSON.stringify(md)).toBe(text);
  for (const href of out.links) {
    // An autolink only of an address typed verbatim (`www.` gains its http://, an email mailto:).
    const typedAs = href.replace(/^http:\/\/(?=www\.)/, "").replace(/^mailto:/, "");
    expect(text, `link ${href} in ${JSON.stringify(md)}`).toContain(typedAs);
  }
  expect(toMarkdown(fromMarkdown(md)), JSON.stringify(md)).toBe(md);
}

describe("typed text never becomes a link or emphasis it did not say (adversarial pass, finding 1)", () => {
  const REPROS = [
    "Contact WWW.a.co/[click](https://evil.example)",
    "foo@www.a.co/[click](https://evil.example)",
    "wwW.a.co/*x*y",
    "HTTPS://a.co/[x](https://evil.example)",
    "see www.a.co/![i](https://evil.example/i.png) now",
    "https://a.co/?x=1&amp;y=2",
    "https://a.co/?x=1&#38;y=2",
    "https://a.co/x_",
    "https://a.co/x*",
    "https://a.co/x<b>*y*</b>",
    "https://a.co/x)*_a_ and more",
    "ftp://a.co/[x](https://evil.example)",
    "a_b@c.co and foo@www.a.co",
  ];
  for (const text of REPROS) {
    it(`${JSON.stringify(text)} is drawn as typed, with no link it did not type`, () => {
      expectTypedStaysText(text);
    });
  }

  it("the reported repros carry no link to evil.example and no emphasis", () => {
    for (const text of REPROS.slice(0, 3)) {
      const out = drawn(toMarkdown(plain(text)));
      expect(out.links.filter((href) => href.includes("evil"))).toEqual([]);
      expect(out.text).not.toMatch(/<em|<strong|<link|<image/);
    }
  });

  it("a URL with an entity in it is text, not a link whose text differs from its address, and reopens rich", () => {
    for (const text of ["https://a.co/?x=1&amp;y=2", "https://a.co/?x=1&#38;y=2"]) {
      const md = toMarkdown(plain(text));
      expect(drawn(md)).toEqual({ text, links: [] });
      expect(canEditRich(md)).toBe(true);
    }
  });

  it("a URL ending in _ or * is a link to the address marked takes, with no backslash in it", () => {
    expect(drawn(toMarkdown(plain("https://a.co/x_")))).toEqual({
      text: "https://a.co/x_",
      links: ["https://a.co/x"],
    });
    expect(drawn(toMarkdown(plain("https://a.co/x*")))).toEqual({
      text: "https://a.co/x*",
      links: ["https://a.co/x"],
    });
  });

  it("italic text holding a URL with * keeps its whole text in the emphasis (no truncated href)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see https://a.co/x*y more*z", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    const md = toMarkdown(doc);
    const [para] = lexMarkdown(md) as Tokens.Paragraph[];
    expect(para!.tokens.map((t) => t.type)).toEqual(["em"]);
    const em = para!.tokens[0] as Tokens.Em;
    expect(em.tokens.some((t) => t.type === "link")).toBe(false);
    expect(fromMarkdown(md).content?.[0]?.content?.[0]).toMatchObject({
      text: "see https://a.co/x*y more*z",
    });
    expect(toMarkdown(fromMarkdown(md))).toBe(md);
  });

  it("a URL right before another inline node is not left to run into it", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "go https://a.co/x" },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    const md = toMarkdown(doc);
    const [para] = lexMarkdown(md) as Tokens.Paragraph[];
    expect(para!.tokens.filter((t) => t.type === "link")).toEqual([]);
    expect(para!.tokens.at(-1)?.type).toBe("strong");
  });

  it("randomised: any mix of *_~[]()<>&\\, URL prefixes and @ is drawn as typed and written stably", () => {
    const PIECES = [
      ..."*_~[]()<>&\\".split(""),
      "http://",
      "https://",
      "www.",
      "WWW.",
      "@",
      "a",
      "co",
      ".",
      "/",
      " ",
      "x.co",
      "amp;",
      "#38;",
    ];
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    for (let i = 0; i < 2000; i += 1) {
      let text = "";
      const length = 1 + Math.floor(random() * 24);
      for (let j = 0; j < length; j += 1) text += PIECES[Math.floor(random() * PIECES.length)];
      // Leading and trailing spaces, and runs of them, are the paragraph's, not the text's. "t "
      // first: a line that starts like "co) " is read by the editor's list tokenizer as an
      // alphabetic list item (a line-start question, not a URL one; recorded for the owner).
      text = `t ${text.replace(/ +/g, " ").trim()}`.trim();
      expectTypedStaysText(text);
    }
  });
});
