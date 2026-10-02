import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** M4-01 / M4-03 / M4-06: the one Stripe client is sandbox-only and server-only. */

const BASE_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_unit",
  STRIPE_SECRET_KEY: "sk_test_unit_secret_value",
  STRIPE_WEBHOOK_SECRET: "whsec_unit",
  STRIPE_PRICE_PRO_MONTHLY: "price_pm",
  STRIPE_PRICE_PRO_YEARLY: "price_py",
  STRIPE_PRICE_STUDIO_MONTHLY: "price_sm",
  STRIPE_PRICE_STUDIO_YEARLY: "price_sy",
};

const saved: Record<string, string | undefined> = {};
const KEYS = [...Object.keys(BASE_ENV), "STRIPE_API_HOST", "VERCEL_ENV"];
beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  Object.assign(process.env, BASE_ENV);
  delete process.env.STRIPE_API_HOST;
  delete process.env.VERCEL_ENV;
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("M4-01 the Stripe client refuses live keys", () => {
  for (const key of ["sk_live_abcdefghijklmnop", "rk_live_abcdefghijklmnop"]) {
    it(`getStripe() throws for ${key.slice(0, 8)}... and never echoes the key`, async () => {
      process.env.STRIPE_SECRET_KEY = key;
      const { getStripe } = await import("@/lib/billing/stripe");
      let message = "";
      try {
        getStripe();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/live keys are not allowed until the move to Vercel Pro/);
      expect(message).not.toContain(key);
    });
  }

  it("builds a client with the sandbox key and the pinned API version", async () => {
    const { getStripe, STRIPE_API_VERSION } = await import("@/lib/billing/stripe");
    expect(STRIPE_API_VERSION).toBe("2026-09-30.endive");
    const client = getStripe();
    expect(client.getApiField("version")).toBe("2026-09-30.endive");
    expect(client.getApiField("host")).toBe("api.stripe.com");
  });

  it("builds without any price id: canceling and the portal home never name one", async () => {
    for (const name of [
      "STRIPE_PRICE_PRO_MONTHLY",
      "STRIPE_PRICE_PRO_YEARLY",
      "STRIPE_PRICE_STUDIO_MONTHLY",
      "STRIPE_PRICE_STUDIO_YEARLY",
    ]) {
      delete process.env[name];
    }
    const { getStripe } = await import("@/lib/billing/stripe");
    expect(getStripe().getApiField("host")).toBe("api.stripe.com");
    // The calls that do need a price still say which one is missing.
    const { readBillingEnv } = await import("@/lib/billing/env");
    expect(() => readBillingEnv()).toThrow(/STRIPE_PRICE_PRO_MONTHLY/);
  });

  it("a key that is missing is an error that names the variable, not a client", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripe } = await import("@/lib/billing/stripe");
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("STRIPE_API_HOST points the SDK at a local stub over http, and is refused in production", async () => {
    process.env.STRIPE_API_HOST = "127.0.0.1:12111";
    const { getStripe } = await import("@/lib/billing/stripe");
    const client = getStripe();
    expect(client.getApiField("host")).toBe("127.0.0.1");
    expect(String(client.getApiField("port"))).toBe("12111");
    expect(client.getApiField("protocol")).toBe("http");

    process.env.VERCEL_ENV = "production";
    expect(() => getStripe()).toThrow(/STRIPE_API_HOST/);
  });

  it("sdkHostOptions: default host untouched, loopback is http, any other host is https", async () => {
    const { sdkHostOptions } = await import("@/lib/billing/env");
    expect(sdkHostOptions("api.stripe.com")).toEqual({});
    expect(sdkHostOptions("127.0.0.1:12111")).toEqual({ host: "127.0.0.1", port: 12111, protocol: "http" });
    expect(sdkHostOptions("localhost:9")).toEqual({ host: "localhost", port: 9, protocol: "http" });
    expect(sdkHostOptions("stub.example.com:8443")).toEqual({
      host: "stub.example.com",
      port: 8443,
      protocol: "https",
    });
  });
});

describe("M4-01 Stripe and server env never reach client code", () => {
  const SRC = resolve(process.cwd(), "src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  const files = walk(SRC);

  it("every server-side billing module imports server-only (a client import is a build error)", () => {
    const server = [
      "env.ts",
      "stripe.ts",
      "account.ts",
      "checkout.ts",
      "portal.ts",
      "webhook.ts",
      "cancel.ts",
      "http.ts",
    ];
    for (const name of server) {
      const text = readFileSync(join(SRC, "lib/billing", name), "utf8");
      expect(text, name).toMatch(/^import "server-only";/m);
    }
    expect(readFileSync(join(SRC, "lib/env/server.ts"), "utf8")).toMatch(/^import "server-only";/m);
  });

  it("no Client Component imports a server billing module, the Stripe SDK or the server env", () => {
    const forbidden =
      /from "(stripe|@\/lib\/env\/server|@\/lib\/billing\/(env|stripe|account|checkout|portal|webhook|cancel|http))"/;
    const offenders = files
      .filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")))
      .filter((file) => forbidden.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("every module that imports the Stripe SDK is server-only", () => {
    const importers = files.filter((file) => /from "stripe"/.test(readFileSync(file, "utf8")));
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      expect(readFileSync(file, "utf8"), relative(SRC, file)).toMatch(/^import "server-only";/m);
    }
  });
});
