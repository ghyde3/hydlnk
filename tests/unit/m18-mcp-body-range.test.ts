import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bodyRange, charCount, contentHash } from "@/lib/mcp/body-range";
import { MCP_BODY_RANGE_CHARS, MCP_BODY_RANGE_MAX_CHARS } from "@/lib/mcp/constants";

/**
 * M18-02: a post body in exact ranges. Offsets and lengths count characters (code points), never
 * half a surrogate pair, and the ranges joined in order are the body, character for character.
 */

const join = (body: string, length: number) => {
  let out = "";
  let offset: number | null = 0;
  let calls = 0;
  while (offset !== null) {
    const part = bodyRange(body, offset, length);
    out += part.text;
    offset = part.nextOffset;
    calls += 1;
    if (calls > 100_000) throw new Error("the ranges do not end");
  }
  return { out, calls };
};

describe("bodyRange", () => {
  it("at 0: the first characters, and where to go on", () => {
    expect(bodyRange("abcdef", 0, 4)).toEqual({
      text: "abcd",
      offset: 0,
      nextOffset: 4,
      bodyChars: 6,
    });
  });

  it("the last character: nextOffset is null", () => {
    expect(bodyRange("abcdef", 5, 1)).toEqual({
      text: "f",
      offset: 5,
      nextOffset: null,
      bodyChars: 6,
    });
    expect(bodyRange("abcdef", 2, 4).nextOffset).toBeNull();
    expect(bodyRange("abcdef", 2, 3).nextOffset).toBe(5);
  });

  it("past the end: an empty range and nextOffset null", () => {
    expect(bodyRange("abcdef", 6, 10)).toEqual({
      text: "",
      offset: 6,
      nextOffset: null,
      bodyChars: 6,
    });
    expect(bodyRange("abcdef", 9000, 10)).toMatchObject({ text: "", nextOffset: null });
    expect(bodyRange("", 0, 10)).toEqual({ text: "", offset: 0, nextOffset: null, bodyChars: 0 });
  });

  it("a range that would split a surrogate pair never does: lengths count characters", () => {
    const body = "a😀b😀c"; // 5 characters, 7 UTF-16 units
    expect(charCount(body)).toBe(5);
    expect(body.length).toBe(7);
    const first = bodyRange(body, 0, 2);
    expect(first).toEqual({ text: "a😀", offset: 0, nextOffset: 2, bodyChars: 5 });
    const second = bodyRange(body, 2, 2);
    expect(second.text).toBe("b😀");
    // Every piece is well formed on its own: no lone half of a pair at either end.
    for (let length = 1; length <= 5; length += 1) {
      for (let offset = 0; offset <= 5; offset += 1) {
        const { text } = bodyRange(body, offset, length);
        expect(text.isWellFormed(), `${offset}+${length}`).toBe(true);
      }
    }
  });

  it("joining the ranges gives the stored body, character for character: astral characters, CRLF, trailing spaces", () => {
    const body = `# Title \r\n\r\nLine with trailing spaces   \r\n${"😀🎉".repeat(300)}\ttab\u00a0nbsp \n  \n`;
    for (const length of [1, 2, 3, 7, 64, 599, 600, 601, 10_000]) {
      const { out } = join(body, length);
      expect(out, `length ${length}`).toBe(body);
      expect(contentHash(out)).toBe(contentHash(body));
    }
  });

  it("a full body of astral characters reads back exactly at the largest range", () => {
    const body = "😀".repeat(131_072); // 512 KiB of UTF-8
    expect(new TextEncoder().encode(body).length).toBe(512 * 1024);
    const { out, calls } = join(body, MCP_BODY_RANGE_MAX_CHARS);
    expect(out === body).toBe(true);
    expect(calls).toBe(Math.ceil(131_072 / MCP_BODY_RANGE_MAX_CHARS));
  });

  it("bad numbers are read as 0", () => {
    expect(bodyRange("abc", -5, 2).text).toBe("ab");
    expect(bodyRange("abc", 1.9, 1.9).text).toBe("b");
    expect(bodyRange("abc", 0, 0)).toMatchObject({ text: "", nextOffset: 0 });
  });

  it("the sizes are the pinned ones", () => {
    expect(MCP_BODY_RANGE_CHARS).toBe(12_000);
    expect(MCP_BODY_RANGE_MAX_CHARS).toBe(30_000);
  });
});

describe("contentHash", () => {
  it("is the lower-case hex SHA-256 of the UTF-8 bytes", () => {
    expect(contentHash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(contentHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const body = "héllo 😀\r\n";
    expect(contentHash(body)).toBe(
      createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex"),
    );
    expect(contentHash(body)).toMatch(/^[0-9a-f]{64}$/);
    // CRLF and LF are different bodies.
    expect(contentHash("a\r\n")).not.toBe(contentHash("a\n"));
  });
});
