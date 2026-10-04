import { describe, expect, it } from "vitest";
import {
  LIMITS,
  MARK_MESSAGES,
  clipMarks,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  salvageMarks,
  sortMarks,
  textLines,
  textSegments,
  toPublishForm,
  type Block,
  type DraftDoc,
  type Mark,
  type PublishDoc,
} from "@/lib/document";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import { urlFieldsOf as draftUrlFields } from "@/lib/blocklist/fields";
import { blockedLinksInPublished } from "@/lib/blocklist/published";
import { blockRowSummary } from "@/components/blocks/summary";
import { draftWith, noirTokens } from "./fixtures/page-document";

/**
 * M9-11: strikethrough, underline and paragraph alignment in text blocks: the marks model, the
 * Publish gate and the publish form. Offsets are code points of the text.
 */

const TEXT_ID = "text-m9marks-001";
const L1 = "link-m9marks-0001";
const L2 = "link-m9marks-0002";
const SENTENCE = "This text has formatting that can’t be published.";
const TOO_MUCH = "This text has too much formatting.";

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
const strike = (start: number, end: number) => ({ type: "strike", start, end });
const underline = (start: number, end: number) => ({ type: "underline", start, end });
const align = (start: number, end: number, value: unknown = "center") => ({
  type: "align",
  start,
  end,
  align: value,
});
const link = (start: number, end: number, id = L1, url = "https://example.com/book") => ({
  type: "link",
  start,
  end,
  id,
  url,
});

const draftOf = (...list: Block[]) => draftWith(...list) as DraftDoc;
const form = (...list: Block[]) => toPublishForm(draftOf(...list), noirTokens);
const textOf = (doc: PublishDoc) => doc.blocks[0] as unknown as { text: string; marks?: Mark[] };
const errorsOf = (...list: Block[]) => collectPublishErrors(draftOf(...list));

describe("M9-11 the limits", () => {
  it("keeps 30 inline marks and 10 links, and allows 20 alignments apart", () => {
    expect(LIMITS.textMarks).toBe(30);
    expect(LIMITS.textLinks).toBe(10);
    expect(LIMITS.textAligns).toBe(20);
    expect(LIMITS.text).toBe(600);
    expect(LIMITS.draftBytes).toBe(262144);
  });
});

describe("M9-11 toPublishForm shifts, clips and snaps the new marks", () => {
  const published = (raw: string, marks: unknown[]) => {
    const block = textOf(form(text(raw, marks)));
    return { text: block.text, marks: block.marks };
  };

  it("'  Hello world ' with strike 2 to 7 gives 'Hello world' and strike 0 to 5", () => {
    expect(published("  Hello world ", [strike(2, 7)])).toEqual({
      text: "Hello world",
      marks: [strike(0, 5)],
    });
    expect(published("  Hello world ", [underline(2, 7)])).toEqual({
      text: "Hello world",
      marks: [underline(0, 5)],
    });
  });

  it("an emoji is one position", () => {
    expect(published("a\u{1F44D}b", [underline(1, 2)])).toEqual({
      text: "a\u{1F44D}b",
      marks: [underline(1, 2)],
    });
    expect(
      textSegments("a\u{1F44D}b", [underline(1, 2)]).map((s) => [s.text, s.underline]),
    ).toEqual([
      ["a", false],
      ["\u{1F44D}", true],
      ["b", false],
    ]);
  });

  it("an align mark becomes the whole line that holds its start", () => {
    // "one\ntwo\nthree": lines 0 to 3, 4 to 7 and 8 to 13.
    expect(published("one\ntwo\nthree", [align(5, 6)]).marks).toEqual([align(4, 7)]);
    expect(published("one\ntwo\nthree", [align(4, 7, "right")]).marks).toEqual([
      align(4, 7, "right"),
    ]);
    // A mark that runs over several lines is the line it starts on.
    expect(published("one\ntwo\nthree", [align(1, 12, "left")]).marks).toEqual([
      align(0, 3, "left"),
    ]);
    // A position just before a line break belongs to the line that break ends.
    expect(published("one\ntwo\nthree", [align(3, 5)]).marks).toEqual([align(0, 3)]);
  });

  it("two align marks on one line become one: the later wins", () => {
    expect(published("one\ntwo", [align(0, 1, "left"), align(1, 3, "right")]).marks).toEqual([
      align(0, 3, "right"),
    ]);
    expect(published("one\ntwo", [align(1, 3, "right"), align(0, 1, "left")]).marks).toEqual([
      align(0, 3, "left"),
    ]);
  });

  it("an align mark on an empty line or on trimmed whitespace is dropped", () => {
    expect(published("one\n\nthree", [align(4, 5)])).toEqual({
      text: "one\n\nthree",
      marks: undefined,
    });
    expect(published("  one", [align(0, 2)])).toEqual({ text: "one", marks: undefined });
    expect(published("one  ", [align(3, 5)])).toEqual({ text: "one", marks: undefined });
  });

  it("CRLF becomes LF before lines are read", () => {
    expect(published("one\r\ntwo", [align(4, 5)]).marks).toEqual([align(4, 7)]);
  });

  it("the result is sorted: position, then bold, italic, strike, underline, link, align", () => {
    const result = published("Hello world again\nsecond", [
      align(0, 17, "center"),
      link(0, 5),
      underline(0, 5),
      strike(0, 5),
      italic(0, 5),
      bold(0, 5),
      align(18, 24, "right"),
    ]).marks!;
    expect(result.map((m) => m.type)).toEqual([
      "bold",
      "italic",
      "strike",
      "underline",
      "link",
      "align",
      "align",
    ]);
    expect(
      sortMarks([underline(2, 4), strike(2, 4), align(0, 9), bold(2, 4)] as Mark[]).map(
        (m) => m.type,
      ),
    ).toEqual(["align", "bold", "strike", "underline"]);
  });

  it("two equal drafts give deep-equal publish forms, and publishing a published text changes nothing", () => {
    const marks = [align(1, 2, "right"), strike(0, 3), underline(2, 6), link(7, 9)];
    const a = form(text("  one two three\nfour", marks));
    const b = form(text("  one two three\nfour", JSON.parse(JSON.stringify(marks))));
    expect(a).toEqual(b);
    const once = textOf(a);
    const again = textOf(form(text(once.text, once.marks)));
    expect(again).toEqual(once);
  });

  it("a text without the new marks publishes exactly as before", () => {
    const plain = textOf(form(text("Plain text")));
    expect("marks" in plain).toBe(false);
    const classic = textOf(form(text("Hello world", [bold(0, 5), italic(6, 11), link(0, 5, L2)])));
    expect(classic.marks!.map((m) => m.type)).toEqual(["bold", "link", "italic"]);
  });

  it("caps alignments at 20 and inline marks at 30 apart", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `l${i}`).join("\n");
    const starts: number[] = [];
    let at = 0;
    for (const line of lines.split("\n")) {
      starts.push(at);
      at += line.length + 1;
    }
    const aligns = starts.map((start) => align(start, start + 1, "right"));
    const inline = Array.from({ length: 40 }, (_, i) => bold(i, i + 1));
    const result = published(lines, [...inline, ...aligns]).marks!;
    expect(result.filter((m) => m.type === "align")).toHaveLength(LIMITS.textAligns);
    expect(result.filter((m) => m.type !== "align")).toHaveLength(LIMITS.textMarks);
  });
});

describe("M9-11 the Publish gate: types, keys, alignments, counts", () => {
  it("accepts every new mark", () => {
    expect(
      errorsOf(
        text("Hello world\nsecond", [strike(0, 5), underline(6, 11), align(12, 18, "left")]),
      ),
    ).toEqual([]);
  });

  it.each(["code", "highlight", "color", "font", "justify"])(
    "another type (%s) fails with the formatting sentence",
    (type) => {
      const errors = errorsOf(text("Hello", [{ type, start: 0, end: 3 }]));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ blockId: TEXT_ID, field: "marks", message: SENTENCE });
    },
  );

  it("an align value other than the three words fails with the same sentence", () => {
    for (const value of ["justify", "CENTER", "", 3, null, 'center"><script>alert(1)</script>']) {
      const errors = errorsOf(text("Hello", [align(0, 5, value)]));
      expect(errors, String(value)).toHaveLength(1);
      expect(errors[0]).toMatchObject({ blockId: TEXT_ID, field: "marks", message: SENTENCE });
    }
    const missing = errorsOf(text("Hello", [{ type: "align", start: 0, end: 5 }]));
    expect(missing[0]).toMatchObject({ field: "marks", message: SENTENCE });
  });

  it("extra keys (style, class, href, color) are stripped", () => {
    const parsed = publishDocSchema.parse(
      draftOf(
        text("Hello", [
          { ...underline(0, 3), style: "x", class: "y", href: "z", color: "red" },
          { ...align(0, 5), style: "text-align:right" },
        ]),
      ),
    );
    const marks = (parsed.blocks[0] as unknown as { marks: Record<string, unknown>[] }).marks;
    expect(marks[0]).toEqual(underline(0, 3));
    expect(Object.keys(marks[1]!).sort()).toEqual(["align", "end", "start", "type"]);
  });

  it("more than 30 inline marks or 20 align marks fails with 'too much formatting'", () => {
    const many = Array.from({ length: 31 }, (_, i) => strike(i, i + 1));
    expect(errorsOf(text("x".repeat(60), many))[0]).toMatchObject({
      field: "marks",
      message: TOO_MUCH,
    });
    const lines = Array.from({ length: 21 }, () => "ab").join("\n");
    const aligns = Array.from({ length: 21 }, (_, i) => align(i * 3, i * 3 + 2));
    expect(errorsOf(text(lines, aligns))[0]).toMatchObject({ field: "marks", message: TOO_MUCH });
    // 30 inline marks and 20 alignments together are within the rules.
    const okLines = Array.from({ length: 20 }, () => "ab").join("\n");
    const okAligns = Array.from({ length: 20 }, (_, i) => align(i * 3, i * 3 + 2));
    const okInline = Array.from({ length: 30 }, (_, i) => underline(i, i + 1));
    expect(errorsOf(text(okLines, [...okInline, ...okAligns]))).toEqual([]);
  });

  it("the draft schema keeps lenient positions and takes 30 inline and 20 align marks", () => {
    const okLines = Array.from({ length: 20 }, () => "ab").join("\n");
    const draft = draftOf(
      text(okLines, [
        ...Array.from({ length: 30 }, (_, i) => bold(i, i + 1)),
        ...Array.from({ length: 20 }, (_, i) => align(i * 3, i * 3 + 2, "right")),
        strike(-5, 99999),
      ]),
    );
    // 31 inline marks: refused by the draft too, as before.
    expect(draftDocSchema.safeParse(draft).success).toBe(false);
    const fine = draftOf(
      text(okLines, [
        ...Array.from({ length: 30 }, (_, i) => bold(i, i + 1)),
        ...Array.from({ length: 20 }, (_, i) => align(i * 3, i * 3 + 2, "right")),
      ]),
    );
    expect(draftDocSchema.safeParse(fine).success).toBe(true);
    expect(draftDocSchema.safeParse(draftOf(text("Hello", [strike(-5, 99999.5)]))).success).toBe(
      true,
    );
  });

  it("links keep every rule: http(s) only, at most 10, never overlapping", () => {
    expect(errorsOf(text("Hello", [link(0, 5, L1, "javascript:alert(1)")]))[0]).toMatchObject({
      itemId: L1,
      field: "url",
    });
    expect(errorsOf(text("Hello world", [link(0, 6, L1), link(4, 9, L2), strike(0, 3)]))).toEqual([
      expect.objectContaining({ itemId: L2, field: "start", message: MARK_MESSAGES.overlap }),
    ]);
    const marks = Array.from({ length: 11 }, (_, i) =>
      link(i * 2, i * 2 + 1, `link-many-${String(i).padStart(4, "0")}`),
    );
    expect(errorsOf(text("x".repeat(30), marks))[0]).toMatchObject({
      field: "marks",
      message: MARK_MESSAGES.tooManyLinks,
    });
  });

  it("a hidden block with hostile new marks does not stop Publish", () => {
    const hidden = text(
      "Hello",
      [align(0, 5, 'center"><script>alert(1)</script>'), link(0, 5, L1, "javascript:alert(1)")],
      { visible: false },
    );
    expect(errorsOf(hidden)).toEqual([]);
    expect(form(hidden).blocks).toEqual([]);
  });

  it("an offset that is negative, fractional, past the end or inverted is normalized, never an error", () => {
    const text1 = "Hello world\nsecond";
    for (const marks of [
      [strike(-5, 3)],
      [underline(0.5, 3.9)],
      [align(-3, 99)],
      [align(7.5, 8.5, "right")],
      [strike(5, 2)],
      [underline(3, 3)],
      [{ type: "strike", start: Number.NaN, end: 3 }],
      [{ type: "align", start: 0, end: Number.POSITIVE_INFINITY, align: "left" }],
    ]) {
      const result = textOf(form(text(text1, marks)));
      for (const mark of result.marks ?? []) {
        expect(Number.isInteger(mark.start) && Number.isInteger(mark.end)).toBe(true);
        expect(mark.start).toBeGreaterThanOrEqual(0);
        expect(mark.end).toBeLessThanOrEqual(Array.from(text1).length);
        expect(mark.start).toBeLessThan(mark.end);
      }
    }
  });
});

describe("M9-11 the stored published form holds whole-line, non-overlapping alignments", () => {
  const publishedWith = (marks: unknown[], value = "one\ntwo\nthree") => {
    const doc = form(text(value));
    (doc.blocks[0] as unknown as { marks: unknown[] }).marks = marks;
    return doc;
  };

  it("accepts what toPublishForm produced", () => {
    expect(
      publishedDocSchema.safeParse(
        form(text("one\ntwo\nthree", [align(0, 3), align(8, 13, "right"), strike(1, 6)])),
      ).success,
    ).toBe(true);
    expect(publishedDocSchema.safeParse(publishedWith([align(4, 7)])).success).toBe(true);
    expect(publishedDocSchema.safeParse(publishedWith([align(0, 13)], "one two")).success).toBe(
      false,
    );
  });

  it.each([
    ["in the middle of a line", [align(5, 7)]],
    ["a line cut at its start", [align(5, 8)]],
    ["a line cut at its end", [align(4, 6)]],
    ["over a line break", [align(0, 7)]],
    ["twice on one line", [align(4, 7), align(4, 7, "right")]],
    ["with another value", [align(4, 7, "justify")]],
    ["past the end", [align(8, 99)]],
    ["empty", [align(4, 4)]],
    ["fractional", [align(4.5, 7)]],
  ])("refuses an align mark %s", (_name, marks) => {
    expect(publishedDocSchema.safeParse(publishedWith(marks)).success).toBe(false);
  });

  it("refuses a strike or underline outside the text, as bold", () => {
    expect(publishedDocSchema.safeParse(publishedWith([strike(0, 99)])).success).toBe(false);
    expect(publishedDocSchema.safeParse(publishedWith([underline(-1, 3)])).success).toBe(false);
  });

  it("parsing a stored form keeps it equal to itself", () => {
    const doc = form(text("one\ntwo", [align(4, 7, "center"), strike(0, 3), underline(4, 7)]));
    expect(publishFormsEqual(doc, publishedDocSchema.parse(doc))).toBe(true);
  });
});

describe("M9-11 segments and lines", () => {
  it("segments carry strike and underline and merge equal neighbours", () => {
    const segments = textSegments("abcdef", [strike(0, 3), strike(3, 6), underline(2, 4)]);
    expect(segments.map((s) => [s.text, s.strike, s.underline])).toEqual(
      [
        ["ab", true, false],
        ["c", true, true],
        ["d", true, true],
        ["ef", true, false],
      ].reduce<[string, boolean, boolean][]>((all, item) => {
        // "c" and "d" are one piece: both are strike and underline.
        const last = all[all.length - 1];
        if (last && last[1] === item[1] && last[2] === item[2]) last[0] += item[0] as string;
        else all.push([...item] as [string, boolean, boolean]);
        return all;
      }, []),
    );
  });

  it("a text with only alignments has one plain segment, and textLines splits it", () => {
    expect(textSegments("a\nb", [align(0, 1)])).toHaveLength(1);
    const lines = textLines("a\nb\n\nc", [align(0, 1, "center"), align(5, 6, "right")])!;
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.align)).toEqual(["center", null, null, "right"]);
    expect(lines.map((line) => line.segments.map((s) => s.text).join(""))).toEqual([
      "a",
      "b",
      "",
      "c",
    ]);
    expect(lines[2]!.segments).toEqual([]);
  });

  it("textLines is null without an alignment, and cuts a mark that runs over a line break", () => {
    expect(textLines("a\nb", [bold(0, 3)])).toBeNull();
    expect(textLines("a\nb", [])).toBeNull();
    const lines = textLines("ab\ncd", [bold(1, 4), align(0, 2)])!;
    expect(lines.map((l) => l.segments.map((s) => [s.text, s.bold]))).toEqual([
      [
        ["a", false],
        ["b", true],
      ],
      [
        ["c", true],
        ["d", false],
      ],
    ]);
  });

  it("never throws, whatever the marks are", () => {
    const hostile: unknown[] = [
      null,
      7,
      "x",
      {},
      { type: "align" },
      { type: "align", start: "0", end: "3", align: "left" },
      { type: "link", start: 0, end: 2, id: 5, url: "x" },
      { type: "strike", start: 0, end: 2, extra: true },
    ];
    expect(() => clipMarks(hostile, 10)).not.toThrow();
    expect(() => textSegments("hello", hostile)).not.toThrow();
    expect(() => textLines("hello", hostile)).not.toThrow();
    expect(() => textLines("hello", { not: "an array" })).not.toThrow();
    expect(clipMarks(hostile, 10)).toEqual([{ type: "strike", start: 0, end: 2 }]);
  });

  it("the block row title is the plain text, whatever the new marks", () => {
    const long =
      "The quick brown fox jumps over the lazy dog, again and again and again, until it stops";
    expect(blockRowSummary(text(long, [strike(0, 9), align(0, 4)]) as never)).toEqual(
      blockRowSummary(text(long) as never),
    );
  });
});

describe("M9-11 salvageMarks keeps what the draft schema can read", () => {
  it("drops the unreadable, keeps the first 30 inline and 20 align marks", () => {
    const marks = [
      ...Array.from({ length: 400 }, (_, i) => bold(i, i + 1)),
      ...Array.from({ length: 30 }, (_, i) => align(i * 3, i * 3 + 2, "left")),
      { type: "code", start: 0, end: 1 },
      align(0, 1, "justify"),
      null,
    ];
    const kept = salvageMarks(marks);
    expect(kept.filter((m) => m.type === "bold")).toHaveLength(LIMITS.textMarks);
    expect(kept.filter((m) => m.type === "align")).toHaveLength(LIMITS.textAligns);
    expect(kept).toHaveLength(LIMITS.textMarks + LIMITS.textAligns);
    expect(salvageMarks("nope")).toEqual([]);
    const draft = draftOf(text("x".repeat(500), kept));
    expect(draftDocSchema.safeParse(draft).success).toBe(true);
  });

  it("keeps a link only with a valid id and a string address", () => {
    expect(
      salvageMarks([
        link(0, 1, "short"),
        link(0, 1, L1, "https://a.example"),
        link(0, 1, "x".repeat(9), 5 as never),
      ]),
    ).toEqual([link(0, 1, L1, "https://a.example")]);
  });
});

describe("M9-11 links, labels and the blocklist ignore the new types", () => {
  // Five inline types, three alignments and two links, as the spec's fixture.
  const value = "alpha beta gamma\ndelta epsilon\nzeta";
  const marks = [
    bold(0, 5),
    italic(6, 10),
    strike(11, 16),
    underline(17, 22),
    link(23, 30, L1, "https://example.com/one"),
    link(31, 35, L2, "https://example.com/two"),
    align(0, 16, "left"),
    align(17, 30, "center"),
    align(31, 35, "right"),
  ];
  const doc = form(text(value, marks));

  it("keeps all of them in the stored form", () => {
    const stored = textOf(doc);
    expect(stored.marks).toHaveLength(9);
    expect(publishedDocSchema.safeParse(doc).success).toBe(true);
  });

  it("findLinkUrl resolves only the two link ids", () => {
    expect(findLinkUrl(doc, L1)).toBe("https://example.com/one");
    expect(findLinkUrl(doc, L2)).toBe("https://example.com/two");
    expect(findLinkUrl(doc, TEXT_ID)).toBeNull();
    expect(findLinkUrl(doc, "no-such-mark")).toBeNull();
  });

  it("the analytics labels name only the two links", () => {
    const labels = linkLabelsFromPublished(doc);
    expect([...labels.keys()].sort()).toEqual([L1, L2].sort());
  });

  it("the blocklist reads only the two link marks, in the draft and in the published form", () => {
    const block = text(value, marks);
    expect(draftUrlFields(block)).toEqual([
      { blockId: TEXT_ID, itemId: L1, value: "https://example.com/one" },
      { blockId: TEXT_ID, itemId: L2, value: "https://example.com/two" },
    ]);
    expect(
      blockedLinksInPublished(doc, ["example.com"]).map((error) => [error.blockId, error.itemId]),
    ).toEqual([
      [TEXT_ID, L1],
      [TEXT_ID, L2],
    ]);
    expect(blockedLinksInPublished(doc, ["other.example"])).toEqual([]);
  });
});
