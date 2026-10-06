import { describe, expect, it } from "vitest";
import {
  DOMAIN_MESSAGES,
  REASON_MESSAGES,
  fieldOfMessage,
  normalizeBlockedDomain,
  normalizeReason,
  storedDomainOf,
} from "@/lib/blocklist/admin-domain";
import { formatAddedDate } from "@/lib/blocklist/admin-view";

/**
 * M7-12: what an admin types at /admin/blocked-links becomes a `blocked_domains` row. The platform's
 * URL parser reads it (the one the Publish check uses), the result has to fit the table's own check,
 * and every refusal has one fixed sentence.
 */

const domain = (text: string) => normalizeBlockedDomain(text);
const stored = (text: string) => {
  const result = domain(text);
  if (!result.ok) throw new Error(`expected ${text} to normalize, got: ${result.message}`);
  return result.value;
};
const refused = (text: string) => {
  const result = domain(text);
  if (result.ok) throw new Error(`expected ${text} to be refused, got: ${result.value}`);
  return result.message;
};

/** The table's `blocked_domains_normalized` check, as the migration writes it. */
const TABLE_CHECK = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

describe("M7-12 normalizing a domain", () => {
  it("reads a bare domain, a pasted URL and a messy one the same way", () => {
    expect(stored("example.com")).toBe("example.com");
    expect(stored("https://user:pw@Shop.Example.COM:8080/a?b#c")).toBe("shop.example.com");
    expect(stored("EXAMPLE.com.")).toBe("example.com");
    expect(stored("https://www.example.com/x")).toBe("example.com");
    expect(stored("  http://Example.com/path  ")).toBe("example.com");
    expect(stored("example.com:8080/x")).toBe("example.com");
  });

  it("removes one leading www. and only one, and never from a domain that would have no dot left", () => {
    expect(stored("www.example.com")).toBe("example.com");
    expect(stored("www.www.example.com")).toBe("www.example.com");
    expect(stored("www.com")).toBe("www.com");
    expect(stored("shop.www.example.com")).toBe("shop.www.example.com");
  });

  it("stores an international domain as punycode (the Cyrillic e becomes xn--)", () => {
    const cyrillicE = String.fromCodePoint(0x435);
    const result = stored(`${cyrillicE}xample.com`);
    expect(result).toBe("xn--xample-2of.com");
    expect(result).not.toBe("example.com");
  });

  it("always satisfies the table's check and holds a dot", () => {
    for (const text of [
      "example.com",
      "https://a-b.example.co.uk/x",
      "x.y.z.example.test",
      "EXAMPLE.COM",
      "1.example.com",
    ]) {
      const result = stored(text);
      expect(TABLE_CHECK.test(result), result).toBe(true);
      expect(result.length).toBeLessThanOrEqual(253);
      expect(result).toContain(".");
    }
  });

  it("passes co.uk as typed: there is no public-suffix list, so an admin types the whole domain", () => {
    expect(stored("co.uk")).toBe("co.uk");
  });

  it("refuses nothing, whitespace and anything without a host with 'Enter a domain'", () => {
    for (const text of [
      "",
      "   ",
      "https://",
      "http:///",
      "javascript:alert(1)",
      "exam ple.com",
      "example.com'; drop table pages; --",
      "<script>alert(1)</script>",
      "foo_bar.com",
      "*.example.com",
      "-bad.example.com",
    ]) {
      expect(refused(text), JSON.stringify(text)).toBe(DOMAIN_MESSAGES.empty);
    }
    expect(DOMAIN_MESSAGES.empty).toBe("Enter a domain, such as example.com.");
  });

  it("refuses a single label ('com', 'localhost') with 'Use the full domain'", () => {
    expect(refused("com")).toBe("Use the full domain, such as example.com.");
    expect(refused("localhost")).toBe("Use the full domain, such as example.com.");
    expect(refused("https://intranet/")).toBe("Use the full domain, such as example.com.");
  });

  it("refuses an IP address in any notation with 'IP addresses are blocked already.'", () => {
    for (const text of [
      "1.2.3.4",
      "http://127.0.0.1:3000/",
      "0x7f.1",
      "[::1]",
      "http://[2001:db8::1]/",
    ]) {
      expect(refused(text), text).toBe("IP addresses are blocked already.");
    }
  });

  it("refuses a name over 253 characters with 'That domain is too long.'", () => {
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(30)}.com`;
    expect(long.length).toBeGreaterThan(253);
    expect(refused(long)).toBe("That domain is too long.");
    // 253 exactly is fine.
    const exact = `${"a".repeat(61)}.${"b".repeat(61)}.${"c".repeat(61)}.${"d".repeat(63)}.com`;
    expect(exact.length).toBe(253);
    expect(stored(exact)).toBe(exact);
  });

  it("never yields a value that could carry SQL, markup or a path", () => {
    for (const text of [
      "a.com/<script>",
      "a.com?x=1;drop table x",
      "https://a.com/%27",
      "a.com#<b>",
    ]) {
      const result = domain(text);
      if (result.ok) expect(TABLE_CHECK.test(result.value)).toBe(true);
    }
  });
});

describe("M7-12 the reason", () => {
  it("is trimmed plain text of 1 to 120 characters", () => {
    expect(normalizeReason("  ip-logger  ")).toEqual({ ok: true, value: "ip-logger" });
    expect(normalizeReason("<script>alert(1)</script>")).toEqual({
      ok: true,
      value: "<script>alert(1)</script>",
    });
    expect(normalizeReason("x".repeat(120)).ok).toBe(true);
    // 120 emoji are 120 characters to the person typing them.
    expect(normalizeReason(String.fromCodePoint(0x1f600).repeat(120)).ok).toBe(true);
  });

  it("an empty reason is 'Add a reason so others know why.'", () => {
    expect(normalizeReason("")).toEqual({ ok: false, message: "Add a reason so others know why." });
    expect(normalizeReason("   ")).toEqual({ ok: false, message: REASON_MESSAGES.empty });
  });

  it("over 120 characters is 'Use 120 characters or fewer for the reason.'", () => {
    expect(normalizeReason("x".repeat(121))).toEqual({
      ok: false,
      message: "Use 120 characters or fewer for the reason.",
    });
    expect(normalizeReason(String.fromCodePoint(0x1f600).repeat(121)).ok).toBe(false);
  });

  it("refuses control and bidi characters", () => {
    for (const code of [
      0x00, 0x07, 0x0a, 0x1b, 0x7f, 0x85, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0x2028,
      0x061c,
    ]) {
      const text = `ok${String.fromCodePoint(code)}ok`;
      expect(normalizeReason(text), code.toString(16)).toEqual({
        ok: false,
        message: REASON_MESSAGES.plain,
      });
    }
  });
});

describe("M7-12 the domain of a removal", () => {
  it("is the exact stored shape, lower-cased: nothing is parsed as a URL", () => {
    expect(storedDomainOf("shop.example.test")).toBe("shop.example.test");
    expect(storedDomainOf("  Shop.Example.TEST ")).toBe("shop.example.test");
    expect(storedDomainOf("2no.co")).toBe("2no.co");
  });

  it("refuses anything that cannot be an entry", () => {
    for (const text of [
      "",
      "https://example.com",
      "example.com/x",
      "example.com.",
      "exa mple.com",
      "a'; drop table blocked_domains; --",
      "x".repeat(254),
      "-x.com",
    ]) {
      expect(storedDomainOf(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe("M7-13 which field a refusal belongs under", () => {
  it("puts the reason sentences under Reason, the domain sentences and 'already blocked' under Domain, the rest under the form", () => {
    for (const message of Object.values(REASON_MESSAGES))
      expect(fieldOfMessage(message)).toBe("reason");
    for (const message of Object.values(DOMAIN_MESSAGES))
      expect(fieldOfMessage(message)).toBe("domain");
    expect(fieldOfMessage("example.com is already blocked.")).toBe("domain");
    expect(fieldOfMessage("That didn’t work. Try again.")).toBe("form");
    expect(fieldOfMessage("That request isn’t valid.")).toBe("form");
    expect(fieldOfMessage("You’re signed out. Sign in again.")).toBe("form");
  });
});

describe("M7-13 the added date", () => {
  it("is a short US date in UTC, 'Oct 3, 2026'", () => {
    expect(formatAddedDate("2026-10-03T14:05:00.000Z")).toBe("Oct 3, 2026");
    expect(formatAddedDate("2026-10-03T23:59:59+00:00")).toBe("Oct 3, 2026");
    expect(formatAddedDate("2026-01-09T00:00:00Z")).toBe("Jan 9, 2026");
    expect(formatAddedDate("not a date")).toBe("");
  });
});
