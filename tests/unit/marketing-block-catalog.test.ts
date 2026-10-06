import { describe, expect, it } from "vitest";
import {
  BLOCK_CATALOG,
  BLOCK_COUNT_WORD,
  BLOCK_COUNT_WORD_CAP,
} from "@/components/marketing/block-catalog";
import { BLOCK_TYPES } from "@/lib/document";

/** The marketing catalog lists every block type, in order, and the copy's count follows it. */
describe("marketing block catalog", () => {
  it("has one entry per block type, in the same order", () => {
    expect(BLOCK_CATALOG.map((b) => b.id)).toEqual([...BLOCK_TYPES]);
  });

  it("the count in the copy is a word derived from the catalog", () => {
    expect(BLOCK_CATALOG).toHaveLength(18);
    expect(BLOCK_COUNT_WORD).toBe("eighteen");
    expect(BLOCK_COUNT_WORD_CAP).toBe("Eighteen");
  });
});
