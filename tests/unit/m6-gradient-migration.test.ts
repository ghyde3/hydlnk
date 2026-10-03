import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M6-41: the migration that adds the three gradient tokens (gradientAngle 180, gradientFrom null,
 * gradientTo null) to every stored complete token set is a data update, so what proves it is the
 * pgTAP file that runs the same statements on rows that lack them. That file repeats the migration's
 * block verbatim; this test makes sure the two cannot drift apart, and that the block only updates
 * JSON values.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const block = (text: string): string => {
  const start = text.indexOf("-- >>> rewrite");
  const end = text.indexOf("-- <<< rewrite");
  expect(start, "start marker").toBeGreaterThan(-1);
  expect(end, "end marker").toBeGreaterThan(start);
  return text.slice(start, end + "-- <<< rewrite".length);
};

describe("the gradient tokens migration", () => {
  const migration = read("supabase/migrations/20261006000000_gradient_tokens.sql");
  const pgtap = read("supabase/tests/database/135-gradient-tokens.test.sql");

  it("the pgTAP test runs the migration's statements verbatim", () => {
    expect(block(pgtap)).toBe(block(migration));
  });

  it("only updates JSON values; it creates no table and drops nothing", () => {
    const sql = block(migration).replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(drop|truncate|delete|alter)\b/i);
    expect(sql).toMatch(/update public\.themes/);
    expect(sql).toMatch(/update public\.pages/);
  });

  it("touches only themes.tokens and pages.published -> tokens; the draft and published_at stay as they are", () => {
    const sql = block(migration).replace(/--.*$/gm, "");
    const sets = [...sql.matchAll(/\bset\s+(\w+)\s*=/gi)].map((match) => match[1]);
    expect(sets.sort()).toEqual(["published", "tokens"]);
    expect(sql).not.toMatch(/\bdraft\b/);
    expect(sql).not.toMatch(/published_at/);
    expect(sql).toMatch(/jsonb_set\(published, '\{tokens\}'/);
  });

  it("adds exactly the three defaults, with the existing keys winning", () => {
    const sql = block(migration);
    expect(sql).toContain(
      "jsonb_build_object('gradientAngle', 180, 'gradientFrom', null, 'gradientTo', null) || t",
    );
  });

  it("only completes a complete set, and does nothing for a set that has the keys (it re-runs safely)", () => {
    const sql = block(migration);
    for (const key of [
      "bg",
      "surface",
      "text",
      "textMuted",
      "accent",
      "buttonBg",
      "buttonText",
      "border",
      "fontHeading",
      "fontBody",
      "scale",
      "weightHeading",
      "letterCase",
      "radius",
      "borderWidth",
      "buttonStyle",
      "density",
      "maxWidth",
      "align",
      "bgType",
      "bgImage",
      "overlayOpacity",
      "blur",
    ]) {
      expect(sql, key).toContain(`'${key}'`);
    }
    expect(sql).toMatch(/t \?& array\['gradientAngle', 'gradientFrom', 'gradientTo'\] then t/);
    expect(sql).toMatch(/is distinct from/);
  });

  it("the migration sorts before the ones of the other Milestone 6 features that follow it", () => {
    expect("20261006000000_gradient_tokens.sql" < "20261006000001_more_themes.sql").toBe(true);
  });
});
