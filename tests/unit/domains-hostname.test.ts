import { describe, expect, it } from "vitest";
import { HOSTNAME_PATTERN, normalizeHostname } from "@/lib/domains/hostname";

/**
 * M4-11: the hostname validator. One function drives the server actions and the inline error under
 * the Domain input, so every refusal here is a 400 invalid_hostname with no row and no Vercel call
 * (core.ts runs it first; domains-core.test.ts proves the "nothing happens" part).
 */

const ok = (input: string, options?: { rootDomain?: string }) => {
  const result = normalizeHostname(input, options);
  if (!result.ok) throw new Error(`expected ${JSON.stringify(input)} to pass: ${result.message}`);
  return result.hostname;
};
const refused = (input: unknown, options?: { rootDomain?: string }) => {
  const result = normalizeHostname(input, options);
  if (result.ok) throw new Error(`expected ${JSON.stringify(input)} to be refused`);
  expect(result.code).toBe("invalid_hostname");
  return result.message;
};

describe("M4-11 what is accepted, and how it is normalised", () => {
  it("lower-cases, drops a trailing dot and surrounding spaces", () => {
    expect(ok("LINKS.Example.Test.")).toBe("links.example.test");
    expect(ok("  links.example.com  ")).toBe("links.example.com");
    expect(ok("a.b.example.co.uk")).toBe("a.b.example.co.uk");
    expect(ok("example.com")).toBe("example.com");
    expect(ok("my-links.example.org")).toBe("my-links.example.org");
  });

  it("stores an internationalised name in punycode", () => {
    expect(ok("bücher.example")).toBe("xn--bcher-kva.example");
    expect(ok("BÜCHER.Example.")).toBe("xn--bcher-kva.example");
    expect(ok("xn--bcher-kva.example")).toBe("xn--bcher-kva.example");
  });

  it("everything it accepts passes the database's domains_hostname_format shape", () => {
    for (const input of ["links.example.test", "bücher.example", "a.b.c.d.example.co.uk", "x1.example.io"]) {
      expect(HOSTNAME_PATTERN.test(ok(input))).toBe(true);
    }
  });

  it("a name that merely contains hydlnk or vercel is fine", () => {
    expect(ok("links.nothydlnk.com")).toBe("links.nothydlnk.com");
    expect(ok("hydlnk.com.example.org")).toBe("hydlnk.com.example.org");
    expect(ok("vercel.app.example.org")).toBe("vercel.app.example.org");
  });
});

describe("M4-11 what is refused, with a message that says what to do", () => {
  const JUST_THE_DOMAIN = "Enter just the domain, like links.example.com.";

  it.each([
    ["a scheme", "https://links.example.test"],
    ["a path", "links.example.test/page"],
    ["a port", "links.example.test:3000"],
    ["a space", "links example.test"],
    ["a wildcard", "*.example.test"],
    ["a query", "links.example.test?x=1"],
    ["a fragment", "links.example.test#top"],
    ["credentials", "user@links.example.test"],
    ["a backslash", "links.example.test\\page"],
  ])("%s: %s", (_label, input) => {
    expect(refused(input)).toBe(JUST_THE_DOMAIN);
  });

  it("empty and non-string input", () => {
    expect(refused("")).toMatch(/Enter the domain you want to connect/);
    expect(refused("   ")).toMatch(/Enter the domain you want to connect/);
    expect(refused(undefined)).toMatch(/Enter the domain/);
    expect(refused(null)).toMatch(/Enter the domain/);
    expect(refused(42)).toMatch(/Enter the domain/);
  });

  it("single labels and local names", () => {
    expect(refused("localhost")).toMatch(/Enter a full domain/);
    expect(refused("intranet")).toMatch(/Enter a full domain/);
    expect(refused("app.localhost")).toBe("That is a local address. Use a domain you own.");
    expect(refused("a.b.localhost")).toMatch(/local address/);
  });

  it("IP addresses in every notation", () => {
    for (const input of ["203.0.113.5", "127.0.0.1", "0x7f.0.0.1", "2130706433", "1.2.3.4.5"]) {
      expect(refused(input)).toMatch(/not an IP address|Enter a full domain/);
    }
    expect(refused("203.0.113.5")).toBe("Use a domain name, not an IP address, like links.example.com.");
  });

  it("characters a hostname cannot have", () => {
    expect(refused("a_b.example.test")).toMatch(/letters, numbers and hyphens/);
    expect(refused("a b.example.test")).toBe(JUST_THE_DOMAIN);
    expect(refused("a..example.test")).toMatch(/letters, numbers and hyphens/);
    expect(refused(".example.test")).toMatch(/letters, numbers and hyphens/);
    expect(refused("a!.example.test")).toMatch(/letters, numbers and hyphens/);
    expect(refused("-a.example.test")).toMatch(/letters, numbers and hyphens/);
    expect(refused("a-.example.test")).toMatch(/letters, numbers and hyphens/);
    expect(refused("example.t")).toMatch(/letters, numbers and hyphens/);
    expect(refused("example.123")).toMatch(/not an IP address/);
  });

  it("a name over 253 characters and a label over 63", () => {
    const label = "a".repeat(60);
    expect(refused(`${label}.${label}.${label}.${label}.example.com`)).toMatch(/too long/);
    expect(refused(`${"a".repeat(64)}.example.com`)).toBe(
      "Each part of a domain can be up to 63 characters. Shorten it.",
    );
    expect(ok(`${"a".repeat(63)}.example.com`)).toBe(`${"a".repeat(63)}.example.com`);
    expect(refused("a".repeat(5000) + ".example.com")).toMatch(/too long/);
  });

  it("HYDLNK's own addresses, in any case", () => {
    const message = "That is a HYDLNK address. Use a domain you own.";
    for (const input of ["hydlnk.com", "www.hydlnk.com", "mara.hydlnk.com", "HYDLNK.COM", "a.b.hydlnk.com", "hydlnk.com."]) {
      expect(refused(input)).toBe(message);
    }
  });

  it("the deployment's own root domain, when one is given", () => {
    expect(refused("links.staging-hydlnk.example", { rootDomain: "staging-hydlnk.example" })).toMatch(/HYDLNK address/);
    expect(refused("staging-hydlnk.example", { rootDomain: "staging-hydlnk.example:3000" })).toMatch(/HYDLNK address/);
    expect(ok("links.example.org", { rootDomain: "staging-hydlnk.example" })).toBe("links.example.org");
  });

  it("*.vercel.app", () => {
    expect(refused("foo.vercel.app")).toBe("That is a Vercel address. Use a domain you own.");
    expect(refused("vercel.app")).toMatch(/Vercel address/);
    expect(refused("a.b.VERCEL.APP")).toMatch(/Vercel address/);
  });

  it("never throws, whatever it is given", () => {
    for (const input of ["\u0000", "\uD800", "a‮b.example.com", "😀.example.com", "%41.example.com", "xn--.example.com", "ﬁ.example.com"]) {
      expect(() => normalizeHostname(input)).not.toThrow();
    }
  });
});
