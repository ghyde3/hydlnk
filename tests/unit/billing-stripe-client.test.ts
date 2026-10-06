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
const KEYS = [
  ...Object.keys(BASE_ENV),
  "STRIPE_API_HOST",
  "VERCEL_ENV",
  "STRIPE_LIVE_MODE",
  "PAID_PLANS_OPEN",
];
beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  Object.assign(process.env, BASE_ENV);
  delete process.env.STRIPE_API_HOST;
  delete process.env.VERCEL_ENV;
  delete process.env.STRIPE_LIVE_MODE;
  delete process.env.PAID_PLANS_OPEN;
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
    expect(sdkHostOptions("127.0.0.1:12111")).toEqual({
      host: "127.0.0.1",
      port: 12111,
      protocol: "http",
    });
    expect(sdkHostOptions("localhost:9")).toEqual({ host: "localhost", port: 9, protocol: "http" });
    expect(sdkHostOptions("stub.example.com:8443")).toEqual({
      host: "stub.example.com",
      port: 8443,
      protocol: "https",
    });
  });
});

describe("STRIPE_LIVE_MODE decides which keys the Stripe client may be built with", () => {
  const LIVE = "sk_live_abcdefghijklmnop";
  const TEST = "sk_test_abcdefghijklmnop";
  const build = async (env: Record<string, string | undefined>) => {
    // The production deployment has the real root domain (a localhost one is refused there).
    if (env.VERCEL_ENV === "production") process.env.NEXT_PUBLIC_ROOT_DOMAIN = "hydlnk.com";
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const { getStripe } = await import("@/lib/billing/stripe");
    return getStripe();
  };

  it("a live key with STRIPE_LIVE_MODE=true on VERCEL_ENV=production builds a client against the real host", async () => {
    const client = await build({
      STRIPE_SECRET_KEY: LIVE,
      STRIPE_LIVE_MODE: "true",
      VERCEL_ENV: "production",
    });
    expect(client.getApiField("host")).toBe("api.stripe.com");
  });

  it("a live key is refused in live mode off production, and without live mode anywhere", async () => {
    for (const vercelEnv of [undefined, "development", "preview"]) {
      await expect(
        build({ STRIPE_SECRET_KEY: LIVE, STRIPE_LIVE_MODE: "true", VERCEL_ENV: vercelEnv }),
        `live mode on ${vercelEnv ?? "(unset)"}`,
      ).rejects.toThrow(/live keys are only allowed when VERCEL_ENV=production/);
    }
    for (const mode of [undefined, "false"]) {
      await expect(
        build({ STRIPE_SECRET_KEY: LIVE, STRIPE_LIVE_MODE: mode, VERCEL_ENV: "production" }),
        `STRIPE_LIVE_MODE=${mode ?? "(unset)"} on production`,
      ).rejects.toThrow(/live keys are not allowed until the move to Vercel Pro/);
    }
  });

  it("a test key is refused when STRIPE_LIVE_MODE=true, in production too (no mixing)", async () => {
    for (const vercelEnv of [undefined, "preview", "production"]) {
      await expect(
        build({ STRIPE_SECRET_KEY: TEST, STRIPE_LIVE_MODE: "true", VERCEL_ENV: vercelEnv }),
        vercelEnv ?? "(unset)",
      ).rejects.toThrow(/not allowed when STRIPE_LIVE_MODE=true/);
    }
  });

  it("a test key still builds in test mode, on production too (everything else behaves as before)", async () => {
    for (const vercelEnv of [undefined, "preview", "production"]) {
      expect(
        (
          await build({ STRIPE_SECRET_KEY: TEST, STRIPE_LIVE_MODE: "false", VERCEL_ENV: vercelEnv })
        ).getApiField("host"),
      ).toBe("api.stripe.com");
    }
  });

  it("an error never carries the key", async () => {
    let message = "";
    try {
      await build({ STRIPE_SECRET_KEY: LIVE, STRIPE_LIVE_MODE: "false" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("STRIPE_SECRET_KEY");
    expect(message).not.toContain(LIVE);
  });

  it("the live-mode API host override is still refused in production", async () => {
    await expect(
      build({
        STRIPE_SECRET_KEY: LIVE,
        STRIPE_LIVE_MODE: "true",
        VERCEL_ENV: "production",
        STRIPE_API_HOST: "127.0.0.1:12111",
      }),
    ).rejects.toThrow(/STRIPE_API_HOST/);
  });
});

describe("PAID_PLANS_OPEN and the webhook's needs, read from the environment on every call", () => {
  it("readPaidPlansOpen: open by default, closed only by exactly 'false', an invalid value is an error", async () => {
    const { readPaidPlansOpen } = await import("@/lib/billing/env");
    expect(readPaidPlansOpen()).toBe(true);
    process.env.PAID_PLANS_OPEN = "true";
    expect(readPaidPlansOpen()).toBe(true);
    process.env.PAID_PLANS_OPEN = "false";
    expect(readPaidPlansOpen()).toBe(false);
    process.env.PAID_PLANS_OPEN = "";
    expect(readPaidPlansOpen()).toBe(true);
    process.env.PAID_PLANS_OPEN = "no";
    expect(() => readPaidPlansOpen()).toThrow(/PAID_PLANS_OPEN/);
  });

  it("readWebhookEnv needs the Stripe key now (the webhook reads each subscription from Stripe)", async () => {
    const { readWebhookEnv } = await import("@/lib/billing/env");
    expect(readWebhookEnv().webhookSecret).toBe("whsec_unit");
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => readWebhookEnv()).toThrow(/STRIPE_WEBHOOK_SECRET/);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit";
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => readWebhookEnv()).toThrow(/STRIPE_SECRET_KEY/);
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
