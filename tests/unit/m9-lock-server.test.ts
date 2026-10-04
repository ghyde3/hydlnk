import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCK_CODE_MESSAGE,
  LOCK_HASH_PATTERN,
  LOCK_SALT_PATTERN,
  LOCK_SET_FAILED_MESSAGE,
} from "@/lib/document";
import { hashLockCode, verifyLockCode } from "@/lib/links/lock-hash";
import { hashLinkCodeCore } from "@/lib/links/hash-code";
import { spyOnConsole } from "./analytics-ingest-helpers";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { VISITOR_HASH_SECRET: "unit-test-secret" } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({ rpc: async () => ({ data: [], error: null }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));

const { rateLimit } = await import("@/lib/rate-limit");

/**
 * M9-29 the server side of the code lock: scrypt hashing and checking, the `hashLinkCode` action's
 * rules, and the limiter's `failClosed` option (only the lock check and the hashing pass it).
 */

afterEach(() => vi.restoreAllMocks());

describe("M9-29 hashing and checking a code", () => {
  it("the same code and salt give the same hash; different salts give different ones", async () => {
    const salt = Buffer.alloc(16, 7);
    const a = await hashLockCode("Spring2026", salt);
    const b = await hashLockCode("Spring2026", salt);
    const c = await hashLockCode("Spring2026", Buffer.alloc(16, 8));
    expect(a).toEqual(b);
    expect(a.ok && c.ok && a.hash !== c.hash).toBe(true);
  });

  it("returns a 22 character salt and a 43 character hash, base64url", async () => {
    const result = await hashLockCode("Spring2026");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.salt).toMatch(LOCK_SALT_PATTERN);
    expect(result.hash).toMatch(LOCK_HASH_PATTERN);
    expect(Buffer.from(result.salt, "base64url")).toHaveLength(16);
    expect(Buffer.from(result.hash, "base64url")).toHaveLength(32);
  });

  it("a fresh random salt every time: setting the same code twice stores two different hashes", async () => {
    const a = await hashLockCode("Spring2026");
    const b = await hashLockCode("Spring2026");
    expect(a.ok && b.ok && a.salt !== b.salt && a.hash !== b.hash).toBe(true);
  });

  it("verifies the code ignoring case, width and surrounding space, and refuses a wrong one", async () => {
    const hashed = await hashLockCode("Spring2026");
    if (!hashed.ok) throw new Error("hash failed");
    for (const ok of [
      "Spring2026",
      "spring2026",
      "spring2026 ",
      "  SPRING2026\n",
      "ＳＰＲＩＮＧ２０２６",
    ]) {
      expect(await verifyLockCode(ok, hashed), ok).toBe(true);
    }
    for (const bad of [
      "spring2027",
      "spring202",
      "Spring 2026",
      "",
      "x".repeat(33),
      "spring2026\u0000",
      12345,
      null,
      undefined,
    ]) {
      expect(await verifyLockCode(bad, hashed), String(bad)).toBe(false);
    }
  });

  it("refuses a code of 33 characters and a code with a space before hashing", async () => {
    expect(await hashLockCode("x".repeat(33))).toEqual({ ok: false, message: LOCK_CODE_MESSAGE });
    expect(await hashLockCode("has space")).toEqual({ ok: false, message: LOCK_CODE_MESSAGE });
    expect(await hashLockCode("abc")).toEqual({ ok: false, message: LOCK_CODE_MESSAGE });
    expect(await hashLockCode(undefined)).toEqual({ ok: false, message: LOCK_CODE_MESSAGE });
  });

  it("a malformed salt or hash never matches, and never throws", async () => {
    expect(await verifyLockCode("Spring2026", { salt: "short", hash: "short" })).toBe(false);
    expect(await verifyLockCode("Spring2026", { salt: "A".repeat(22), hash: "" })).toBe(false);
    expect(await verifyLockCode("Spring2026", { salt: "+".repeat(22), hash: "B".repeat(43) })).toBe(
      false,
    );
  });

  it("a code that could never have been set costs no scrypt: a 1 KB code is refused at once", async () => {
    const hashed = await hashLockCode("Spring2026");
    if (!hashed.ok) throw new Error("hash failed");
    const started = performance.now();
    for (let i = 0; i < 20; i++) expect(await verifyLockCode("x".repeat(1000), hashed)).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("M9-30 the hashLinkCode action core", () => {
  it("signed-out callers get a sentence and nothing is hashed", async () => {
    const hash = vi.fn();
    const limit = vi.fn();
    const result = await hashLinkCodeCore(
      { userId: null, code: "Spring2026" },
      { hash, rateLimit: limit },
    );
    expect(result.ok).toBe(false);
    expect(hash).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it("20 calls a minute per user, through the limiter and failing closed", async () => {
    const limit = vi.fn(async () => ({ allowed: true, retryAfter: 0 }));
    const result = await hashLinkCodeCore(
      { userId: "user-1", code: "Spring2026" },
      { rateLimit: limit },
    );
    expect(result.ok).toBe(true);
    expect(limit).toHaveBeenCalledWith("link-code:user-1", 20, 60, { failClosed: true });
  });

  it("a blocked or failed limiter hashes nothing and gives a sentence, never the code", async () => {
    const hash = vi.fn();
    const blocked = await hashLinkCodeCore(
      { userId: "user-1", code: "Spring2026" },
      { hash, rateLimit: async () => ({ allowed: false, retryAfter: 30 }) },
    );
    expect(blocked).toEqual({ ok: false, message: "Too many tries. Wait a minute and try again." });
    const failed = await hashLinkCodeCore(
      { userId: "user-1", code: "Spring2026" },
      { hash, rateLimit: async () => ({ allowed: false, retryAfter: 1, failed: true }) },
    );
    expect(failed).toEqual({ ok: false, message: LOCK_SET_FAILED_MESSAGE });
    expect(hash).not.toHaveBeenCalled();
  });

  it("refuses a bad code with the editor's sentence", async () => {
    const limit = async () => ({ allowed: true, retryAfter: 0 });
    for (const code of ["abc", "x".repeat(33), "has space", ""]) {
      expect(await hashLinkCodeCore({ userId: "u", code }, { rateLimit: limit })).toEqual({
        ok: false,
        message: LOCK_CODE_MESSAGE,
      });
    }
  });

  it("a hashing failure is one sentence and the code is not logged", async () => {
    const log = spyOnConsole();
    const secret = "Sup3rS3cret!";
    const result = await hashLinkCodeCore(
      { userId: "u", code: secret },
      {
        rateLimit: async () => ({ allowed: true, retryAfter: 0 }),
        hash: async () => {
          throw new Error(`failed on ${secret}`);
        },
      },
    );
    expect(result).toEqual({ ok: false, message: LOCK_SET_FAILED_MESSAGE });
    expect(log.text()).not.toContain(secret);
    log.restore();
  });

  it("returns only the salt and the hash", async () => {
    const result = await hashLinkCodeCore(
      { userId: "u", code: "Spring2026" },
      { rateLimit: async () => ({ allowed: true, retryAfter: 0 }) },
    );
    expect(result.ok && Object.keys(result).sort()).toEqual(["hash", "ok", "salt"]);
    expect(JSON.stringify(result)).not.toContain("Spring2026");
  });
});

describe("M9-29 the limiter option failClosed", () => {
  const throwingStore = {
    hit: async () => {
      throw new Error("the counter store is down");
    },
  };
  const silentStore = { hit: () => new Promise<never>(() => undefined) };

  it("default: a store error is allowed (fail open) and logged", async () => {
    const log = spyOnConsole();
    expect(await rateLimit("k", 1, 60, { store: throwingStore, secret: "s" })).toEqual({
      allowed: true,
      retryAfter: 0,
    });
    expect(log.text()).toContain("the counter store is down");
    log.restore();
  });

  it("default: a store that never answers is allowed after the timeout", async () => {
    const log = spyOnConsole();
    const result = await rateLimit("k", 1, 60, { store: silentStore, secret: "s", timeoutMs: 20 });
    expect(result).toEqual({ allowed: true, retryAfter: 0 });
    log.restore();
  });

  it("failClosed: a store error is refused with failed: true and retryAfter 1", async () => {
    const log = spyOnConsole();
    const result = await rateLimit("k", 1, 60, {
      store: throwingStore,
      secret: "s",
      failClosed: true,
    });
    expect(result).toEqual({ allowed: false, retryAfter: 1, failed: true });
    expect(log.text()).toContain("refusing the request");
    log.restore();
  });

  it("failClosed: a store that never answers is refused after the timeout", async () => {
    const log = spyOnConsole();
    const result = await rateLimit("k", 1, 60, {
      store: silentStore,
      secret: "s",
      timeoutMs: 20,
      failClosed: true,
    });
    expect(result).toEqual({ allowed: false, retryAfter: 1, failed: true });
    log.restore();
  });

  it("failClosed does not change a store that works", async () => {
    const store = { hit: async () => ({ allowed: true, retryAfter: 0 }) };
    expect(await rateLimit("k", 1, 60, { store, secret: "s", failClosed: true })).toEqual({
      allowed: true,
      retryAfter: 0,
    });
    const blocked = { hit: async () => ({ allowed: false, retryAfter: 12 }) };
    expect(await rateLimit("k", 1, 60, { store: blocked, secret: "s", failClosed: true })).toEqual({
      allowed: false,
      retryAfter: 12,
    });
  });

  it("only the lock check and the code hashing pass it: a scan of src/ (comments aside)", () => {
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          /failClosed\s*:\s*true/.test(stripComments(readFileSync(full, "utf8")))
        ) {
          hits.push(relative(process.cwd(), full));
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits.sort()).toEqual([
      "src/lib/analytics/ingest/lock-gate.ts",
      "src/lib/links/hash-code.ts",
    ]);
  });
});
