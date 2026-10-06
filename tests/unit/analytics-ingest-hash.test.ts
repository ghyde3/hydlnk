import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const env: { VISITOR_HASH_SECRET?: string; VERCEL_ENV?: string } = {};
vi.mock("@/lib/env/server", () => ({ serverEnv: env }));

const { dailySalt, utcDate, visitorHash, visitorHashWithSecret } = await import(
  "@/lib/analytics/ingest/hash"
);
const { visitorHashSecret } = await import("@/lib/analytics/ingest/secret");

const SECRET = "test-secret-one";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

beforeEach(() => {
  env.VISITOR_HASH_SECRET = SECRET;
  env.VERCEL_ENV = undefined;
});
afterEach(() => vi.useRealTimers());

describe("M4-20 visitorHash", () => {
  it("is the lowercase hex SHA-256 of the daily salt, the IP and the user agent", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const salt = createHmac("sha256", SECRET).update("2026-10-01").digest("hex");
    const expected = createHash("sha256").update(`${salt}\n${IP}\n${UA}`).digest("hex");
    const hash = visitorHashWithSecret(SECRET, { ip: IP, userAgent: UA, now });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expected);
  });

  it("the daily salt is HMAC-SHA256(VISITOR_HASH_SECRET, the UTC date as YYYY-MM-DD)", () => {
    expect(dailySalt(SECRET, new Date("2026-10-01T23:59:59Z"))).toBe(
      createHmac("sha256", SECRET).update("2026-10-01").digest("hex"),
    );
    expect(utcDate(new Date("2026-10-01T23:59:59.999Z"))).toBe("2026-10-01");
    expect(utcDate(new Date("2026-10-02T00:00:00Z"))).toBe("2026-10-02");
  });

  it("is stable across one UTC day and changes at 00:00 UTC (fake clock)", () => {
    vi.useFakeTimers();
    const at = (iso: string) => {
      vi.setSystemTime(new Date(iso));
      return visitorHash({ ip: IP, userAgent: UA, now: new Date() });
    };
    const morning = at("2026-10-01T00:00:01Z");
    const night = at("2026-10-01T23:59:59Z");
    const nextDay = at("2026-10-02T00:00:00Z");
    expect(night).toBe(morning);
    expect(nextDay).not.toBe(morning);
  });

  it("changes with the IP, the user agent and the secret", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const base = visitorHashWithSecret(SECRET, { ip: IP, userAgent: UA, now });
    expect(visitorHashWithSecret(SECRET, { ip: "203.0.113.8", userAgent: UA, now })).not.toBe(base);
    expect(visitorHashWithSecret(SECRET, { ip: IP, userAgent: `${UA} `, now })).not.toBe(base);
    expect(visitorHashWithSecret("test-secret-two", { ip: IP, userAgent: UA, now })).not.toBe(base);
  });

  it("does not let the IP and the user agent bleed into each other", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const a = visitorHashWithSecret(SECRET, { ip: "1.2.3.4", userAgent: "5 x", now });
    const b = visitorHashWithSecret(SECRET, { ip: "1.2.3.4 5", userAgent: "x", now });
    expect(a).not.toBe(b);
  });

  it("the exported visitorHash reads VISITOR_HASH_SECRET from the server environment", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(visitorHash({ ip: IP, userAgent: UA, now })).toBe(
      visitorHashWithSecret(SECRET, { ip: IP, userAgent: UA, now }),
    );
    env.VISITOR_HASH_SECRET = "rotated";
    expect(visitorHash({ ip: IP, userAgent: UA, now })).toBe(
      visitorHashWithSecret("rotated", { ip: IP, userAgent: UA, now }),
    );
  });
});

describe("M4-20 the secret", () => {
  it("falls back to a fixed local value only off Vercel", () => {
    env.VISITOR_HASH_SECRET = undefined;
    env.VERCEL_ENV = undefined;
    expect(visitorHashSecret()).toMatch(/local-development/);
    env.VERCEL_ENV = "production";
    expect(() => visitorHashSecret()).toThrow(/VISITOR_HASH_SECRET/);
    env.VERCEL_ENV = "preview";
    expect(() => visitorHashSecret()).toThrow(/VISITOR_HASH_SECRET/);
  });
});

describe("M4-20 server only, nothing stored", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("hash.ts and secret.ts import server-only, so a Client Component cannot import them", () => {
    expect(read("src/lib/analytics/ingest/hash.ts")).toMatch(/^import "server-only";/m);
    expect(read("src/lib/analytics/ingest/secret.ts")).toMatch(/^import "server-only";/m);
  });

  it("the hash module touches no storage: no database, no file, no cookie", () => {
    const source = read("src/lib/analytics/ingest/hash.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(source).not.toMatch(/supabase|from\("|node:fs|cookies|localStorage|writeFile/);
  });
});
