import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEMO_BRANDS } from "@/components/marketing/demo/brands";
import { SHOW_BRANDS } from "@/components/marketing/showcase/data";
import { handleSchema } from "@/lib/schemas/handle";
import { normalizeHandle, validateHandle } from "@/lib/handles/rules";

/**
 * Every handle the marketing demos put in a phone's address bar must be one a visitor could really
 * claim: it passes the real handle rules, and it is not on the reserved list. The reserved list
 * lives in the database (the reference-data migration), so it is read from there, not copied.
 */

// The carousel data imports font modules built on next/font, which only runs inside the Next build.
// Any font loader becomes a stub that returns the fields the modules read.
vi.mock("next/font/google", () => {
  const loader = () => ({ variable: "--font-stub", className: "font-stub", style: {} });
  return {
    Fraunces: loader,
    Instrument_Serif: loader,
    Geist: loader,
    Bricolage_Grotesque: loader,
    DM_Sans: loader,
    Inter: loader,
    Lora: loader,
    Manrope: loader,
    Playfair_Display: loader,
    Space_Grotesk: loader,
  };
});

const RESERVED = (() => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261001000002_reference_data.sql"),
    "utf8",
  );
  const block = sql.slice(sql.indexOf("unnest(array["), sql.indexOf("]) as handle"));
  return new Set([...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]));
})();

const HANDLES = [
  ...DEMO_BRANDS.map((b) => ({ id: b.id, handle: b.handle })),
  ...SHOW_BRANDS.map((b) => ({ id: b.id, handle: b.handle })),
];

describe("marketing demo handles", () => {
  it("reads a real reserved list", () => {
    expect(RESERVED.size).toBeGreaterThan(50);
    expect(RESERVED.has("static")).toBe(true);
  });

  it("covers the hero brands and the whole carousel", () => {
    expect(DEMO_BRANDS.length).toBe(3);
    expect(SHOW_BRANDS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(HANDLES)("$id: $handle is a claimable handle", ({ handle }) => {
    expect(handleSchema.safeParse(handle).success).toBe(true);
    expect(normalizeHandle(handle)).toBe(handle);
    expect(validateHandle(handle)).toBe("ok");
    expect(RESERVED.has(handle)).toBe(false);
  });

  it("uses no handle twice", () => {
    const all = HANDLES.map((h) => h.handle);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the carousel handles short", () => {
    for (const { handle } of SHOW_BRANDS) expect(handle.length).toBeLessThanOrEqual(8);
  });
});
