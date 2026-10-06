import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The migration that rewrites legacy token values (letterCase "none", heading weight 800, a
 * background image that is not an upload) is a data update, so what proves it is the pgTAP file
 * that runs the same statements on rows holding those values. That file repeats the migration's
 * block verbatim; this test makes sure the two cannot drift apart.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const block = (text: string): string => {
  const start = text.indexOf("-- >>> rewrite");
  const end = text.indexOf("-- <<< rewrite");
  expect(start, "start marker").toBeGreaterThan(-1);
  expect(end, "end marker").toBeGreaterThan(start);
  return text.slice(start, end + "-- <<< rewrite".length);
};

describe("the legacy token value migration", () => {
  const migration = read("supabase/migrations/20261002100004_normalize_legacy_token_values.sql");
  const pgtap = read("supabase/tests/database/093-legacy-token-values.test.sql");

  it("the pgTAP test runs the migration's statements verbatim", () => {
    expect(block(pgtap)).toBe(block(migration));
  });

  it("only updates JSON values; it creates no table and drops nothing", () => {
    const sql = block(migration).replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(drop|truncate|delete|alter)\b/i);
    expect(sql).toMatch(/update public\.themes/);
    expect(sql).toMatch(/update public\.pages/);
  });
});
