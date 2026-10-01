import { describe, expect, it } from "vitest";
import { MAX_URL_LENGTH, mailtoUrlSchema, safeUrlSchema } from "@/lib/schemas";

const accepts = (value: string) => safeUrlSchema.safeParse(value).success;

describe("safeUrlSchema", () => {
  it.each([
    "https://example.com",
    "http://example.com/path?q=1&r=2#frag",
    "HTTPS://Example.COM/Path",
    "https://sub.domain.example.co.uk:8443/a/b",
    "http://localhost:3000/x",
    "http://127.0.0.1:54321/storage/v1/object/public/avatars/a.webp",
    "https://example.com/it's-fine",
    "https://example.com/%22encoded%22",
  ])("accepts %s", (value) => {
    expect(accepts(value)).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["javascript: in caps", "JAVASCRIPT:alert(1)"],
    ["javascript: behind whitespace", " javascript:alert(1)"],
    ["javascript: with a tab", "java\tscript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
    ["ftp:", "ftp://example.com/a"],
    ["mailto:", "mailto:a@example.com"],
    ["protocol-relative", "//example.com/a"],
    ["scheme without slashes", "https:example.com"],
    ["backslash authority", "https:\\\\example.com"],
    ["no scheme", "example.com"],
    ["relative path", "/a/b"],
    ["empty string", ""],
    ["empty host", "https://"],
    ["user and password", "https://user:pass@example.com"],
    ["user only", "https://user@example.com"],
    ["empty user", "https://@example.com"],
    ["credentials-looking host trick", "https://example.com@evil.example"],
    ["leading space", " https://example.com"],
    ["trailing space", "https://example.com "],
    ["space inside", "https://exa mple.com"],
    ["newline", "https://example.com/\nfoo"],
    ["double quote", 'https://example.com/"onmouseover="x'],
    ["angle brackets", "https://example.com/<script>"],
    ["backslash in path", "https://example.com/a\\b"],
  ])("rejects %s", (_name, value) => {
    expect(accepts(value)).toBe(false);
  });

  it("enforces the 2048 character limit", () => {
    const prefix = "https://example.com/";
    expect(accepts(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length))).toBe(true);
    expect(accepts(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length + 1))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(safeUrlSchema.safeParse(null).success).toBe(false);
    expect(safeUrlSchema.safeParse(undefined).success).toBe(false);
    expect(safeUrlSchema.safeParse(42).success).toBe(false);
  });

  it("returns the input unchanged", () => {
    expect(safeUrlSchema.parse("https://Example.com/A")).toBe("https://Example.com/A");
  });
});

describe("mailtoUrlSchema", () => {
  it.each([
    "mailto:hello@example.com",
    "MAILTO:a.b+tag@sub.example.co",
    "mailto:a@example.com?subject=Hi",
  ])("accepts %s", (value) => {
    expect(mailtoUrlSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "https://example.com",
    "javascript:alert(1)",
    "mailto:",
    "mailto:not-an-email",
    "mailto:a@example.com,b@example.com",
    "mailto:a@example.com\nBcc: x@example.com",
    'mailto:a@example.com?subject="x"',
  ])("rejects %s", (value) => {
    expect(mailtoUrlSchema.safeParse(value).success).toBe(false);
  });
});
