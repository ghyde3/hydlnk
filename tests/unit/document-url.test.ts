import { describe, expect, it } from "vitest";
import {
  MAX_EMAIL_LENGTH,
  MAX_URL_LENGTH,
  draftDocSchema,
  emailAddress,
  httpUrl,
  isEmailAddress,
  isHttpUrl,
  mailtoHref,
  normalizeUrl,
  publishDocSchema,
  safeHref,
} from "@/lib/document";
import { blocks, draftWith } from "./fixtures/page-document";

const accepts = (value: string) => httpUrl.safeParse(value).success;
const prefix = "https://example.com/";
const longest = prefix + "a".repeat(MAX_URL_LENGTH - prefix.length);

describe("httpUrl (M2-02)", () => {
  it.each([
    "https://maraokafor.com/portraits",
    "http://example.com/a?b=c#d",
    "https://example.com",
    "HTTPS://Example.COM/Path",
    "https://münchen.de/straße",
    "https://例え.jp/パス",
    "https://xn--mnchen-3ya.de/",
    "https://sub.domain.example.co.uk:8443/a/b",
    "http://localhost:3000/x",
    "http://127.0.0.1:54321/storage/v1/object/public/page-media/a.png",
    "https://[2001:db8::1]/path",
    "https://example.com/it's-fine",
    "https://example.com/%22encoded%22",
    "https://example.com/a(b)c",
    "https://example.com/?q=a+b&r=%20",
    longest,
  ])("accepts %s", (value) => {
    expect(accepts(value)).toBe(true);
  });

  it("accepts a URL of exactly 2048 chars and rejects 2049", () => {
    expect(longest).toHaveLength(2048);
    expect(accepts(longest)).toBe(true);
    expect(accepts(longest + "a")).toBe(false);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["mixed-case javascript:", "JaVaScRiPt:alert(1)"],
    ["javascript: behind whitespace", " javascript:alert(1)"],
    ["javascript: with a tab inside", "java\tscript:alert(1)"],
    ["javascript: with a newline inside", "java\nscript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["data: base64", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///etc/passwd"],
    ["blob:", "blob:https://example.com/uuid"],
    ["ftp:", "ftp://example.com/a"],
    ["mailto:", "mailto:a@b.co"],
    ["tel:", "tel:+15551234567"],
    ["protocol-relative", "//evil.example"],
    ["scheme without slashes", "https:example.com"],
    ["one slash", "https:/example.com"],
    ["backslash authority", "https:\\\\example.com"],
    ["no scheme", "example.com"],
    ["no scheme with path", "maraokafor.com/portraits"],
    ["relative path", "/a/b"],
    ["empty string", ""],
    ["no host", "https://"],
    ["no host, path only", "https:///path"],
    ["user and password", "https://user:pw@example.com"],
    ["user only", "https://user@example.com"],
    ["empty user", "https://@example.com"],
    ["credentials trick", "https://example.com@evil.example"],
    ["leading space", " https://example.com"],
    ["trailing space", "https://example.com "],
    ["space inside", "https://exa mple.com"],
    ["tab", "https://example.com/\tfoo"],
    ["newline", "https://example.com/\nfoo"],
    ["carriage return", "https://example.com/\rfoo"],
    ["NUL", "https://example.com/\u0000"],
    ["C1 control", "https://example.com/\u0085"],
    ["bidi override", "https://example.com/‮exe.txt"],
    ["bidi isolate", "https://example.com/⁦x"],
    ["double quote", 'https://example.com/"onmouseover="x'],
    ["angle brackets", "https://example.com/<script>"],
    ["backtick", "https://example.com/`x"],
    ["backslash in path", "https://example.com/a\\b"],
    ["2049 chars", longest + "a"],
  ])("rejects %s", (_name, value) => {
    expect(accepts(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(httpUrl.safeParse(value).success).toBe(false);
      expect(isHttpUrl(value)).toBe(false);
    }
  });

  it("returns the input unchanged", () => {
    expect(httpUrl.parse("https://Example.com/A")).toBe("https://Example.com/A");
  });

  it("gives the editor's one-line message", () => {
    expect(httpUrl.safeParse("javascript:alert(1)").error?.issues[0]?.message).toBe(
      "Enter a full web address, like https://example.com.",
    );
  });
});

describe("normalizeUrl", () => {
  it.each([
    ["maraokafor.com/portraits", "https://maraokafor.com/portraits"],
    ["maraokafor.com", "https://maraokafor.com"],
    ["www.example.com/a?b=c#d", "https://www.example.com/a?b=c#d"],
    ["  maraokafor.com/x  ", "https://maraokafor.com/x"],
    ["localhost:3000/x", "https://localhost:3000/x"],
    ["example.com:8080", "https://example.com:8080"],
    ["münchen.de", "https://münchen.de"],
    ["instagram.com/maraokafor", "https://instagram.com/maraokafor"],
  ])("prefixes a bare address: %s", (input, output) => {
    expect(normalizeUrl(input)).toBe(output);
    expect(accepts(output)).toBe(true);
  });

  it.each([
    "https://maraokafor.com/portraits",
    "http://example.com/a?b=c",
    "HTTPS://Example.com",
    "http://localhost:3000",
  ])("leaves %s unchanged", (input) => {
    expect(normalizeUrl(input)).toBe(input);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "javascript:1",
    "data:text/html,<script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "mailto:a@b.co",
    "tel:+15551234567",
    "ftp://example.com",
    "//evil.example",
    "https:example.com",
  ])("never prefixes %s into a valid-looking URL", (input) => {
    const out = normalizeUrl(input);
    expect(out).toBe(input);
    expect(out.startsWith("https://")).toBe(false);
    expect(accepts(out)).toBe(false);
  });

  it("keeps an empty string empty, trims, and is idempotent", () => {
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl("   ")).toBe("");
    for (const input of [
      "maraokafor.com/x",
      "javascript:alert(1)",
      "localhost:3000",
      "https://a.co",
    ]) {
      expect(normalizeUrl(normalizeUrl(input))).toBe(normalizeUrl(input));
    }
  });

  it("a string with a space inside stays invalid after prefixing", () => {
    expect(accepts(normalizeUrl("not a url"))).toBe(false);
  });
});

describe("safeHref", () => {
  it("returns the URL for a valid http(s) URL", () => {
    expect(safeHref("https://maraokafor.com/portraits")).toBe("https://maraokafor.com/portraits");
    expect(safeHref("http://example.com/a?b=c#d")).toBe("http://example.com/a?b=c#d");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>",
    "mailto:a@b.co",
    "//evil.example",
    "maraokafor.com/x",
    "https://user:pw@example.com",
    "",
    " https://example.com",
    longest + "a",
  ])("returns undefined for %s", (value) => {
    expect(safeHref(value)).toBeUndefined();
  });

  it("returns undefined for null and undefined", () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe("every URL-bearing field of publishDocSchema", () => {
  const social = (url: string) => ({
    ...blocks.social,
    icons: [{ id: "icon-instagram", platform: "instagram", url }],
  });
  const fields: [string, (url: string) => unknown][] = [
    ["link.url", (url) => draftWith({ ...blocks.link, url })],
    ["card.url", (url) => draftWith({ ...blocks.card, url })],
    ["image.url", (url) => draftWith({ ...blocks.image, url })],
    ["embed.url", (url) => draftWith({ ...blocks.embed, url })],
    ["social icon url", (url) => draftWith(social(url))],
    [
      "grid cell url",
      (url) =>
        draftWith({
          ...blocks.grid,
          cells: [{ ...blocks.grid.cells[0]!, url }, blocks.grid.cells[1]!],
        }),
    ],
  ];

  it.each(fields)(
    "%s rejects javascript: and data: URLs at publish but keeps them in the draft",
    (_name, doc) => {
      for (const bad of [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:x",
        "//evil.example",
        "mailto:a@b.co",
      ]) {
        expect(publishDocSchema.safeParse(doc(bad)).success, bad).toBe(false);
        expect(draftDocSchema.safeParse(doc(bad)).success, bad).toBe(true);
      }
    },
  );

  it.each(fields.filter(([name]) => name !== "embed.url"))(
    "%s accepts a valid URL",
    (_name, doc) => {
      expect(publishDocSchema.safeParse(doc("https://maraokafor.com/portraits")).success).toBe(
        true,
      );
    },
  );

  it("an empty url is only allowed where the field is optional", () => {
    expect(publishDocSchema.safeParse(fields[2]![1]("")).success).toBe(true);
    for (const [name, doc] of fields.filter(([n]) => n !== "image.url")) {
      expect(publishDocSchema.safeParse(doc("")).success, name).toBe(false);
    }
  });

  it("the token set's bgImage uses the same rule", async () => {
    const { tokenSetSchema } = await import("@/lib/theme");
    const { noirTokens } = await import("./fixtures/page-document");
    expect(
      tokenSetSchema.safeParse({ ...noirTokens, bgImage: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      tokenSetSchema.safeParse({ ...noirTokens, bgImage: "https://example.com/a.png" }).success,
    ).toBe(true);
  });
});

describe("emailAddress (the social email icon)", () => {
  it.each([
    "hello@maraokafor.com",
    "a@b.co",
    "first.last+tag@sub.example.co.uk",
    "o'brien@example.com",
    "user_name-1@example-mail.com",
    "info@münchen.de",
    "a".repeat(64) + "@example.com",
  ])("accepts %s", (value) => {
    expect(emailAddress.safeParse(value).success).toBe(true);
    expect(isEmailAddress(value)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["no at sign", "hello.example.com"],
    ["two at signs", "a@b@c.com"],
    ["no local part", "@example.com"],
    ["no domain", "a@"],
    ["no dot in the domain", "a@localhost"],
    ["leading dot in the domain", "a@.example.com"],
    ["trailing dot in the domain", "a@example."],
    ["empty label", "a@example..com"],
    ["space", "a b@example.com"],
    ["tab", "a\t@example.com"],
    ["newline", "a@example.com\nBcc: x@y.z"],
    ["comma (second recipient)", "a@example.com,b@example.com"],
    ["semicolon", "a@example.com;b@example.com"],
    ["query (subject injection)", "a@example.com?subject=hi"],
    ["fragment", "a@example.com#x"],
    ["angle brackets", "<a@example.com>"],
    ["display name", "Mara <a@example.com>"],
    ["mailto: prefix", "mailto:a@example.com"],
    ["quote", 'a"@example.com'],
    ["bidi override", "a‮@example.com"],
    ["local part over 64", "a".repeat(65) + "@example.com"],
    ["255 chars", "a".repeat(64) + "@" + "b".repeat(186) + ".com"],
  ])("rejects %s", (_name, value) => {
    expect(emailAddress.safeParse(value).success).toBe(false);
    expect(isEmailAddress(value)).toBe(false);
  });

  it("allows 254 characters and no more", () => {
    const at254 =
      "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(57) + ".com";
    expect(at254).toHaveLength(MAX_EMAIL_LENGTH);
    expect(isEmailAddress(at254)).toBe(true);
    expect(isEmailAddress(at254 + "m")).toBe(false);
  });

  it("is not a URL: httpUrl rejects mailto: everywhere", () => {
    expect(accepts("mailto:hello@maraokafor.com")).toBe(false);
    expect(accepts("hello@maraokafor.com")).toBe(false);
  });

  it("builds the mailto: href from a valid address only", () => {
    expect(mailtoHref("hello@maraokafor.com")).toBe("mailto:hello@maraokafor.com");
    expect(mailtoHref("a@example.com?bcc=evil@x.com")).toBeUndefined();
    expect(mailtoHref("javascript:alert(1)")).toBeUndefined();
    expect(mailtoHref("")).toBeUndefined();
    expect(mailtoHref(null)).toBeUndefined();
  });

  it("an email icon keeps an address, not a url, and publish validates it", () => {
    const icon = (address: string) =>
      draftWith({
        ...blocks.social,
        icons: [{ id: "icon-email-001", platform: "email", address }],
      });
    expect(publishDocSchema.safeParse(icon("hello@maraokafor.com")).success).toBe(true);
    expect(publishDocSchema.safeParse(icon("mailto:hello@maraokafor.com")).success).toBe(false);
    expect(publishDocSchema.safeParse(icon("")).success).toBe(false);
    expect(draftDocSchema.safeParse(icon("half-typed@")).success).toBe(true);
    // a web icon cannot smuggle a mailto: URL, and an email icon has no url field
    const web = draftWith({
      ...blocks.social,
      icons: [{ id: "icon-web-0001", platform: "website", url: "mailto:a@b.co" }],
    });
    expect(publishDocSchema.safeParse(web).success).toBe(false);
    const stripped = draftDocSchema.parse(
      draftWith({
        ...blocks.social,
        icons: [
          { id: "icon-email-001", platform: "email", address: "a@b.co", url: "javascript:x" },
        ],
      }),
    );
    expect(JSON.stringify(stripped)).not.toContain("javascript");
  });
});
