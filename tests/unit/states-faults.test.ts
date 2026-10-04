import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The fault switch of the end-to-end specs (src/lib/testing/faults.ts): a cookie that makes the
 * Editor, Design and Settings reads fail so their failure screens can be proven. It must never do
 * anything in production, whatever a request carries, and nothing but those three screens may
 * call it.
 */

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "hl-fault" && cookieValue !== undefined ? { name, value: cookieValue } : undefined,
  }),
}));

const { FAULT_COOKIE, faultsEnabled, injectedFault, failIfInjected } =
  await import("@/lib/testing/faults");

const env = process.env as Record<string, string | undefined>;
const saved = {
  NODE_ENV: env.NODE_ENV,
  HYDLNK_QUERY_COUNTER: env.HYDLNK_QUERY_COUNTER,
  VERCEL_ENV: env.VERCEL_ENV,
};
const restore = (name: keyof typeof saved) => {
  if (saved[name] === undefined) delete env[name];
  else env[name] = saved[name];
};
beforeEach(() => {
  cookieValue = undefined;
  // The test hooks (M9-13) also switch faults on in a production build: start every case without them.
  delete env.HYDLNK_QUERY_COUNTER;
  delete env.VERCEL_ENV;
});
afterEach(() => {
  restore("NODE_ENV");
  restore("HYDLNK_QUERY_COUNTER");
  restore("VERCEL_ENV");
});

describe("faults are a development and test switch only", () => {
  it("the cookie is the one the specs set", () => {
    expect(FAULT_COOKIE).toBe("hl-fault");
  });

  it("in production nothing is injected, whatever the cookie says", async () => {
    env.NODE_ENV = "production";
    expect(faultsEnabled()).toBe(false);
    for (const value of [
      "draft-load",
      "themes-load",
      "route-throw",
      "draft-load,themes-load,route-throw",
    ]) {
      cookieValue = value;
      for (const name of ["draft-load", "themes-load", "route-throw"] as const) {
        expect(await injectedFault(name), `${value} / ${name}`).toBe(false);
      }
      await expect(failIfInjected("draft-load")).resolves.toBeUndefined();
    }
  });

  it("a flag that is not exactly 1 does not switch faults on in production", async () => {
    env.NODE_ENV = "production";
    cookieValue = "draft-load";
    for (const flag of ["0", "", "true", "yes"]) {
      env.HYDLNK_QUERY_COUNTER = flag;
      expect(faultsEnabled(), flag).toBe(false);
      expect(await injectedFault("draft-load"), flag).toBe(false);
    }
  });

  it("M9-13: CI's production build with the test hooks on injects the named fault", async () => {
    env.NODE_ENV = "production";
    env.HYDLNK_QUERY_COUNTER = "1";
    expect(faultsEnabled()).toBe(true);
    cookieValue = "themes-load";
    expect(await injectedFault("themes-load")).toBe(true);
    expect(await injectedFault("draft-load")).toBe(false);
    await expect(failIfInjected("themes-load")).rejects.toThrow("Injected fault: themes-load");
    for (const vercelEnv of ["preview", "development"]) {
      env.VERCEL_ENV = vercelEnv;
      expect(faultsEnabled(), vercelEnv).toBe(true);
    }
  });

  it("M9-13: on a Vercel production deployment the flag changes nothing, whatever the cookie says", async () => {
    env.NODE_ENV = "production";
    env.HYDLNK_QUERY_COUNTER = "1";
    env.VERCEL_ENV = "production";
    expect(faultsEnabled()).toBe(false);
    for (const name of ["draft-load", "themes-load", "route-throw", "versions-load"] as const) {
      cookieValue = name;
      expect(await injectedFault(name), name).toBe(false);
      await expect(failIfInjected(name)).resolves.toBeUndefined();
    }
  });

  it("in development the named fault is injected and only that one", async () => {
    env.NODE_ENV = "development";
    expect(faultsEnabled()).toBe(true);
    cookieValue = "themes-load";
    expect(await injectedFault("themes-load")).toBe(true);
    expect(await injectedFault("draft-load")).toBe(false);
    expect(await injectedFault("route-throw")).toBe(false);
    await expect(failIfInjected("themes-load")).rejects.toThrow("Injected fault: themes-load");
    await expect(failIfInjected("draft-load")).resolves.toBeUndefined();
  });

  it("several faults can be named; no cookie and an unknown name inject nothing", async () => {
    env.NODE_ENV = "test";
    cookieValue = "draft-load,route-throw";
    expect(await injectedFault("draft-load")).toBe(true);
    expect(await injectedFault("route-throw")).toBe(true);
    expect(await injectedFault("themes-load")).toBe(false);
    cookieValue = "everything";
    expect(await injectedFault("draft-load")).toBe(false);
    cookieValue = undefined;
    expect(await injectedFault("draft-load")).toBe(false);
  });
});

describe("only the screens that own a failure state call the switch", () => {
  const root = resolve(process.cwd(), "src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it("no other module under src imports @/lib/testing/faults", () => {
    const importers = walk(root)
      .filter((file) => /from "@\/lib\/testing\/faults"/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split("\\").join("/"))
      .sort();
    // The version history screen (M6-50) owns a failure state too: "We couldn’t load your versions."
    expect(importers).toEqual([
      "app/(editor)/app/(screens)/(workspace)/layout.tsx",
      "app/(editor)/app/(screens)/editor/history/page.tsx",
      "app/(editor)/app/(screens)/settings/page.tsx",
    ]);
  });

  it("the module is server-only, so a client component can never ship it", () => {
    const source = readFileSync(join(root, "lib/testing/faults.ts"), "utf8");
    expect(source).toContain('import "server-only"');
    expect(source).toContain('process.env.NODE_ENV !== "production" || testHooksEnabled()');
  });
});
