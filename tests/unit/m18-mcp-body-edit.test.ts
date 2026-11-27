import { describe, expect, it } from "vitest";
import { applyBodyEdits } from "@/lib/mcp/body-edit";

/**
 * M18-05: exact find and replace on a body. A step matches once unless `all` is true; a step that
 * matches zero times, or more than once without `all`, stops everything and names the step.
 */

describe("applyBodyEdits", () => {
  it("replaces the one match, exactly", () => {
    expect(applyBodyEdits("one two three", [{ find: "two", replace: "2" }])).toEqual({
      ok: true,
      body: "one 2 three",
    });
  });

  it("zero matches: nothing is applied, the step and the count are named", () => {
    expect(
      applyBodyEdits("one two", [
        { find: "one", replace: "1" },
        { find: "nine", replace: "9" },
      ]),
    ).toEqual({ ok: false, index: 1, matches: 0 });
  });

  it("more than one match without all: refused with the count; with all, every match is replaced", () => {
    expect(applyBodyEdits("a-a-a", [{ find: "a", replace: "b" }])).toEqual({
      ok: false,
      index: 0,
      matches: 3,
    });
    expect(applyBodyEdits("a-a-a", [{ find: "a", replace: "b", all: true }])).toEqual({
      ok: true,
      body: "b-b-b",
    });
    expect(applyBodyEdits("a-a-a", [{ find: "a", replace: "b", all: false }])).toMatchObject({
      ok: false,
      matches: 3,
    });
  });

  it("steps run in order, each on the result of the one before", () => {
    expect(
      applyBodyEdits("alpha", [
        { find: "alpha", replace: "beta" },
        { find: "beta", replace: "gamma" },
      ]),
    ).toEqual({ ok: true, body: "gamma" });
    // The second step no longer finds what the first one replaced.
    expect(
      applyBodyEdits("alpha", [
        { find: "alpha", replace: "beta" },
        { find: "alpha", replace: "gamma" },
      ]),
    ).toEqual({ ok: false, index: 1, matches: 0 });
  });

  it("the same edit twice fails the second time: the text it expects is gone", () => {
    const once = applyBodyEdits("Hello world", [{ find: "world", replace: "there" }]);
    expect(once).toEqual({ ok: true, body: "Hello there" });
    expect(applyBodyEdits("Hello there", [{ find: "world", replace: "there" }])).toEqual({
      ok: false,
      index: 0,
      matches: 0,
    });
  });

  it("find and replace are literal: no pattern, no dollar groups, case and spaces count", () => {
    expect(applyBodyEdits("cost: $5 (a.b)", [{ find: "(a.b)", replace: "$& $1 $$" }])).toEqual({
      ok: true,
      body: "cost: $5 $& $1 $$",
    });
    expect(applyBodyEdits("axb", [{ find: "a.b", replace: "no" }])).toMatchObject({ ok: false });
    expect(applyBodyEdits("Word", [{ find: "word", replace: "no" }])).toMatchObject({ ok: false });
    expect(applyBodyEdits("a  b", [{ find: "a b", replace: "no" }])).toMatchObject({ ok: false });
  });

  it("matches do not overlap, and line endings and astral characters are kept as they are", () => {
    expect(applyBodyEdits("aaaa", [{ find: "aa", replace: "b", all: true }])).toEqual({
      ok: true,
      body: "bb",
    });
    expect(applyBodyEdits("aaa", [{ find: "aa", replace: "b" }])).toEqual({ ok: true, body: "ba" });
    const body = "line one\r\nline 😀 two  \r\n";
    expect(applyBodyEdits(body, [{ find: "😀", replace: "🎉" }])).toEqual({
      ok: true,
      body: "line one\r\nline 🎉 two  \r\n",
    });
  });

  it("an empty replace removes the text; an empty find never matches", () => {
    expect(applyBodyEdits("keep drop keep", [{ find: " drop", replace: "" }])).toEqual({
      ok: true,
      body: "keep keep",
    });
    expect(applyBodyEdits("abc", [{ find: "", replace: "x" }])).toEqual({
      ok: false,
      index: 0,
      matches: 0,
    });
  });

  it("an edit can build what neither half is: the result is what gets checked, not the steps", () => {
    const built = applyBodyEdits("[x](java) and script:alert(1)", [
      { find: "(java) and script:", replace: "(javascript:" },
    ]);
    expect(built).toEqual({ ok: true, body: "[x](javascript:alert(1)" });
  });

  it("twenty steps on a full body run in linear time", () => {
    const filler = "lorem ipsum dolor sit amet ".repeat(19_000); // about 513,000 characters
    const body = `${filler}MARKER${filler.slice(0, 5_000)}`.slice(0, 520_000);
    const edits = Array.from({ length: 20 }, (_, index) => ({
      find: index === 0 ? "MARKER" : `M${index - 1}`,
      replace: `M${index}`,
    }));
    const started = performance.now();
    const out = applyBodyEdits(body, edits);
    const took = performance.now() - started;
    expect(out.ok).toBe(true);
    expect(out.ok && out.body.includes("M19")).toBe(true);
    // A quadratic scan of half a megabyte takes minutes; a linear one a few milliseconds.
    expect(took).toBeLessThan(2_000);
    // The worst case for a naive matcher: a long run of one letter and a find that almost matches.
    const run = "a".repeat(500_000);
    const again = performance.now();
    expect(applyBodyEdits(run, [{ find: `${"a".repeat(5_000)}b`, replace: "x" }])).toEqual({
      ok: false,
      index: 0,
      matches: 0,
    });
    expect(performance.now() - again).toBeLessThan(2_000);
  });
});
