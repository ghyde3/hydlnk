import { describe, expect, it } from "vitest";
import {
  LOCAL_DEV_IP,
  UNKNOWN_IP_KEY,
  clientIp,
  ipForHash,
  rateLimitClientKey,
} from "@/lib/analytics/ingest/client-ip";

const h = (headers: Record<string, string>) => new Headers(headers);

describe("M4-20 the client IP", () => {
  it("is the first entry of x-forwarded-for", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
    expect(ipForHash(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("else x-real-ip", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIp(h({ "x-forwarded-for": "", "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(ipForHash(h({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("x-forwarded-for wins over x-real-ip", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.9" }))).toBe(
      "203.0.113.7",
    );
  });

  it("else 0.0.0.0 for the hash (local development) and null for the client", () => {
    expect(clientIp(h({}))).toBeNull();
    expect(ipForHash(h({}))).toBe("0.0.0.0");
    expect(LOCAL_DEV_IP).toBe("0.0.0.0");
  });

  it("an entry that is not an IP address counts as absent", () => {
    expect(clientIp(h({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "evil.example, 203.0.113.7" }))).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "<script>", "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
    expect(clientIp(h({ "x-forwarded-for": "9".repeat(80) }))).toBeNull();
  });

  it("understands IPv6", () => {
    expect(clientIp(h({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
  });
});

describe("M5-01 the rate-limit key of a client", () => {
  it("is the IPv4 address", () => {
    expect(rateLimitClientKey(h({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(rateLimitClientKey(h({ "x-forwarded-for": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("is one shared 'unknown' bucket when there is no usable client IP header", () => {
    expect(rateLimitClientKey(h({}))).toBe(UNKNOWN_IP_KEY);
    expect(rateLimitClientKey(h({ "x-forwarded-for": "garbage" }))).toBe("unknown");
    expect(UNKNOWN_IP_KEY).toBe("unknown");
  });

  it("is the /64 network of an IPv6 address, so rotating addresses inside it dodges nothing", () => {
    const a = rateLimitClientKey(h({ "x-forwarded-for": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }));
    const b = rateLimitClientKey(h({ "x-forwarded-for": "2001:db8:1:2::1" }));
    const c = rateLimitClientKey(h({ "x-forwarded-for": "2001:db8:1:3::1" }));
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(rateLimitClientKey(h({ "x-forwarded-for": "::1" }))).toBe("0:0:0:0::/64");
  });

  it("is the IPv4 address inside an IPv4-mapped IPv6 address", () => {
    expect(rateLimitClientKey(h({ "x-forwarded-for": "::ffff:203.0.113.7" }))).toBe("203.0.113.7");
  });
});
