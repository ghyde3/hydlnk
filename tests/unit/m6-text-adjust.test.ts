import { describe, expect, it } from "vitest";
import {
  addLinkMark,
  adjustMarks,
  isFormatted,
  linkAt,
  linksOverlapping,
  removeLinkMark,
  setLinkUrl,
  textBetween,
  toCodePointOffset,
  toUtf16Index,
  toggleFormat,
  type Mark,
} from "@/lib/document";

/**
 * M6-30: marks follow the text (`adjustMarks`), and the toolbar's pure operations: toggling bold
 * and italic with merging, link bookkeeping, and the conversion between a textarea's UTF-16 indices
 * and code point offsets.
 */

const bold = (start: number, end: number): Mark => ({ type: "bold", start, end });
const italic = (start: number, end: number): Mark => ({ type: "italic", start, end });
const link = (
  start: number,
  end: number,
  id = "link-aaaaaaaa",
  url = "https://example.com",
): Mark => ({
  type: "link",
  start,
  end,
  id,
  url,
});

describe("M6-30 adjustMarks", () => {
  it("returns the same marks for the same text", () => {
    const marks = [bold(1, 3)];
    expect(adjustMarks("Hello", "Hello", marks)).toEqual(marks);
    expect(adjustMarks("", "", [])).toEqual([]);
    expect(adjustMarks("a", "ab", [])).toEqual([]);
  });

  describe("typing and pasting", () => {
    it("'Big ' at the start shifts every mark right by 4", () => {
      expect(
        adjustMarks("Hello world", "Big Hello world", [bold(0, 5), italic(6, 11), link(6, 11)]),
      ).toEqual([bold(4, 9), italic(10, 15), link(10, 15)]);
    });

    it("typing inside a bold range extends it", () => {
      expect(adjustMarks("Hello world", "Hello woXrld", [bold(6, 11)])).toEqual([bold(6, 12)]);
      expect(adjustMarks("Hello world", "Hello wXorld", [bold(6, 11)])).toEqual([bold(6, 12)]);
    });

    it("typing right after its end does not extend it", () => {
      expect(adjustMarks("Hello world", "Hello worldX", [bold(6, 11)])).toEqual([bold(6, 11)]);
      expect(adjustMarks("Hello world", "Hello worldXY", [bold(0, 5)])).toEqual([bold(0, 5)]);
    });

    it("typing at the very start of a range moves it instead of extending it", () => {
      expect(adjustMarks("Hello world", "Hello Xworld", [bold(6, 11)])).toEqual([bold(7, 12)]);
    });

    it("typing before a range moves it", () => {
      expect(adjustMarks("Hello world", "HelloX world", [bold(6, 11)])).toEqual([bold(7, 12)]);
    });

    it("typing after a range leaves it", () => {
      expect(adjustMarks("Hello world", "Hello worldXYZ", [bold(0, 5)])).toEqual([bold(0, 5)]);
    });

    it("pasting 20 characters inside a range extends it by 20", () => {
      const pasted = "x".repeat(20);
      expect(adjustMarks("Hello world", `Hello w${pasted}orld`, [bold(6, 11)])).toEqual([
        bold(6, 31),
      ]);
    });

    it("a newline typed inside a range extends it", () => {
      expect(adjustMarks("Hello world", "Hello wo\nrld", [italic(6, 11)])).toEqual([italic(6, 12)]);
    });
  });

  describe("deleting and replacing", () => {
    it("deleting all of a range's text removes the mark", () => {
      expect(adjustMarks("Hello world", "Hello ", [bold(6, 11)])).toEqual([]);
      expect(adjustMarks("Hello world", "world", [bold(0, 6)])).toEqual([]);
      expect(adjustMarks("Hello world", "", [bold(0, 5), italic(6, 11)])).toEqual([]);
    });

    it("deleting more than a range removes it too", () => {
      expect(adjustMarks("Hello big world", "Hello d", [bold(6, 9)])).toEqual([]);
    });

    it("deleting part of a range shortens it", () => {
      expect(adjustMarks("Hello world", "Hello wld", [bold(6, 11)])).toEqual([bold(6, 9)]);
      expect(adjustMarks("Hello world", "Hellorld", [bold(6, 11)])).toEqual([bold(5, 8)]);
    });

    it("deleting before a range moves it left", () => {
      expect(adjustMarks("Hello world", "world", [bold(6, 11)])).toEqual([bold(0, 5)]);
      expect(adjustMarks("Hello world", "Hell world", [bold(6, 11)])).toEqual([bold(5, 10)]);
    });

    it("replacing a selection that spans the range's end shortens it", () => {
      // 'o wo' (4 to 8) replaced by 'XY': the bold 6 to 11 keeps only 'rld'.
      expect(adjustMarks("Hello world", "HellXYrld", [bold(6, 11)])).toEqual([bold(6, 9)]);
      // The range ends inside the replaced text: only the part before survives.
      expect(adjustMarks("Hello world", "HelloXYZ", [bold(2, 8)])).toEqual([bold(2, 5)]);
    });

    it("replacing a selection that spans the range's start shortens it to the part after", () => {
      expect(adjustMarks("Hello world", "Hello Xorld", [bold(2, 8)])).toEqual([bold(2, 8)]);
      expect(adjustMarks("Hello world", "HelXorld", [bold(5, 9)])).toEqual([bold(4, 6)]);
    });

    it("replacing text inside a range keeps the range around the new text", () => {
      expect(adjustMarks("Hello world", "Hello wXXXld", [bold(6, 11)])).toEqual([bold(6, 12)]);
      expect(adjustMarks("Hello world", "Hello wXld", [bold(6, 11)])).toEqual([bold(6, 10)]);
    });

    it("replacing exactly a range's text removes it", () => {
      expect(adjustMarks("Hello world", "Hello there", [bold(6, 11)])).toEqual([]);
    });

    it("keeps unrelated marks while another goes", () => {
      expect(adjustMarks("Hello world", "Hello", [bold(0, 5), italic(6, 11)])).toEqual([
        bold(0, 5),
      ]);
    });
  });

  describe("code points", () => {
    it("an emoji counts as one position", () => {
      // An emoji typed right after a one-emoji range is after its end: not bold.
      expect(adjustMarks("a\u{1F44D}b", "a\u{1F44D}\u{1F44D}b", [bold(1, 2)])).toEqual([
        bold(1, 2),
      ]);
      // An emoji typed inside a two-emoji range extends it by one position, not two.
      expect(
        adjustMarks("\u{1F44D}\u{1F44D}", "\u{1F44D}\u{1F680}\u{1F44D}", [bold(0, 2)]),
      ).toEqual([bold(0, 3)]);
      expect(adjustMarks("a\u{1F44D}b", "aXb", [bold(1, 2)])).toEqual([]);
      expect(adjustMarks("\u{1F44D}b", "x\u{1F44D}b", [bold(0, 1)])).toEqual([bold(1, 2)]);
      expect(adjustMarks("ab", "a\u{1F44D}\u{1F44D}b", [bold(0, 2)])).toEqual([bold(0, 4)]);
    });

    it("typing an emoji after a range does not extend it", () => {
      expect(adjustMarks("ab", "ab\u{1F44D}", [bold(0, 2)])).toEqual([bold(0, 2)]);
    });
  });

  describe("links follow the text like any mark and keep their data", () => {
    it("keeps id and url", () => {
      const marks = [link(6, 11, "link-bbbbbbbb", "https://x.example/")];
      expect(adjustMarks("Hello world", "Hey Hello world", marks)).toEqual([
        link(10, 15, "link-bbbbbbbb", "https://x.example/"),
      ]);
    });

    it("never leaves two links overlapping", () => {
      const marks = [link(0, 5, "link-aaaaaaaa"), link(6, 11, "link-bbbbbbbb")];
      for (const next of ["Hello  world", "Hellox world", "Hel world", "o world", "Hello"]) {
        const adjusted = adjustMarks("Hello world", next, marks);
        for (let i = 1; i < adjusted.length; i++) {
          expect(adjusted[i]!.start).toBeGreaterThanOrEqual(adjusted[i - 1]!.end);
        }
      }
    });
  });

  it("never adds a mark, never leaves an empty or inverted one, on random edits", () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = ["a", "b", "\u{1F44D}", " ", "\n"];
    const make = (n: number) => Array.from({ length: n }, () => alphabet[random(alphabet.length)]!);
    for (let round = 0; round < 400; round++) {
      const before = make(1 + random(14));
      const marks: Mark[] = [];
      for (let i = 0; i < random(4); i++) {
        const start = random(before.length);
        marks.push(bold(start, start + 1 + random(before.length - start)));
      }
      const after = before.slice();
      after.splice(random(before.length + 1), random(4), ...make(random(4)));
      const adjusted = adjustMarks(before.join(""), after.join(""), marks);
      expect(adjusted.length).toBeLessThanOrEqual(marks.length);
      for (const mark of adjusted) {
        expect(mark.start).toBeGreaterThanOrEqual(0);
        expect(mark.start).toBeLessThan(mark.end);
        expect(mark.end).toBeLessThanOrEqual(after.length);
      }
    }
  });
});

describe("M6-30 Bold and Italic", () => {
  it("selecting 'world' in 'Hello world' and pressing Bold writes one mark", () => {
    expect(toggleFormat([], "bold", 6, 11)).toEqual([bold(6, 11)]);
  });

  it("pressing Bold again on the same selection removes the mark", () => {
    expect(toggleFormat([bold(6, 11)], "bold", 6, 11)).toEqual([]);
  });

  it("removing from the middle splits the range in two", () => {
    expect(toggleFormat([bold(0, 11)], "bold", 3, 6)).toEqual([bold(0, 3), bold(6, 11)]);
  });

  it("removing from an edge shortens the range", () => {
    expect(toggleFormat([bold(0, 11)], "bold", 0, 4)).toEqual([bold(4, 11)]);
    expect(toggleFormat([bold(0, 11)], "bold", 7, 11)).toEqual([bold(0, 7)]);
  });

  it("applying Bold across a selection that touches an existing range merges them into one", () => {
    expect(toggleFormat([bold(0, 5)], "bold", 4, 8)).toEqual([bold(0, 8)]);
    expect(toggleFormat([bold(6, 11)], "bold", 3, 7)).toEqual([bold(3, 11)]);
    // Touching counts.
    expect(toggleFormat([bold(0, 5)], "bold", 5, 8)).toEqual([bold(0, 8)]);
    // A selection that covers several ranges joins them.
    expect(toggleFormat([bold(0, 2), bold(4, 6), bold(8, 10)], "bold", 1, 9)).toEqual([
      bold(0, 10),
    ]);
  });

  it("a selection that is only partly bold gets Bold (it does not remove)", () => {
    expect(isFormatted([bold(0, 5)], "bold", 3, 8)).toBe(false);
    expect(toggleFormat([bold(0, 5)], "bold", 3, 8)).toEqual([bold(0, 8)]);
  });

  it("a selection covered by two touching ranges counts as bold", () => {
    expect(isFormatted([bold(0, 5), bold(5, 10)], "bold", 2, 8)).toBe(true);
    expect(isFormatted([bold(0, 4), bold(5, 10)], "bold", 2, 8)).toBe(false);
  });

  it("bold and italic are independent and both can cover the same text", () => {
    const both = toggleFormat(toggleFormat([], "bold", 0, 5), "italic", 0, 5);
    expect(both).toEqual([bold(0, 5), italic(0, 5)]);
    expect(isFormatted(both, "bold", 0, 5)).toBe(true);
    expect(isFormatted(both, "italic", 0, 5)).toBe(true);
    expect(toggleFormat(both, "bold", 0, 5)).toEqual([italic(0, 5)]);
  });

  it("does not touch links, and an empty selection changes nothing", () => {
    const marks = [link(0, 5), bold(2, 4)];
    expect(toggleFormat(marks, "bold", 6, 6)).toEqual(marks);
    expect(toggleFormat(marks, "italic", 0, 5)).toEqual([italic(0, 5), link(0, 5), bold(2, 4)]);
    expect(isFormatted([], "bold", 3, 3)).toBe(false);
  });

  it("keeps the result sorted", () => {
    const result = toggleFormat([italic(8, 10), bold(0, 2)], "bold", 4, 6);
    expect(result.map((m) => `${m.type}${m.start}`)).toEqual(["bold0", "bold4", "italic8"]);
  });
});

describe("M6-30 link bookkeeping", () => {
  const marks = [
    link(0, 5, "link-aaaaaaaa", "https://a.example"),
    bold(2, 3),
    link(8, 12, "link-bbbbbbbb", "https://b.example"),
  ];

  it("finds the link a selection is inside, or a caret is in or touching", () => {
    expect(linkAt(marks, 1, 4)?.id).toBe("link-aaaaaaaa");
    expect(linkAt(marks, 0, 5)?.id).toBe("link-aaaaaaaa");
    expect(linkAt(marks, 2, 2)?.id).toBe("link-aaaaaaaa");
    expect(linkAt(marks, 5, 5)?.id).toBe("link-aaaaaaaa");
    expect(linkAt(marks, 0, 0)?.id).toBe("link-aaaaaaaa");
    expect(linkAt(marks, 6, 6)).toBeUndefined();
    // A selection that leaves the link is not inside it.
    expect(linkAt(marks, 3, 7)).toBeUndefined();
    expect(linkAt(marks, 4, 9)).toBeUndefined();
    expect(linkAt(marks, 6, 7)).toBeUndefined();
  });

  it("a caret between two touching links prefers the one it is inside", () => {
    const touching = [link(0, 5, "link-aaaaaaaa"), link(5, 9, "link-bbbbbbbb")];
    expect(linkAt(touching, 3, 3)?.id).toBe("link-aaaaaaaa");
    expect(linkAt(touching, 7, 7)?.id).toBe("link-bbbbbbbb");
    expect(linkAt(touching, 5, 5)?.id).toBe("link-aaaaaaaa");
  });

  it("lists the links a selection overlaps", () => {
    expect(linksOverlapping(marks, 3, 9).map((l) => l.id)).toEqual([
      "link-aaaaaaaa",
      "link-bbbbbbbb",
    ]);
    expect(linksOverlapping(marks, 5, 8)).toEqual([]);
    expect(linksOverlapping(marks, 4, 5).map((l) => l.id)).toEqual(["link-aaaaaaaa"]);
    expect(linksOverlapping(marks, 12, 20)).toEqual([]);
  });

  it("adds, updates and removes a link", () => {
    const added = addLinkMark([bold(0, 3)], 4, 9, "link-cccccccc", "https://c.example");
    expect(added).toEqual([bold(0, 3), link(4, 9, "link-cccccccc", "https://c.example")]);
    expect(setLinkUrl(added, "link-cccccccc", "https://d.example")).toEqual([
      bold(0, 3),
      link(4, 9, "link-cccccccc", "https://d.example"),
    ]);
    expect(setLinkUrl(added, "link-unknown1", "https://d.example")).toEqual(added);
    expect(removeLinkMark(added, "link-cccccccc")).toEqual([bold(0, 3)]);
    expect(removeLinkMark(added, "link-unknown1")).toEqual(added);
  });
});

describe("M6-30 offsets between the textarea and the marks", () => {
  const sample = "a\u{1F44D}b\u{1F680}c";

  it("converts UTF-16 indices to code points and back", () => {
    expect(sample.length).toBe(7);
    expect([0, 1, 3, 4, 6, 7].map((index) => toCodePointOffset(sample, index))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((offset) => toUtf16Index(sample, offset))).toEqual([
      0, 1, 3, 4, 6, 7,
    ]);
    expect(toUtf16Index(sample, 99)).toBe(7);
    expect(toCodePointOffset(sample, -3)).toBe(0);
    expect(toUtf16Index(sample, 0)).toBe(0);
  });

  it("reads the text a range covers", () => {
    expect(textBetween(sample, 1, 4)).toBe("\u{1F44D}b\u{1F680}");
    expect(textBetween(sample, 0, 99)).toBe(sample);
    expect(textBetween(sample, 3, 1)).toBe("");
  });
});
