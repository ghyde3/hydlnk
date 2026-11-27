import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isEmailAddress, stripHiddenCharacters } from "@/lib/document";
import { parseSubmission } from "@/lib/forms/contract";
import { localPsql } from "../../scripts/lib/local-db";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminClient, publishedOwner, record } from "./m17f-forms-db-support";

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

    it("an address the app normalises (NFKC) never holds a code point the email check refuses (finding 7)", async () => {
      const refused = await matching("[[:space:][:cntrl:]]");
      for (const c of ALL) {
        const parsed = parseSubmission("signup", false, {
          email: `a${String.fromCodePoint(c)}b@example.test`,
        });
        if (!parsed.ok) continue;
        for (const ch of parsed.values.email) {
          expect(refused.has(ch.codePointAt(0)!), c.toString(16)).toBe(false);
        }
      }
    }, 120_000);

    describe("the real store sees one spelling per address (finding 7)", () => {
      // Made in beforeAll: the describe body runs at collection, also in the unit step (no env).
      let admin: ReturnType<typeof adminClient>;
      const owners: TestOwner[] = [];
      beforeAll(() => {
        admin = adminClient();
      });
      afterAll(async () => {
        if (admin) await removeOwners(admin, owners);
      });

      it("full-width, decomposed and upper-case spellings of a stored address are duplicates", async () => {
        const owner = await publishedOwner(admin, "fnorm");
        owners.push(owner);
        const send = (email: string) => {
          const parsed = parseSubmission("signup", false, { email });
          if (!parsed.ok) return Promise.resolve("refused by the app");
          return record(admin, owner, parsed.values.email);
        };
        expect(await send("jos\u00e9@example.test")).toBe("stored");
        expect(await send("jose\u0301@example.test")).toBe("duplicate");
        expect(await send("ｊｏｓé＠ｅｘａｍｐｌｅ．ｔｅｓｔ")).toBe("duplicate");
        expect(await send("JOS\u00c9@EXAMPLE.TEST")).toBe("duplicate");
        expect(await send("jos\u200b\u00e9@example.test")).toBe("refused by the app");
        expect(await send("jos\u00e9@ex\u0430mple.test")).toBe("refused by the app");
        // A +tag is another mailbox: stored.
        expect(await send("jos\u00e9+news@example.test")).toBe("stored");
      }, 60_000);
    });
  },
);
