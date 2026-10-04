import { describe, expect, it } from "vitest";
import { clipMarks, isAlignMark, sortMarks, type Mark } from "@/lib/document";
import {
  marksToTiptapDoc,
  pmPositionOf,
  tiptapDocToTextAndMarks,
  type PmDocJson,
} from "@/components/blocks/forms/text-editor/convert";

/**
 * M9-12: the two pure functions at the edge of the text editor. Offsets are code points of the text;
 * ProseMirror counts UTF-16 units. Everything here runs over plain JSON, no editor involved.
 */

const L1 = "link-conv-00001";
const L2 = "link-conv-00002";

const mark = (type: string, start: number, end: number, extra: Record<string, unknown> = {}) =>
  ({ type, start, end, ...extra }) as unknown as Mark;
const bold = (start: number, end: number) => mark("bold", start, end);
const italic = (start: number, end: number) => mark("italic", start, end);
const strike = (start: number, end: number) => mark("strike", start, end);
const underline = (start: number, end: number) => mark("underline", start, end);
const link = (start: number, end: number, id = L1, url = "https://example.com/a") =>
  mark("link", start, end, { id, url });
const align = (start: number, end: number, value: "left" | "center" | "right") =>
  mark("align", start, end, { align: value });

const roundTrip = (text: string, marks: Mark[]) =>
  tiptapDocToTextAndMarks(marksToTiptapDoc(text, marks));

const textOfPara = (doc: PmDocJson, index: number) =>
  (doc.content[index]?.content ?? []).map((node) => node.text).join("");

describe("M9-12 marksToTiptapDoc: the document the editor opens with", () => {
  it("'Hello world' with bold 6 to 11", () => {
    const doc = marksToTiptapDoc("Hello world", [bold(6, 11)]);
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
    expect(roundTrip("Hello world", [bold(6, 11)])).toEqual({
      text: "Hello world",
      marks: [bold(6, 11)],
    });
  });

  it("an emoji is one position for us and two for the editor", () => {
    const doc = marksToTiptapDoc("a\u{1F44D}b", [bold(1, 2)]);
    expect(doc.content[0]!.content).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "\u{1F44D}", marks: [{ type: "bold" }] },
      { type: "text", text: "b" },
    ]);
    expect(roundTrip("a\u{1F44D}b", [bold(1, 2)])).toEqual({
      text: "a\u{1F44D}b",
      marks: [bold(1, 2)],
    });
    // 1 (paragraph opens) + "a" = 2; + the emoji's two units = 4.
    expect(pmPositionOf("a\u{1F44D}b", 1)).toBe(2);
    expect(pmPositionOf("a\u{1F44D}b", 2)).toBe(4);
    expect(pmPositionOf("a\u{1F44D}b", 3)).toBe(5);
  });

  it("each paragraph is one line of the text; an empty paragraph is an empty line", () => {
    const doc = marksToTiptapDoc("One\n\nTwo", []);
    expect(doc.content.map((_, i) => textOfPara(doc, i))).toEqual(["One", "", "Two"]);
    expect(doc.content[1]).toEqual({ type: "paragraph" });
    expect(roundTrip("One\n\nTwo", [])).toEqual({ text: "One\n\nTwo", marks: [] });
    expect(roundTrip("", [])).toEqual({ text: "", marks: [] });
  });

  it("two paragraphs 'One' and 'Two' with 'Two' centered give 'One\\nTwo' and an align mark 4 to 7", () => {
    const doc: PmDocJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "One" }] },
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [{ type: "text", text: "Two" }],
        },
      ],
    };
    expect(tiptapDocToTextAndMarks(doc)).toEqual({
      text: "One\nTwo",
      marks: [align(4, 7, "center")],
    });
    expect(marksToTiptapDoc("One\nTwo", [align(4, 7, "center")])).toEqual(doc);
  });

  it("CRLF reads as LF", () => {
    const doc = marksToTiptapDoc("a\r\nb", [bold(2, 3)]);
    expect(doc.content.map((_, i) => textOfPara(doc, i))).toEqual(["a", "b"]);
    expect(roundTrip("a\r\nb", [bold(2, 3)])).toEqual({ text: "a\nb", marks: [bold(2, 3)] });
    expect(roundTrip("a\rb", [])).toEqual({ text: "a\nb", marks: [] });
  });

  it("overlapping bold, italic, strike and underline come back as they were", () => {
    const marks = [bold(0, 4), italic(2, 6), strike(1, 5), underline(3, 6)];
    expect(roundTrip("abcdef", marks)).toEqual({ text: "abcdef", marks: sortMarks(marks) });
  });

  it("adjacent and overlapping marks of one type merge into one", () => {
    expect(roundTrip("abcdef", [bold(0, 3), bold(3, 6)]).marks).toEqual([bold(0, 6)]);
    expect(roundTrip("abcdef", [bold(0, 4), bold(2, 6)]).marks).toEqual([bold(0, 6)]);
    expect(roundTrip("abcdef", [bold(0, 2), bold(4, 6)]).marks).toEqual([bold(0, 2), bold(4, 6)]);
  });

  it("a mark across a paragraph break is one mark; never starts or ends on the break", () => {
    expect(roundTrip("ab\ncd", [bold(0, 2), bold(3, 5)]).marks).toEqual([bold(0, 5)]);
    expect(roundTrip("ab\ncd", [bold(0, 5)]).marks).toEqual([bold(0, 5)]);
    expect(roundTrip("ab\ncd", [bold(0, 3)]).marks).toEqual([bold(0, 2)]);
    expect(roundTrip("ab\ncd", [bold(2, 5)]).marks).toEqual([bold(3, 5)]);
    // An empty line in between has nothing to mark, so it does not split the range.
    expect(roundTrip("ab\n\ncd", [bold(0, 6)]).marks).toEqual([bold(0, 6)]);
    expect(roundTrip("ab\n\ncd", [bold(0, 2), bold(4, 6)]).marks).toEqual([bold(0, 6)]);
    // Text between them that is not marked does.
    expect(roundTrip("ab\nxx\ncd", [bold(0, 2), bold(6, 8)]).marks).toEqual([bold(0, 2), bold(6, 8)]);
  });

  it("a link across a paragraph break comes back as one link mark with one id", () => {
    const back = roundTrip("ab\ncd", [link(1, 4)]);
    expect(back.marks).toEqual([link(1, 4)]);
    const doc = marksToTiptapDoc("ab\ncd", [link(1, 4)]);
    const ids = doc.content.flatMap((p) =>
      (p.content ?? []).flatMap((n) => (n.marks ?? []).map((m) => m.attrs?.id)),
    );
    expect(ids).toEqual([L1, L1]);
  });

  it("two touching links with different ids stay two", () => {
    expect(
      roundTrip("abcdef", [
        link(0, 3, L1, "https://a.example"),
        link(3, 6, L2, "https://b.example"),
      ]).marks,
    ).toEqual([link(0, 3, L1, "https://a.example"), link(3, 6, L2, "https://b.example")]);
    // Same address, different ids: still two.
    expect(roundTrip("abcdef", [link(0, 3, L1), link(3, 6, L2)]).marks).toEqual([
      link(0, 3, L1),
      link(3, 6, L2),
    ]);
  });

  it("an alignment is written only for what was chosen: no mark means none, never 'left'", () => {
    const plain = tiptapDocToTextAndMarks({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "b" }] },
        { type: "paragraph", attrs: {}, content: [{ type: "text", text: "c" }] },
      ],
    });
    expect(plain.marks).toEqual([]);
    // A page aligned to the center with one paragraph explicitly set to left.
    const left = roundTrip("a\nb\nc", [align(2, 3, "left")]);
    expect(left.marks).toEqual([align(2, 3, "left")]);
    expect(marksToTiptapDoc("a\nb\nc", [align(2, 3, "left")]).content.map((p) => p.attrs)).toEqual([
      undefined,
      { textAlign: "left" },
      undefined,
    ]);
  });

  it("an alignment on an empty paragraph, or with another word, is dropped", () => {
    expect(
      tiptapDocToTextAndMarks({
        type: "doc",
        content: [
          { type: "paragraph", attrs: { textAlign: "center" } },
          {
            type: "paragraph",
            attrs: { textAlign: "justify" },
            content: [{ type: "text", text: "x" }],
          },
        ],
      }).marks,
    ).toEqual([]);
  });

  it("an align mark that cuts a line in half is the whole line", () => {
    expect(roundTrip("one\ntwo", [align(5, 6, "right")]).marks).toEqual([align(4, 7, "right")]);
  });

  it("marks that cannot be shown (past the end, hostile) are clipped away, never an error", () => {
    expect(() =>
      marksToTiptapDoc("abc", [{ type: "bold", start: -5, end: 99 }, null, "x", { type: "code" }]),
    ).not.toThrow();
    expect(roundTrip("abc", [{ type: "bold", start: -5, end: 99 } as never]).marks).toEqual([
      bold(0, 3),
    ]);
  });

  it("keeps 400 hostile marks to the first valid ones", () => {
    const marks = Array.from({ length: 400 }, (_, i) => bold(i, i + 1));
    const doc = marksToTiptapDoc("x".repeat(500), marks);
    const back = tiptapDocToTextAndMarks(doc);
    expect(back.text).toBe("x".repeat(500));
    // The first 30 are shown (and they touch, so they read as one range of 30).
    expect(back.marks).toEqual([bold(0, 30)]);
  });
});

describe("M9-12 tiptapDocToTextAndMarks: ids", () => {
  const doc = (...paragraphs: PmDocJson["content"]): PmDocJson => ({
    type: "doc",
    content: paragraphs,
  });
  const linked = (text: string, attrs: Record<string, unknown>) => ({
    type: "text" as const,
    text,
    marks: [{ type: "link", attrs }],
  });
  const counter = () => {
    let n = 0;
    return () => `fresh-id-${String(++n).padStart(4, "0")}`;
  };

  it("keeps the id of a link, however its range was edited", () => {
    const result = tiptapDocToTextAndMarks(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "go " },
          linked("here and", { href: "https://a.example", id: L1 }),
          linked(" there", { href: "https://a.example", id: L1 }),
        ],
      }),
      { newId: counter() },
    );
    expect(result.marks).toEqual([link(3, 17, L1, "https://a.example")]);
  });

  it("gives a link with no id a fresh one", () => {
    const result = tiptapDocToTextAndMarks(
      doc({ type: "paragraph", content: [linked("pasted", { href: "https://a.example" })] }),
      { newId: counter() },
    );
    expect(result.marks).toEqual([link(0, 6, "fresh-id-0001", "https://a.example")]);
  });

  it("a link split in two keeps its id on the first part and gives the second a fresh one", () => {
    const result = tiptapDocToTextAndMarks(
      doc({
        type: "paragraph",
        content: [
          linked("ab", { href: "https://a.example", id: L1 }),
          { type: "text", text: "--" },
          linked("cd", { href: "https://a.example", id: L1 }),
        ],
      }),
      { newId: counter() },
    );
    expect(result.marks).toEqual([
      link(0, 2, L1, "https://a.example"),
      link(4, 6, "fresh-id-0001", "https://a.example"),
    ]);
  });

  it("a fresh id never repeats one already in use", () => {
    const result = tiptapDocToTextAndMarks(
      doc({
        type: "paragraph",
        content: [
          linked("ab", { href: "https://a.example", id: "fresh-id-0001" }),
          { type: "text", text: "-" },
          linked("cd", { href: "https://b.example" }),
        ],
      }),
      { newId: counter() },
    );
    expect(result.marks.map((m) => (m.type === "link" ? m.id : null))).toEqual([
      "fresh-id-0001",
      "fresh-id-0002",
    ]);
  });

  it("reads anything that is not a document as an empty one, never throws", () => {
    for (const value of [
      null,
      undefined,
      5,
      "x",
      [],
      {},
      { content: "x" },
      { content: [null, 4, {}] },
    ]) {
      expect(tiptapDocToTextAndMarks(value)).toEqual({ text: "", marks: [] });
    }
  });
});

describe("M9-12 pmPositionOf", () => {
  it("counts one position for each paragraph's opening and closing", () => {
    expect(pmPositionOf("ab\ncd", 0)).toBe(1);
    expect(pmPositionOf("ab\ncd", 2)).toBe(3);
    expect(pmPositionOf("ab\ncd", 3)).toBe(5);
    expect(pmPositionOf("ab\ncd", 5)).toBe(7);
    expect(pmPositionOf("ab\n\ncd", 4)).toBe(7);
    expect(pmPositionOf("ab", 99)).toBeGreaterThan(0);
  });
});

// A property test -------------------------------------------------------------------------------

/** Mulberry32: a small seeded generator, so a failure names a seed that reproduces it. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The expected result of a round trip, worked out one character at a time and independently of the
 * converter: marks are clipped (the shared `clipMarks`), then for each type the covered characters
 * are listed, a line break is covered when the characters on both sides are, and each maximal run
 * is one mark.
 */
function reference(text: string, marks: Mark[]): Mark[] {
  const chars = Array.from(text);
  const clipped = clipMarks(marks, chars.length, 0, chars);
  const out: Mark[] = [];
  const isBreak = (i: number) => chars[i] === "\n";
  const runs = (covered: (string | null)[]) => {
    const result: { start: number; end: number; key: string }[] = [];
    let i = 0;
    const at = (n: number): string | null => {
      if (n < 0 || n >= chars.length) return null;
      if (!isBreak(n)) return covered[n] ?? null;
      // A line break is covered when the nearest text on both sides is, by the same mark.
      let left = n - 1;
      while (left >= 0 && isBreak(left)) left -= 1;
      let right = n + 1;
      while (right < chars.length && isBreak(right)) right += 1;
      if (left < 0 || right >= chars.length) return null;
      const before = covered[left] ?? null;
      return before !== null && before === (covered[right] ?? null) ? before : null;
    };
    while (i < chars.length) {
      const key = at(i);
      if (key === null) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < chars.length && at(j) === key) j += 1;
      result.push({ start: i, end: j, key });
      i = j;
    }
    return result;
  };
  for (const type of ["bold", "italic", "strike", "underline"] as const) {
    const covered: (string | null)[] = chars.map(() => null);
    for (const m of clipped) {
      if (m.type !== type) continue;
      for (let i = m.start; i < m.end; i++) covered[i] = type;
    }
    for (const run of runs(covered)) out.push({ type, start: run.start, end: run.end } as Mark);
  }
  const linkCover: (string | null)[] = chars.map(() => null);
  const linkUrl = new Map<string, string>();
  for (const m of clipped) {
    if (m.type !== "link") continue;
    linkUrl.set(m.id, m.url);
    for (let i = m.start; i < m.end; i++) linkCover[i] = m.id;
  }
  for (const run of runs(linkCover)) {
    out.push({
      type: "link",
      start: run.start,
      end: run.end,
      id: run.key,
      url: linkUrl.get(run.key)!,
    });
  }
  for (const m of clipped) if (isAlignMark(m)) out.push(m);
  return sortMarks(out);
}

describe("M9-12 the round trip of 200 random texts and mark sets", () => {
  const ALPHABET = ["a", "b", "c", "d", "e", " ", " ", "\u{1F44D}", "é", "中", "x", "y"];

  function randomCase(seed: number): { text: string; marks: Mark[] } {
    const rnd = random(seed);
    const int = (n: number) => Math.floor(rnd() * n);
    const length = int(60);
    let text = "";
    for (let i = 0; i < length; i++) text += rnd() < 0.14 ? "\n" : ALPHABET[int(ALPHABET.length)]!;
    const total = Array.from(text).length;
    const marks: Mark[] = [];
    const count = int(14);
    let links = 0;
    for (let i = 0; i < count; i++) {
      const a = int(total + 1);
      const b = int(total + 1);
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      const kind = int(6);
      if (kind === 0) marks.push(bold(start, end));
      else if (kind === 1) marks.push(italic(start, end));
      else if (kind === 2) marks.push(strike(start, end));
      else if (kind === 3) marks.push(underline(start, end));
      else if (kind === 4) {
        links += 1;
        marks.push(
          link(
            start,
            end,
            `link-prop-${String(seed).padStart(4, "0")}-${links}`,
            `https://e${links}.example/p`,
          ),
        );
      } else marks.push(align(start, end, (["left", "center", "right"] as const)[int(3)]!));
    }
    return { text, marks };
  }

  it("equals { text, marks: normalized }, and a second round trip changes nothing", () => {
    let withMarks = 0;
    let withAlign = 0;
    let withLink = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { text, marks } = randomCase(seed);
      const expected = reference(text, marks);
      const first = roundTrip(text, marks);
      expect(first, `seed ${seed}`).toEqual({ text, marks: expected });
      expect(roundTrip(first.text, first.marks), `seed ${seed} twice`).toEqual(first);
      if (expected.length > 0) withMarks += 1;
      if (expected.some((m) => m.type === "align")) withAlign += 1;
      if (expected.some((m) => m.type === "link")) withLink += 1;
    }
    // The generator must actually exercise the converter.
    expect(withMarks).toBeGreaterThan(120);
    expect(withAlign).toBeGreaterThan(30);
    expect(withLink).toBeGreaterThan(30);
  });

  it("a page centered with one paragraph set to left round-trips as one align mark of left", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = random(seed * 7919);
      const lines = Array.from(
        { length: 1 + Math.floor(rnd() * 5) },
        (_, i) => `line ${i} \u{1F44D}`,
      );
      const text = lines.join("\n");
      const chosen = Math.floor(rnd() * lines.length);
      const start = lines.slice(0, chosen).join("\n").length + (chosen > 0 ? 1 : 0);
      // `start` counts UTF-16 units; the emoji is two of them in every earlier line.
      const cp = Array.from(lines.slice(0, chosen).join("\n")).length + (chosen > 0 ? 1 : 0);
      void start;
      const line = Array.from(lines[chosen]!).length;
      const result = roundTrip(text, [align(cp, cp + line, "left")]);
      expect(result.marks).toEqual([align(cp, cp + line, "left")]);
    }
  });
});
