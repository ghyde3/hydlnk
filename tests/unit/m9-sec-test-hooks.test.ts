import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { testHooksEnabled } = await import("@/lib/env/test-hooks");
const { armFailNextRead, failIfArmed, faultInjectionEnabled } =
  await import("@/lib/tenant-render/fault");
const { queryCounterEnabled, countPublicQuery, publicQueryCount } =
  await import("@/lib/publish/query-counter");

/**
 * Wave J security review, low: the test hooks (GET /hl-query-count, GET /hl-fail-next-read, the
 * `x-hl-domain-cache` header) are switched on by HYDLNK_QUERY_COUNTER=1 and nothing else. If that
 * variable were ever set on the production Vercel project, any visitor could arm a one-shot 500 on
 * any page. They now also require VERCEL_ENV to not be "production". CI's `next start` has no
 * VERCEL_ENV and a preview deployment has "preview", so both keep working.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("testHooksEnabled", () => {
  it.each([
    ["1", undefined, true],
    ["1", "", true],
    ["1", "preview", true],
    ["1", "development", true],
    ["1", "production", false],
    ["0", undefined, false],
    ["", undefined, false],
    ["true", undefined, false],
    [undefined, undefined, false],
    [undefined, "production", false],
    ["0", "production", false],
  ] as const)("HYDLNK_QUERY_COUNTER=%j VERCEL_ENV=%j is %j", (flag, vercelEnv, expected) => {
    if (flag === undefined) delete process.env.HYDLNK_QUERY_COUNTER;
    else vi.stubEnv("HYDLNK_QUERY_COUNTER", flag);
    if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
    else vi.stubEnv("VERCEL_ENV", vercelEnv);
    expect(testHooksEnabled()).toBe(expected);
  });
});

describe("the fault hook and the query counter follow it", () => {
  it("on a production deployment with the flag set, nothing is armed and nothing throws", () => {
    vi.stubEnv("HYDLNK_QUERY_COUNTER", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(faultInjectionEnabled()).toBe(false);
    expect(queryCounterEnabled()).toBe(false);
    expect(armFailNextRead({ handle: "prodtest" })).toBe(false);
    expect(armFailNextRead({ pageId: "11111111-1111-4111-8111-111111111111" })).toBe(false);
    expect(() => failIfArmed({ handle: "prodtest" })).not.toThrow();
    countPublicQuery("page-in-production");
    expect(publicQueryCount("page-in-production")).toBe(0);
  });

  it("a flag armed earlier cannot fire once the environment says production", () => {
    vi.stubEnv("HYDLNK_QUERY_COUNTER", "1");
    expect(armFailNextRead({ handle: "armedearlier" })).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => failIfArmed({ handle: "armedearlier" })).not.toThrow();
  });

  it("outside production the hook still arms once and fires once (the CI harness and a preview)", () => {
    for (const vercelEnv of [undefined, "preview"]) {
      vi.stubEnv("HYDLNK_QUERY_COUNTER", "1");
      if (vercelEnv) vi.stubEnv("VERCEL_ENV", vercelEnv);
      else delete process.env.VERCEL_ENV;
      expect(armFailNextRead({ handle: "ciharness" })).toBe(true);
      expect(() => failIfArmed({ handle: "ciharness" })).toThrow("Injected failure");
      expect(() => failIfArmed({ handle: "ciharness" })).not.toThrow();
      vi.unstubAllEnvs();
    }
  });
});

describe("the flag is read in one place", () => {
  it("no module besides the helper compares HYDLNK_QUERY_COUNTER itself", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const readers = walk("src")
      .filter((path) => /\.tsx?$/.test(path))
      .filter((path) => /process\.env\.HYDLNK_QUERY_COUNTER/.test(readFileSync(path, "utf8")));
    expect(readers).toEqual([join("src", "lib", "env", "test-hooks.ts")]);
  });
});
