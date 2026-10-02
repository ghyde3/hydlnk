import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";

/**
 * M2-04: the client estimates `octet_length(draft::text)` before it sends a draft. jsonb text has a
 * space after every ":" and "," outside strings, so JSON.stringify alone under-counts it.
 */
describe("jsonbTextBytes", () => {
  it('counts jsonb\'s extra spaces: {"a": 1, "b": [1, 2]}', () => {
    const value = { a: 1, b: [1, 2] };
    expect(JSON.stringify(value)).toBe('{"a":1,"b":[1,2]}');
    expect(jsonbTextBytes(value)).toBe('{"a": 1, "b": [1, 2]}'.length);
  });

  it("does not count ':' or ',' inside strings (or escaped quotes)", () => {
    const value = { k: 'a:b,c "d:e" \\ f' };
    // {"k": "..."}: one separator outside the string.
    expect(jsonbTextBytes(value)).toBe(JSON.stringify(value).length + 1);
  });

  it("counts bytes, not characters", () => {
    expect(jsonbTextBytes("é")).toBe(4); // "é" is two bytes plus the quotes
    expect(jsonbTextBytes({ k: "😀" })).toBe('{"k": "😀"}'.length - 1 + 3); // 4-byte emoji, 2 UTF-16 units
  });

  it("matches the size of Postgres' own text for the limit test values", () => {
    // pgTAP 080: jsonb_build_object('blob', repeat('x', n)) is 12 bytes of structure plus n.
    expect(jsonbTextBytes({ blob: "x".repeat(200000) })).toBe(200012);
    expect(jsonbTextBytes({ blob: "x".repeat(LIMITS.draftBytes - 12) })).toBe(LIMITS.draftBytes);
  });

  it("is 0 for undefined", () => {
    expect(jsonbTextBytes(undefined)).toBe(0);
  });
});
