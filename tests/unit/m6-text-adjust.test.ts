import { describe, expect, it } from "vitest";
import { linkAt, linksOverlapping, textBetween, type Mark } from "@/lib/document";

/**
 * M6-30, kept by M9-12: the pure reads the link panel makes of a block's marks (which link a
 * selection is inside, which it overlaps) and the text a range covers. The old steps for marks that
 * follow the text (`adjustMarks`), toggling bold and italic, adding, updating and removing a link in
 * the model, and converting a textarea's UTF-16 indices are superseded by the editor (M9-12): the
 * editor owns the typing, and `tests/unit/m9-text-convert.test.ts` holds the conversion.
 */

const bold = (start: number, end: number): Mark => ({ type: "bold", start, end });
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
});

describe("M6-30 reading the text a range covers", () => {
  const sample = "a\u{1F44D}b\u{1F680}c";

  it("reads the text a range covers, in code points", () => {
    expect(textBetween(sample, 1, 4)).toBe("\u{1F44D}b\u{1F680}");
    expect(textBetween(sample, 0, 99)).toBe(sample);
    expect(textBetween(sample, 3, 1)).toBe("");
  });
});
