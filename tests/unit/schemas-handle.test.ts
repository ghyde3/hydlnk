import { describe, expect, it } from "vitest";
import { handleSchema } from "@/lib/schemas";

describe("handleSchema", () => {
  it.each([
    "mara",
    "abc",
    "a1b",
    "my-brand",
    "a--b",
    "0123456789",
    "a".repeat(30),
    "x-" + "y".repeat(26) + "-z",
  ])("accepts %s", (handle) => {
    expect(handleSchema.safeParse(handle).success).toBe(true);
  });

  it.each([
    ["uppercase", "Mara"],
    ["all caps", "MARA"],
    ["leading hyphen", "-mara"],
    ["trailing hyphen", "mara-"],
    ["too short (2)", "ab"],
    ["too short (1)", "a"],
    ["empty", ""],
    ["too long (31)", "a".repeat(31)],
    ["underscore", "ma_ra"],
    ["dot", "ma.ra"],
    ["space", "ma ra"],
    ["unicode letter", "mára"],
    ["surrounding space", " mara "],
    ["trailing newline", "mara\n"],
  ])("rejects %s", (_name, handle) => {
    expect(handleSchema.safeParse(handle).success).toBe(false);
  });
});
