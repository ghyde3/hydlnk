import { describe, expect, it } from "vitest";
import { isEmailAddress, stripHiddenCharacters } from "@/lib/document";
import { localPsql } from "../../scripts/lib/local-db";
import { stackIsUp } from "./publish-support";

/**
 * Review B8: the app and the database refuse one set of characters. The checks of
 * public.form_submissions use Postgres's own classes (`[[:cntrl:]]`, `[[:space:]]` and the bidi
 * ranges); this asks the REAL database which code points they match, every one from U+0001 to
 * U+10FFFF, and compares them with what the app strips (`stripHiddenCharacters`, name and message)
 * and refuses (`isEmailAddress`). Found this way, not guessed: U+2028 and U+2029 are not control
 * characters to Postgres (both are kept in a name or a message and stored, pgTAP 219), and they are
 * space, so an address holding one is refused by both.
 */
const { run } = await stackIsUp();

const ALL = (() => {
  const points: number[] = [];
  for (let c = 1; c <= 0x10ffff; c++) if (c < 0xd800 || c > 0xdfff) points.push(c);
  return points;
})();

async function matching(pattern: string): Promise<Set<number>> {
  const out = await localPsql(
    `select string_agg(c::text, ',') from generate_series(1, 1114111) c
     where (c < 55296 or c > 57343) and chr(c) ~ '${pattern}';`,
  );
  return new Set(out.trim() === "" ? [] : out.trim().split(",").map(Number));
}

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe.skipIf(!run)(
  "M17-06 the app strips exactly what the table's checks refuse (local Supabase)",
  () => {
    it("a name: the app removes exactly the code points [[:cntrl:]] and the bidi ranges match", async () => {
      const refused = new Set([
        ...(await matching("[[:cntrl:]]")),
        ...(await matching("[‪-‮⁦-⁩]")),
      ]);
      const stripped = new Set(
        ALL.filter(
          (c) =>
            stripHiddenCharacters(`a${String.fromCodePoint(c)}b`) !==
            `a${String.fromCodePoint(c)}b`,
        ),
      );
      expect(sorted(stripped)).toEqual(sorted(refused));
      expect(refused.has(0x2028)).toBe(false);
      expect(refused.has(0x2029)).toBe(false);
    }, 120_000);

    it("a message: the same set but the line feed, which both keep", async () => {
      const refused = new Set(
        [...(await matching("[[:cntrl:]]")), ...(await matching("[‪-‮⁦-⁩]"))].filter(
          (c) => c !== 0x0a,
        ),
      );
      const stripped = new Set(
        ALL.filter(
          (c) =>
            stripHiddenCharacters(`a${String.fromCodePoint(c)}b`, { multiline: true }) !==
            `a${String.fromCodePoint(c)}b`,
        ),
      );
      // A carriage return is stripped by the app too (CRLF becomes LF before it: contract.ts).
      expect(sorted(stripped)).toEqual(sorted(refused));
    }, 120_000);

    it("an address: every code point the email check refuses ([[:space:]], [[:cntrl:]]) is refused by the app", async () => {
      const refused = new Set([...(await matching("[[:space:][:cntrl:]]"))]);
      for (const c of refused) {
        expect(isEmailAddress(`a${String.fromCodePoint(c)}b@example.test`), c.toString(16)).toBe(
          false,
        );
      }
      expect(refused.has(0x2028)).toBe(true);
    }, 120_000);
  },
);
