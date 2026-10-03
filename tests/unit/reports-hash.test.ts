import { describe, expect, it } from "vitest";
import {
  clientIpOf,
  dailySalt,
  ipBucketOf,
  reporterHash,
  reporterHashes,
  UNKNOWN_IP,
} from "@/lib/reports";

/** M5-05: the reporter id is a salted hash with a daily-rotating salt, never an IP. */
const SECRET = "test-visitor-hash-secret";
const IP = "203.0.113.7";
const at = (iso: string) => new Date(iso);

describe("M5-05 reporter hash", () => {
  it("is 64 lower-case hex characters and does not contain the IP", () => {
    const hash = reporterHash(IP, SECRET, at("2026-10-03T12:00:00Z"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203");
  });

  it("is stable inside a UTC day and changes at midnight", () => {
    const a = reporterHash(IP, SECRET, at("2026-10-03T00:00:01Z"));
    expect(reporterHash(IP, SECRET, at("2026-10-03T23:59:59Z"))).toBe(a);
    expect(reporterHash(IP, SECRET, at("2026-10-04T00:00:00Z"))).not.toBe(a);
  });

  it("changes with the IP and with the secret", () => {
    const day = at("2026-10-03T12:00:00Z");
    const a = reporterHash(IP, SECRET, day);
    expect(reporterHash("203.0.113.8", SECRET, day)).not.toBe(a);
    expect(reporterHash(IP, `${SECRET}x`, day)).not.toBe(a);
  });

  it("the salt is HMAC(secret, UTC date) and is not the date or the secret", () => {
    const salt = dailySalt(SECRET, at("2026-10-03T12:00:00Z"));
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(salt).not.toContain("2026");
    expect(dailySalt(SECRET, at("2026-10-03T01:00:00Z"))).toBe(salt);
    expect(dailySalt(SECRET, at("2026-10-04T01:00:00Z"))).not.toBe(salt);
  });

  it("returns today's hash first and yesterday's second, so midnight does not make a reporter new", () => {
    const now = at("2026-10-04T00:30:00Z");
    const [today, yesterday] = reporterHashes(IP, SECRET, now);
    expect(today).toBe(reporterHash(IP, SECRET, now));
    expect(yesterday).toBe(reporterHash(IP, SECRET, at("2026-10-03T00:30:00Z")));
    expect(today).not.toBe(yesterday);
  });
});

describe("M5-05 client ip", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("prefers the platform headers, then x-forwarded-for's first entry, then x-real-ip", () => {
    expect(
      clientIpOf(
        headers({ "x-vercel-forwarded-for": "198.51.100.1", "x-forwarded-for": "203.0.113.7" }),
      ),
    ).toBe("198.51.100.1");
    expect(clientIpOf(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIpOf(headers({ "x-real-ip": "2001:DB8::1" }))).toBe("2001:db8::1");
  });

  it("on Vercel only the platform's own header is believed: a client-sent x-forwarded-for or x-real-ip mints no new reporter", () => {
    const before = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(
        clientIpOf(
          headers({ "x-vercel-forwarded-for": "198.51.100.1", "x-forwarded-for": "203.0.113.7" }),
        ),
      ).toBe("198.51.100.1");
      expect(clientIpOf(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe(UNKNOWN_IP);
      expect(clientIpOf(headers({ "x-real-ip": "203.0.113.7" }))).toBe(UNKNOWN_IP);
    } finally {
      if (before === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = before;
    }
  });

  it("no usable header lands in one shared bucket instead of skipping the limit", () => {
    expect(clientIpOf(headers({}))).toBe(UNKNOWN_IP);
    expect(clientIpOf(headers({ "x-forwarded-for": "" }))).toBe(UNKNOWN_IP);
    expect(clientIpOf(headers({ "x-forwarded-for": "not an ip" }))).toBe(UNKNOWN_IP);
    expect(clientIpOf(headers({ "x-forwarded-for": "x".repeat(200) }))).toBe(UNKNOWN_IP);
  });
});

describe("M5-05 the reporter bucket: an IPv4 address, or an IPv6 /64", () => {
  it("leaves an IPv4 address and the unknown bucket as they are", () => {
    expect(ipBucketOf("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucketOf(UNKNOWN_IP)).toBe(UNKNOWN_IP);
  });

  it("reduces every IPv6 notation to the same /64 prefix", () => {
    const prefix = "2001:db8:1:2::/64";
    for (const ip of [
      "2001:db8:1:2:aaaa:bbbb:cccc:dddd",
      "2001:DB8:1:2::1",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:db8:1:2::",
      "2001:db8:1:2:0:0:0:ffff",
      "2001:db8:1:2::1%eth0",
    ]) {
      expect(ipBucketOf(ip), ip).toBe(prefix);
    }
    expect(ipBucketOf("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(ipBucketOf("2001:db8:0:0::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucketOf("::1")).toBe("0:0:0:0::/64");
    expect(ipBucketOf("::")).toBe("0:0:0:0::/64");
    expect(ipBucketOf("fe80::1")).toBe("fe80:0:0:0::/64");
    expect(ipBucketOf("1::")).toBe("1:0:0:0::/64");
  });

  it("reads an IPv4-mapped IPv6 address as its IPv4 address, in either spelling", () => {
    expect(ipBucketOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucketOf("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(ipBucketOf("0:0:0:0:0:ffff:1.2.3.4")).toBe("1.2.3.4");
    // Not mapped: an IPv4-compatible-looking address in another range is just an IPv6 /64.
    expect(ipBucketOf("64:ff9b::203.0.113.7")).toBe("64:ff9b:0:0::/64");
  });

  it("keeps anything that is not an IP address as it is (it still hashes, it never skips the limit)", () => {
    for (const odd of [
      "1:2:3:4:5:6:7:8:9",
      "::g",
      "1::2::3",
      "12345::1",
      "::ffff:999.1.1.1",
      "a:b",
    ]) {
      expect(ipBucketOf(odd), odd).toBe(odd);
    }
  });

  it("two addresses of one /64 hash alike, one address of another /64 does not", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const a = reporterHashes(ipBucketOf("2001:db8:1:2::1"), "secret", now);
    const b = reporterHashes(ipBucketOf("2001:db8:1:2:ffff::9"), "secret", now);
    const c = reporterHashes(ipBucketOf("2001:db8:1:3::1"), "secret", now);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
