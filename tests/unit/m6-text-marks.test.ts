import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  clipMarks,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  textSegments,
  toPublishForm,
  type Block,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { blockRowSummary } from "@/components/blocks/summary";
import { blocks, draftWith, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M6-28: bold, italic and links in text blocks: the schema, the publish form, the Publish gate and
 * the defenses (clipping, never throwing, no raw HTML). Offsets are code points of the text.
 */

const URL_MESSAGE = "Enter a full web address, like https://example.com.";
const TEXT_ID = "text-marks-0001";
const L1 = "link-mark-00001";
const L2 = "link-mark-00002";

const text = (value: string, marks?: unknown, extra: Record<string, unknown> = {}) =>
  ({
    id: TEXT_ID,
    type: "text",
    visible: true,
    text: value,
    ...(marks ? { marks } : {}),
    ...extra,
  }) as unknown as Block;

const bold = (start: number, end: number) => ({ type: "bold", start, end });
const italic = (start: number, end: number) => ({ type: "italic", start, end });
const link = (start: number, end: number, id = L1, url = "https://example.com/book") => ({
  type: "link",
  start,
  end,
  id,
  url,
});

const draftOf = (...list: Block[]) => draftWith(...list) as DraftDoc;
const form = (...list: Block[]) => toPublishForm(draftOf(...list), noirTokens);
const textOf = (doc: PublishDoc) => doc.blocks[0] as unknown as { text: string; marks?: unknown[] };

describe("M6-28 the limits", () => {
  it("allows 30 marks and 10 links per text block", () => {
    expect(LIMITS.textMarks).toBe(30);
    expect(LIMITS.textLinks).toBe(10);
  });
});

describe("M6-28 a text block without marks is exactly what it was", () => {
  it("parses, publishes and stays free of a marks key", () => {
    const draft = draftOf(text("Plain text"));
    expect(draftDocSchema.safeParse(draft).success).toBe(true);
    expect(publishDocSchema.safeParse(draft).success).toBe(true);
    const published = toPublishForm(draft, noirTokens);
    expect(textOf(published)).toEqual({
      id: TEXT_ID,
      type: "text",
      visible: true,
      text: "Plain text",
    });
    expect("marks" in textOf(published)).toBe(false);
    expect(publishedDocSchema.safeParse(published).success).toBe(true);
  });

  it("an empty marks list publishes without the key too, and equals a plain block", () => {
    const plain = form(text("Plain text"));
    const empty = form(text("Plain text", []));
    expect("marks" in textOf(empty)).toBe(false);
    expect(publishFormsEqual(plain, empty)).toBe(true);
  });

  it("the full fixture still publishes and parses", () => {
    const published = toPublishForm(fullDraft, noirTokens);
    expect(publishedDocSchema.safeParse(published).success).toBe(true);
    expect(publishFormsEqual(published, publishedDocSchema.parse(published))).toBe(true);
  });

  it("the block row title is the plain text, whatever the marks", () => {
    const long =
      "The quick brown fox jumps over the lazy dog, again and again and again, until it stops";
    const plain = blockRowSummary(text(long) as never);
    const marked = blockRowSummary(text(long, [bold(0, 9), link(10, 15)]) as never);
    expect(marked).toEqual(plain);
    expect(plain.title).toBe(long.slice(0, 60));
  });
});

describe("M6-28 toPublishForm trims the text and shifts, clips, sorts and drops marks", () => {
  const publishedMarks = (raw: string, marks: unknown[]) => {
    const block = textOf(form(text(raw, marks)));
    return { text: block.text, marks: block.marks };
  };

  it("'  Hello world ' with bold 2 to 7 gives 'Hello world' and bold 0 to 5", () => {
    expect(publishedMarks("  Hello world ", [bold(2, 7)])).toEqual({
      text: "Hello world",
      marks: [bold(0, 5)],
    });
  });

  it("a mark entirely inside the trimmed whitespace is dropped, and the key goes with it", () => {
    expect(publishedMarks("  Hello  ", [bold(0, 2)])).toEqual({ text: "Hello", marks: undefined });
    expect(publishedMarks("  Hello  ", [bold(7, 9)])).toEqual({ text: "Hello", marks: undefined });
  });

  it("a mark that touches the whitespace is clipped to the text", () => {
    expect(publishedMarks("  Hello  ", [bold(0, 4)]).marks).toEqual([bold(0, 2)]);
    expect(publishedMarks("  Hello  ", [italic(4, 9)]).marks).toEqual([italic(2, 5)]);
  });

  it("offsets count code points: an emoji is one position", () => {
    expect(publishedMarks("a\u{1F44D}b", [bold(1, 2)])).toEqual({
      text: "a\u{1F44D}b",
      marks: [bold(1, 2)],
    });
    expect(textSegments("a\u{1F44D}b", [bold(1, 2)]).map((s) => [s.text, s.bold])).toEqual([
      ["a", false],
      ["\u{1F44D}", true],
      ["b", false],
    ]);
    // Trimming in front of an emoji shifts by whole code points.
    expect(publishedMarks("  \u{1F44D}\u{1F44D}x", [bold(2, 3)]).marks).toEqual([bold(0, 1)]);
  });

  it("CRLF becomes LF before offsets are read", () => {
    expect(publishedMarks("a\r\nb", [bold(2, 3)])).toEqual({ text: "a\nb", marks: [bold(2, 3)] });
    expect(publishedMarks("a\r\nb\r\nc", [bold(4, 5)])).toEqual({
      text: "a\nb\nc",
      marks: [bold(4, 5)],
    });
  });

  it("sorts by position, then bold, italic, link", () => {
    const sorted = publishedMarks("Hello world again", [
      link(12, 17),
      italic(6, 11),
      bold(6, 11),
      bold(0, 5),
    ]);
    expect(sorted.marks).toEqual([bold(0, 5), bold(6, 11), italic(6, 11), link(12, 17)]);
  });

  it("drops empty and inverted marks", () => {
    expect(publishedMarks("Hello", [bold(2, 2), italic(4, 1), bold(0, 3)]).marks).toEqual([
      bold(0, 3),
    ]);
  });

  it("drops the later of two overlapping links", () => {
    const result = publishedMarks("Hello world again", [
      link(6, 17, L2, "https://b.example"),
      link(0, 8, L1, "https://a.example"),
    ]);
    expect(result.marks).toEqual([link(0, 8, L1, "https://a.example")]);
  });

  it("keeps touching links and a link inside bold", () => {
    const result = publishedMarks("Hello world", [link(0, 5, L1), link(5, 11, L2), bold(0, 11)]);
    expect(result.marks).toEqual([link(0, 5, L1), bold(0, 11), link(5, 11, L2)]);
  });

  it("trims a link's address and keeps only known keys", () => {
    const result = publishedMarks("Hello", [
      {
        ...link(0, 5),
        url: "  https://example.com/x  ",
        href: "javascript:alert(1)",
        style: "color:red",
        class: "x",
      },
    ]);
    expect(result.marks).toEqual([link(0, 5, L1, "https://example.com/x")]);
  });

  it("an all-whitespace text publishes no marks", () => {
    expect(publishedMarks("   ", [bold(0, 3)]).marks).toBeUndefined();
  });

  it("is deterministic: two equal drafts give equal forms", () => {
    const a = form(text("Hello world", [italic(6, 11), bold(0, 5)]));
    const b = form(text("Hello world", [bold(0, 5), italic(6, 11)]));
    expect(a).toEqual(b);
  });

  it("a change to the marks changes the form (the status chip reads 'Unpublished changes')", () => {
    const before = form(text("Hello world", [bold(0, 5)]));
    const after = form(text("Hello world", [bold(0, 5), italic(6, 11)]));
    expect(publishFormsEqual(before, after)).toBe(false);
    expect(publishFormsEqual(before, form(text("Hello world", [bold(0, 5)])))).toBe(true);
    // Marks that publish to nothing do not count as a change.
    expect(
      publishFormsEqual(form(text("Hello world")), form(text("Hello world", [bold(3, 3)]))),
    ).toBe(true);
  });

  it("never throws on any input", () => {
    for (const marks of [
      null,
      "x",
      7,
      [
        null,
        1,
        "x",
        [],
        {},
        { type: "bold" },
        { type: "bold", start: "a", end: 2 },
        { type: "link", start: 0, end: 2 },
        { type: "nope", start: 0, end: 1 },
      ],
      [
        bold(-5, 3),
        bold(2, 99),
        bold(Number.NaN, 2),
        bold(0.5, 2.5),
        bold(Number.POSITIVE_INFINITY, 4),
        bold(-Infinity, 2),
      ],
    ]) {
      expect(() => form(text("Hello world", marks as never))).not.toThrow();
      expect(() => textSegments("Hello world", marks)).not.toThrow();
      expect(() => clipMarks(marks, 11)).not.toThrow();
    }
  });
});

describe("M6-28 out-of-range, negative and non-integer offsets are clipped, never an error", () => {
  it.each([
    ["past the end", [bold(3, 50)], [bold(3, 5)]],
    ["entirely past the end", [bold(9, 12)], []],
    ["negative start", [bold(-4, 3)], [bold(0, 3)]],
    ["entirely negative", [bold(-4, -1)], []],
    ["non-integer", [bold(0.9, 2.9)], [bold(0, 2)]],
    ["a fraction that rounds to nothing", [bold(2.2, 2.9)], []],
    ["start after end", [bold(4, 1)], []],
  ])("%s", (_name, marks, expected) => {
    expect(clipMarks(marks, 5)).toEqual(expected);
    const published = textOf(form(text("Hello", marks)));
    expect(published.marks).toEqual(expected.length > 0 ? expected : undefined);
    // The draft with such marks still parses, and Publish accepts it (the form is clipped).
    expect(draftDocSchema.safeParse(draftOf(text("Hello", marks))).success).toBe(true);
    expect(publishDocSchema.safeParse(draftOf(text("Hello", marks))).success).toBe(true);
    // The renderer's cutting never throws and covers the whole text.
    const segments = textSegments("Hello", marks);
    expect(segments.map((s) => s.text).join("")).toBe("Hello");
  });

  it("caps what the renderer will cut at 30 marks and 10 links", () => {
    const many = Array.from({ length: 60 }, (_, i) => bold(i % 5, (i % 5) + 1));
    expect(clipMarks(many, 5)).toHaveLength(LIMITS.textMarks);
    const links = Array.from({ length: 20 }, (_, i) =>
      link(i, i + 1, `link-mark-${String(i).padStart(5, "0")}`),
    );
    expect(clipMarks(links, 20).filter((m) => m.type === "link")).toHaveLength(LIMITS.textLinks);
  });
});

describe("M6-28 the Publish gate is strict about each mark", () => {
  const errorsOf = (...list: Block[]) => collectPublishErrors(draftOf(...list));
  const messages = (...list: Block[]) => errorsOf(...list).map((error) => error.message);

  it("accepts a well-formed text with every kind of mark", () => {
    expect(errorsOf(text("Hello world again", [bold(0, 5), italic(0, 5), link(6, 11)]))).toEqual(
      [],
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user@host.example/",
    "https://user:pw@host.example/",
    "ftp://example.com/x",
    "//example.com/x",
    "example.com/x",
    "https://exa mple.com",
    "mailto:a@b.co",
    "",
    "https://" + "a".repeat(2100) + ".example/",
  ])("a link to %j fails with the URL sentence, on the link", (url) => {
    const errors = errorsOf(text("Hello world", [link(0, 5, L1, url)]));
    expect(errors).toEqual([{ blockId: TEXT_ID, itemId: L1, field: "url", message: URL_MESSAGE }]);
  });

  it("a 4000-character link fails with the URL sentence, and a draft still keeps it", () => {
    const url = `https://example.com/${"a".repeat(3980)}`;
    expect(url).toHaveLength(4000);
    expect(draftDocSchema.safeParse(draftOf(text("Hello", [link(0, 5, L1, url)]))).success).toBe(
      true,
    );
    expect(errorsOf(text("Hello", [link(0, 5, L1, url)]))).toEqual([
      { blockId: TEXT_ID, itemId: L1, field: "url", message: URL_MESSAGE },
    ]);
  });

  it("a link id must follow the block id rule", () => {
    for (const id of ["short", "has spaces here", "x".repeat(25), "bad/slash/id1", ""]) {
      const result = draftDocSchema.safeParse(draftOf(text("Hello", [link(0, 5, id)])));
      expect(result.success, id).toBe(false);
    }
  });

  it("a link id must be unique across the whole page, blocks and items included", () => {
    const twoLinks = text("Hello world", [link(0, 5, L1), link(6, 11, L1)]);
    expect(errorsOf(twoLinks)).toEqual([
      { blockId: TEXT_ID, itemId: L1, field: "id", message: "Ids must be unique within a page." },
    ]);
    // The same id as another block.
    const other = { ...blocks.header, id: L1 } as Block;
    expect(messages(text("Hello", [link(0, 5, L1)]), other)).toContain(
      "Ids must be unique within a page.",
    );
    // The same id as a block's own id.
    expect(messages(text("Hello", [link(0, 5, TEXT_ID)]))).toContain(
      "Ids must be unique within a page.",
    );
    // The same id as a social icon or a grid cell.
    const social = blocks.social as unknown as { icons: { id: string }[] };
    expect(
      messages(text("Hello", [link(0, 5, social.icons[0]!.id)]), blocks.social as Block),
    ).toContain("Ids must be unique within a page.");
    // Link ids in two different text blocks.
    const second = { ...text("World", [link(0, 5, L1)]), id: "text-marks-0002" } as Block;
    expect(messages(text("Hello", [link(0, 5, L1)]), second)).toContain(
      "Ids must be unique within a page.",
    );
  });

  it("two overlapping links fail on the later one", () => {
    const errors = errorsOf(text("Hello world again", [link(6, 17, L2), link(0, 8, L1)]));
    expect(errors).toEqual([
      {
        blockId: TEXT_ID,
        itemId: L2,
        field: "start",
        message: "Links can’t overlap. Remove the other link first.",
      },
    ]);
  });

  it("touching links and a link inside bold are fine", () => {
    expect(errorsOf(text("Hello world", [link(0, 5, L1), link(5, 11, L2), bold(0, 11)]))).toEqual(
      [],
    );
  });

  it("more than 10 links fails, 10 is fine", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        link(i, i + 1, `link-mark-${String(i).padStart(5, "0")}`),
      );
    expect(errorsOf(text("x".repeat(30), make(10)))).toEqual([]);
    expect(errorsOf(text("x".repeat(30), make(11)))).toEqual([
      { blockId: TEXT_ID, field: "marks", message: "Use up to 10 links in one text block." },
    ]);
  });

  it("more than 30 marks fails, 30 is fine", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => bold(i, i + 1));
    expect(errorsOf(text("x".repeat(60), make(30)))).toEqual([]);
    expect(errorsOf(text("x".repeat(60), make(31)))).toEqual([
      { blockId: TEXT_ID, field: "marks", message: "This text has too much formatting." },
    ]);
  });

  it("700 link marks never publish and are refused quickly", () => {
    const marks = Array.from({ length: 700 }, (_, i) =>
      link(i % 590, (i % 590) + 1, `link-${String(i).padStart(6, "0")}`),
    );
    const started = performance.now();
    const errors = errorsOf(text("x".repeat(600), marks));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatchObject({ blockId: TEXT_ID, field: "marks" });
  });

  it("another type is refused, extra keys are stripped", () => {
    const refused = errorsOf(text("Hello", [{ type: "underline", start: 0, end: 3 }]));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ blockId: TEXT_ID, field: "marks" });
    const parsed = draftDocSchema.parse(
      draftOf(
        text("Hello", [
          { ...bold(0, 3), href: "x", style: "color:red", class: "y" },
          { ...link(0, 3), style: "z" },
        ]),
      ),
    );
    const marks = (parsed.blocks[0] as unknown as { marks: Record<string, unknown>[] }).marks;
    expect(marks[0]).toEqual(bold(0, 3));
    expect(Object.keys(marks[1]!).sort()).toEqual(["end", "id", "start", "type", "url"]);
  });

  it("a hidden block is exempt from the mark rules, like every other field", () => {
    const hidden = text("Hello", [link(0, 5, L1, "javascript:alert(1)")], { visible: false });
    expect(errorsOf(hidden)).toEqual([]);
    expect(form(hidden).blocks).toEqual([]);
  });

  it("the other blocks' errors are unchanged by marks", () => {
    const errors = errorsOf(text("Hello", [link(0, 5, L1, "javascript:alert(1)")]), {
      ...blocks.link,
      url: "",
    } as Block);
    expect(errors.map((e) => `${e.blockId}/${e.itemId ?? "-"}/${e.field}`)).toEqual([
      `${TEXT_ID}/${L1}/url`,
      `${blocks.link.id}/-/url`,
    ]);
  });
});

describe("M6-28 the stored published form must already be canonical", () => {
  const publishedWith = (marks: unknown[], value = "Hello world") => {
    const doc = form(text(value));
    (doc.blocks[0] as unknown as { marks: unknown[] }).marks = marks;
    return doc;
  };

  it("accepts what toPublishForm produced", () => {
    expect(
      publishedDocSchema.safeParse(form(text("  Hello world ", [bold(2, 7), link(8, 13)]))).success,
    ).toBe(true);
  });

  it.each([
    ["past the end", [bold(0, 99)]],
    ["negative", [bold(-1, 3)]],
    ["non-integer", [bold(0.5, 3)]],
    ["empty", [bold(3, 3)]],
    ["inverted", [bold(5, 2)]],
  ])("refuses a mark %s", (_name, marks) => {
    expect(publishedDocSchema.safeParse(publishedWith(marks)).success).toBe(false);
  });

  it("refuses a link with another scheme and two overlapping links", () => {
    expect(
      publishedDocSchema.safeParse(publishedWith([link(0, 5, L1, "javascript:alert(1)")])).success,
    ).toBe(false);
    expect(
      publishedDocSchema.safeParse(publishedWith([link(0, 6, L1), link(4, 9, L2)])).success,
    ).toBe(false);
  });

  it("refuses a link id that repeats a block id", () => {
    expect(publishedDocSchema.safeParse(publishedWith([link(0, 5, TEXT_ID)])).success).toBe(false);
  });
});

describe("M6-28 no raw HTML anywhere: structured marks only", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it("no source file uses dangerouslySetInnerHTML or writes innerHTML", () => {
    const hits = walk(join(process.cwd(), "src"))
      .filter((file) =>
        /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => file.slice(process.cwd().length + 1));
    // The only allowed uses are outside the tenant renderer and the editor's text form; list them to
    // keep any new one a conscious decision.
    for (const file of hits) {
      expect(file, "raw HTML in the renderer or the text form").not.toMatch(
        /src\/components\/page\/|src\/components\/blocks\/forms\/text-form|src\/lib\/document\//,
      );
    }
  });

  it("package.json has no Markdown or HTML parsing or sanitizing dependency", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    const banned =
      /^(marked|markdown-it|remark.*|rehype.*|unified|mdast.*|micromark.*|showdown|snarkdown|commonmark|html-react-parser|react-markdown|sanitize-html|dompurify|isomorphic-dompurify|parse5|htmlparser2|cheerio|turndown|slate|lexical|@tiptap\/.*|prosemirror.*|quill|draft-js)$/;
    expect(names.filter((name) => banned.test(name))).toEqual([]);
  });

  it("the marks module and the renderer never parse the text", () => {
    for (const file of [
      "src/lib/document/marks.ts",
      "src/lib/document/marks-edit.ts",
      "src/components/page/blocks.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(source, file).not.toMatch(
        /DOMParser|createContextualFragment|new\s+Function|\beval\(|document\.write/,
      );
    }
  });
});
