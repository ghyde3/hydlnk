import { describe, expect, it } from "vitest";
import { parseReportInput } from "@/lib/reports";

/** M5-05: server-side validation of the report form's input. */
const PAGE = "00000000-0000-4000-8000-0000000000b1";
const ok = { page: PAGE, reason: "phishing" };

const errorsOf = (raw: unknown) => {
  const parsed = parseReportInput(raw);
  if (parsed.ok) throw new Error("expected a validation error");
  return parsed.errors;
};

describe("M5-05 report input", () => {
  it("accepts the smallest valid report", () => {
    expect(parseReportInput(ok)).toEqual({
      ok: true,
      data: {
        page: PAGE,
        address: undefined,
        reason: "phishing",
        details: undefined,
        email: undefined,
      },
    });
  });

  it("accepts an address instead of a page id, and every reason of the select", () => {
    for (const reason of ["phishing", "malware", "impersonation", "illegal", "spam"]) {
      expect(parseReportInput({ address: "mara.hydlnk.com", reason }).ok).toBe(true);
    }
    expect(
      parseReportInput({ address: "mara", reason: "other", details: "Pretends to be me." }).ok,
    ).toBe(true);
  });

  it("trims, lower-cases the page id and drops empty optional fields", () => {
    const parsed = parseReportInput({
      page: `  ${PAGE.toUpperCase()}  `,
      address: "   ",
      reason: "spam",
      details: "   ",
      email: "  ",
    });
    expect(parsed).toEqual({
      ok: true,
      data: {
        page: PAGE,
        address: undefined,
        reason: "spam",
        details: undefined,
        email: undefined,
      },
    });
  });

  it("a page id that is not a UUID is rejected, naming the page", () => {
    expect(errorsOf({ page: "not-an-id", reason: "spam" }).page).toMatch(/report link isn’t valid/);
    expect(errorsOf({ page: `${PAGE}x`, reason: "spam" }).page).toBeDefined();
  });

  it("needs a page id or an address, and says what to enter", () => {
    expect(errorsOf({ reason: "spam" }).address).toBe(
      "Enter the page’s address, like name.hydlnk.com.",
    );
    expect(errorsOf({ address: "  ", reason: "spam" }).address).toBeDefined();
  });

  it("an unknown or missing reason is rejected", () => {
    for (const reason of [
      "nonsense",
      "",
      undefined,
      null,
      7,
      ["phishing"],
      { value: "spam" },
      "PHISHING",
    ]) {
      expect(errorsOf({ ...ok, reason }).reason, JSON.stringify(reason)).toBe("Choose a reason.");
    }
  });

  it("details: 1000 characters are fine, 1001 are not, and the message says how many", () => {
    expect(parseReportInput({ ...ok, details: "x".repeat(1000) }).ok).toBe(true);
    expect(errorsOf({ ...ok, details: "x".repeat(1001) }).details).toBe(
      "Details can be at most 1000 characters. Shorten them.",
    );
    expect(errorsOf({ ...ok, details: "x".repeat(5000) }).details).toBeDefined();
  });

  it("counts details in characters, not UTF-16 units: 1000 emoji pass", () => {
    expect(parseReportInput({ ...ok, details: "😀".repeat(1000) }).ok).toBe(true);
    expect(parseReportInput({ ...ok, details: "😀".repeat(1001) }).ok).toBe(false);
  });

  it("Something else needs details (blank does not count)", () => {
    const message = "Tell us what is wrong. Details are required for Something else.";
    expect(errorsOf({ ...ok, reason: "other" }).details).toBe(message);
    expect(errorsOf({ ...ok, reason: "other", details: "  \n " }).details).toBe(message);
    expect(parseReportInput({ ...ok, reason: "other", details: "It copies my page." }).ok).toBe(
      true,
    );
  });

  it("strips control characters (a NUL would break the insert) and normalises line breaks", () => {
    const parsed = parseReportInput({ ...ok, details: "a\u0000b\u0007c\r\nd\re​f" });
    expect(parsed.ok && parsed.data.details).toBe("abc\nd\ne​f");
  });

  it("email: valid addresses pass, invalid ones are rejected naming the field", () => {
    expect(parseReportInput({ ...ok, email: "me@example.com" }).ok).toBe(true);
    for (const email of [
      "me",
      "me@",
      "@example.com",
      "a b@example.com",
      "me@example",
      "a@b@c.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(errorsOf({ ...ok, email }).email, email).toBe(
        "Enter a valid email address, or leave it empty.",
      );
    }
  });

  it("reports every bad field at once, one message each", () => {
    expect(errorsOf({ reason: "x", email: "no", details: "y".repeat(2000) })).toEqual({
      address: expect.any(String),
      reason: "Choose a reason.",
      details: expect.any(String),
      email: expect.any(String),
    });
  });

  it("garbage bodies are errors, not crashes", () => {
    for (const raw of [null, undefined, 5, "text", [], { page: { $ne: null }, reason: { a: 1 } }]) {
      expect(parseReportInput(raw).ok).toBe(false);
    }
  });

  it("a non-string in a text field counts as missing", () => {
    expect(errorsOf({ page: 5, address: ["a"], reason: "spam" }).address).toBeDefined();
    expect(parseReportInput({ ...ok, details: 5, email: {} }).ok).toBe(true);
  });
});
