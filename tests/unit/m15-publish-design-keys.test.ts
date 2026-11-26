import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publishedDocSchema } from "@/lib/document/schema";

/**
 * M15-10: the design key allowlist of public.publish_design equals the top-level keys of the
 * published document without `blocks`, so the SQL and the schema cannot drift. The behaviour is in
 * supabase/tests/database/209-publish-design.test.sql.
 */

const MIGRATION = readFileSync("supabase/migrations/20261126051628_per_page_publish.sql", "utf8");

function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`create function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));
}

const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

describe("publish_design's key allowlist", () => {
  const list =
    functionBody("publish_design").match(
      /v_allowed constant text\[\] := array\[([\s\S]*?)\]/,
    )?.[1] ?? "";

  it("lists exactly the keys of the published document, without blocks", () => {
    const expected = Object.keys(publishedDocSchema.shape).filter((key) => key !== "blocks");
    expect(expected.length).toBeGreaterThan(0);
    expect(quoted(list).sort()).toEqual(expected.sort());
  });

  it("never lists blocks, and the function refuses the key by name", () => {
    expect(quoted(list)).not.toContain("blocks");
    expect(functionBody("publish_design")).toContain("p_design ? 'blocks'");
  });
});
