import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESERVED_ENTRY_SLUGS, RESERVED_PATHS, RESERVED_PATH_PREFIX } from "@/lib/document/path";

/**
 * M15-02: the reserved lists in SQL (public.is_reserved_site_path, public.is_reserved_entry_slug)
 * equal the TS lists, so the two cannot drift. The behaviour is in
 * supabase/tests/database/190-content-types-paths.test.sql.
 */

const MIGRATION = readFileSync(
  "supabase/migrations/20261014000002_content_builtin_types_paths.sql",
  "utf8",
);

function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`create function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));
}

const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

describe("the reserved lists in SQL equal the TS lists", () => {
  it("is_reserved_site_path lists exactly RESERVED_PATHS", () => {
    const body = functionBody("is_reserved_site_path");
    const list = body.match(/p_path in \(([\s\S]*?)\)/)?.[1] ?? "";
    expect(quoted(list).sort()).toEqual([...RESERVED_PATHS].sort());
  });

  it("is_reserved_site_path has the hl- prefix", () => {
    expect(functionBody("is_reserved_site_path")).toContain(
      `p_path like '${RESERVED_PATH_PREFIX}%'`,
    );
  });

  it("is_reserved_entry_slug lists exactly RESERVED_ENTRY_SLUGS", () => {
    const body = functionBody("is_reserved_entry_slug");
    const list = body.match(/p_slug in \(([\s\S]*?)\)/)?.[1] ?? "";
    expect(quoted(list).sort()).toEqual([...RESERVED_ENTRY_SLUGS].sort());
  });

  it("the slice 1 check on content_entries names the same slugs", () => {
    const slice1 = readFileSync("supabase/migrations/20261014000001_content_tables.sql", "utf8");
    const list = slice1.match(/live_slug not in \(([\s\S]*?)\)/)?.[1] ?? "";
    expect(quoted(list).sort()).toEqual([...RESERVED_ENTRY_SLUGS].sort());
  });
});
