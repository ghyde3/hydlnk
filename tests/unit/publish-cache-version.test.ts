import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_READ_CACHE_VERSION } from "@/lib/publish/tags";

/**
 * The cached public read keeps the stored published document as plain JSON in the Data Cache,
 * which outlives a deployment and is validated only after it is read. A release that tightens the
 * document schema (M3-02 removed the legacy letterCase "none") would otherwise 404 every page whose
 * cache entry still holds the old value. The key therefore carries a version, and the version is
 * bumped with the schema (found while running the production build against an on-disk cache from
 * before the migration).
 */
describe("the cached public read is versioned", () => {
  it("is past the version that still accepted letterCase none", () => {
    expect(Number(PUBLIC_READ_CACHE_VERSION)).toBeGreaterThanOrEqual(2);
  });

  it("the unstable_cache key of the tenant page carries it", () => {
    const text = readFileSync(resolve(process.cwd(), "src/app/(tenant)/published-page.ts"), "utf8");
    expect(text).toMatch(/\["tenant-page",\s*PUBLIC_READ_CACHE_VERSION,\s*pageId\]/);
  });
});
