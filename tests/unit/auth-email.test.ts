import { describe, expect, it } from "vitest";
import { EMAIL_ERROR, emailSchema } from "@/lib/auth/email";

describe("M1-03 emailSchema", () => {
  it.each([
    ["a@b", "no dotted domain"],
    ["a b@c.com", "a space in the local part"],
    ["", "empty"],
    ["not-an-email", "no @"],
    ["@example.com", "no local part"],
    [`${"a".repeat(250)}@b.com`, "over 254 characters"],
    ["a".repeat(255), "a long string"],
  ])("rejects %j (%s)", (value) => {
    const result = emailSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(EMAIL_ERROR);
  });

  it("rejects non-strings", () => {
    expect(emailSchema.safeParse(undefined).success).toBe(false);
    expect(emailSchema.safeParse(42).success).toBe(false);
  });

  it("accepts ordinary addresses and trims surrounding whitespace", () => {
    expect(emailSchema.parse("e2e-login-1@example.com")).toBe("e2e-login-1@example.com");
    expect(emailSchema.parse("  mara+tag@example.co.uk  ")).toBe("mara+tag@example.co.uk");
  });

  it("accepts an address of exactly 254 characters", () => {
    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(55)}.com`;
    const address = `${local}@${domain}`;
    expect(address.length).toBeLessThanOrEqual(254);
    expect(emailSchema.safeParse(address).success).toBe(true);
  });
});
