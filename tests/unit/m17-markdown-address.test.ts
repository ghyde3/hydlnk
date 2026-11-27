// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AddressIndex,
  MAX_PARENS,
  isAddressEnd,
  type AddressStop,
} from "@/lib/blog/markdown/address";
import { seeded } from "./support/random";

/**
 * The link address index (M16-04, M16-13) answers what the scan it replaced answered: the scan
 * read the address after `](` character by character, once for every `[`. It stays here as the
 * oracle, and the index must agree with it from every start a link can read from.
 */
function scan(s: string, from: number, to: number): AddressStop {
  let depth = 0;
  let closes = 0;
  let lastClose = -1;
  let q = from;
  for (; q < to; q += 1) {
    const code = s.charCodeAt(q);
    if (isAddressEnd(code)) break;
    if (code === 0x5c) {
      if (q + 1 < to && !isAddressEnd(s.charCodeAt(q + 1))) q += 1;
    } else if (code === 0x28) {
      depth += 1;
      if (depth > MAX_PARENS) return { stop: "deep" };
    } else if (code === 0x29) {
      if (depth === 0) return { stop: "close", at: q };
      depth -= 1;
      closes += 1;
      lastClose = q;
    }
  }
  return { stop: "end", end: q, depth, closes, lastClose };
}

/** Where a link reads an address from: right after `](`, or after the spaces that follow it. */
function starts(s: string): number[] {
  const out = [0];
  for (let k = 1; k <= s.length; k += 1) {
    const before = s.charCodeAt(k - 1);
    if (
      (before === 0x28 && s[k - 2] === "]") ||
      before === 0x20 ||
      before === 0x09 ||
      before === 0x0a
    )
      out.push(k);
  }
  return out;
}



describe("the link address index agrees with a scan from every start", () => {
  const PIECES = [
    "(",
    ")",
    "](",
    "\\",
    "\\(",
    "\\)",
    "a",
    " ",
    "\t",
    "\n",
    "[",
    "]",
    "\u0001",
    " ",
    "(((",
    ")))",
  ];

  it("random bodies, every start, several ends", () => {
    const random = seeded(11);
    for (let sample = 0; sample < 400; sample += 1) {
      const parts = Array.from(
        { length: 1 + Math.floor(random() * 80) },
        () => PIECES[Math.floor(random() * PIECES.length)]!,
      );
      const s = parts.join("");
      const index = new AddressIndex(s);
      for (const from of starts(s)) {
        for (const to of [s.length, from + Math.floor(random() * (s.length - from + 1))]) {
          expect(index.read(from, to), `${JSON.stringify(s)} from ${from} to ${to}`).toEqual(
            scan(s, from, to),
          );
        }
      }
    }
  });

  it("the depth limit: 32 open parentheses are read, the 33rd ends the read", () => {
    for (const s of [
      "(".repeat(32),
      "(".repeat(33),
      `${"(".repeat(32)})`,
      `${"a(".repeat(40)})`,
      `x](${"(".repeat(40)}`,
    ]) {
      const index = new AddressIndex(s);
      for (const from of starts(s))
        expect(index.read(from, s.length), s).toEqual(scan(s, from, s.length));
    }
  });
});
