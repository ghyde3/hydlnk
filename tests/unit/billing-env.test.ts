import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  M4_REQUIRED_KEYS,
  STRIPE_API_DEFAULT_HOST,
  VERCEL_API_DEFAULT_BASE_URL,
  parseServerEnv,
} from "@/lib/env/server-schema";

/** M4-01: the Milestone 4 variables validate at startup and Stripe stays sandbox-only. */

const FULL: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_test_value",
  STRIPE_SECRET_KEY: "sk_test_abcdefghijklmnop",
  STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnop",
  VERCEL_API_TOKEN: "vercel-token-value",
  VERCEL_PROJECT_ID: "prj_test",
  VERCEL_TEAM_ID: "team_test",
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
  STRIPE_PRICE_PRO_YEARLY: "price_pro_yearly",
  STRIPE_PRICE_STUDIO_MONTHLY: "price_studio_monthly",
  STRIPE_PRICE_STUDIO_YEARLY: "price_studio_yearly",
  CRON_SECRET: "cron-secret-value",
  VISITOR_HASH_SECRET: "visitor-secret-value",
};

const parse = (overrides: Record<string, string | undefined> = {}) =>
  parseServerEnv({ ...FULL, ...overrides });

describe("M4-01 .env.example", () => {
  const path = process.env.ENV_EXAMPLE_PATH ?? resolve(process.cwd(), ".env.example");
  const lines = readFileSync(path, "utf8").split("\n");

  const REQUIRED = [
    "VERCEL_API_TOKEN",
    "VERCEL_PROJECT_ID",
    "VERCEL_TEAM_ID",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_PRO_YEARLY",
    "STRIPE_PRICE_STUDIO_MONTHLY",
    "STRIPE_PRICE_STUDIO_YEARLY",
    "CRON_SECRET",
    "VISITOR_HASH_SECRET",
  ];
  // The test-only overrides: listed commented out, so an untouched copy never redirects an API.
  const OVERRIDES = ["VERCEL_API_BASE_URL", "STRIPE_API_HOST"];

  const find = (name: string) => lines.findIndex((line) => new RegExp(`^#?\\s*${name}=`).test(line));
  const valueOf = (name: string, index: number) =>
    lines[index]!.replace(new RegExp(`^#?\\s*${name}=`), "").trim();

  for (const name of REQUIRED) {
    it(`lists ${name} with a one-line comment and no real value`, () => {
      const index = find(name);
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      const value = valueOf(name, index);
      // A placeholder, never a live-looking id or secret.
      expect(value, `${name}=${value}`).toMatch(/replace_me/);
      expect(lines[index - 1]?.trim().startsWith("#"), `${name} has no comment above it`).toBe(true);
    });
  }

  for (const name of OVERRIDES) {
    it(`lists the test-only override ${name}, commented out, with a one-line comment`, () => {
      const index = find(name);
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      expect(lines[index]!.trim().startsWith("#"), `${name} must be commented out`).toBe(true);
      expect(lines[index - 1]?.trim().startsWith("#"), `${name} has no comment above it`).toBe(true);
    });
  }

  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
    it(`keeps ${name} listed without a real value`, () => {
      const index = find(name);
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      expect(valueOf(name, index)).toMatch(/replace_me/);
    });
  }
});

describe("M4-01 required variables", () => {
  it("parses when every required variable is present", () => {
    const env = parse();
    expect(env.VERCEL_API_TOKEN).toBe(FULL.VERCEL_API_TOKEN);
    expect(env.STRIPE_PRICE_STUDIO_YEARLY).toBe(FULL.STRIPE_PRICE_STUDIO_YEARLY);
  });

  for (const name of M4_REQUIRED_KEYS) {
    it(`throws an error that names ${name} when it is missing`, () => {
      let message = "";
      try {
        parse({ [name]: undefined });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(name);
      expect(message).toMatch(/Missing:/);
      // Only the missing one is named, and no value is echoed.
      for (const other of M4_REQUIRED_KEYS) if (other !== name) expect(message).not.toContain(other);
      for (const value of Object.values(FULL)) expect(message).not.toContain(value);
    });

    it(`treats an empty ${name} as missing`, () => {
      expect(() => parse({ [name]: "" })).toThrow(name);
    });
  }

  it("lets the Milestone 4 variables be unset only when asked (local dev, CI)", () => {
    const source = { ...FULL };
    for (const name of M4_REQUIRED_KEYS) delete source[name];
    expect(() => parseServerEnv(source)).toThrow(/Missing/);
    expect(() => parseServerEnv(source, { requireM4: false })).not.toThrow();
  });
});

describe("M4-01 Stripe stays sandbox-only", () => {
  for (const nodeEnv of ["development", "test", "production", undefined]) {
    for (const key of ["sk_live_abcdefghijklmnop", "rk_live_abcdefghijklmnop"]) {
      it(`refuses ${key.slice(0, 8)}... in NODE_ENV=${nodeEnv ?? "(unset)"}`, () => {
        let message = "";
        try {
          parse({ STRIPE_SECRET_KEY: key, NODE_ENV: nodeEnv });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain("STRIPE_SECRET_KEY");
        expect(message).toMatch(/live keys are not allowed until the move to Vercel Pro/);
        expect(message).not.toContain(key);
      });
    }
  }

  it("accepts sk_test_ (and a restricted test key) and refuses anything that is not a sandbox key", () => {
    expect(parse({ STRIPE_SECRET_KEY: "sk_test_abcdefghijklmnop" }).STRIPE_SECRET_KEY).toBe(
      "sk_test_abcdefghijklmnop",
    );
    expect(() => parse({ STRIPE_SECRET_KEY: "rk_test_abcdefghijklmnop" })).not.toThrow();
    expect(() => parse({ STRIPE_SECRET_KEY: "pk_test_abcdefghijklmnop" })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => parse({ STRIPE_SECRET_KEY: "whsec_abcdefghijklmnop" })).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("allows the key to be unset (nothing reads it until Stripe is called)", () => {
    expect(() => parse({ STRIPE_SECRET_KEY: undefined })).not.toThrow();
  });
});

describe("M4-01 API redirects exist for local stubs only", () => {
  it("defaults to the real hosts when unset", () => {
    const env = parse();
    expect(env.VERCEL_API_BASE_URL).toBe(VERCEL_API_DEFAULT_BASE_URL);
    expect(env.VERCEL_API_BASE_URL).toBe("https://api.vercel.com");
    expect(env.STRIPE_API_HOST).toBe(STRIPE_API_DEFAULT_HOST);
    expect(env.STRIPE_API_HOST).toBe("api.stripe.com");
  });

  it("accepts the overrides outside production", () => {
    for (const vercelEnv of [undefined, "development", "preview"]) {
      const env = parse({
        VERCEL_ENV: vercelEnv,
        VERCEL_API_BASE_URL: "http://127.0.0.1:12112",
        STRIPE_API_HOST: "127.0.0.1:12111",
      });
      expect(env.VERCEL_API_BASE_URL).toBe("http://127.0.0.1:12112");
      expect(env.STRIPE_API_HOST).toBe("127.0.0.1:12111");
    }
  });

  it("fails validation when VERCEL_ENV=production sets VERCEL_API_BASE_URL", () => {
    expect(() =>
      parse({ VERCEL_ENV: "production", VERCEL_API_BASE_URL: "http://127.0.0.1:12112" }),
    ).toThrow(/VERCEL_API_BASE_URL[^]*redirected in production/);
  });

  it("fails validation when VERCEL_ENV=production sets STRIPE_API_HOST", () => {
    expect(() => parse({ VERCEL_ENV: "production", STRIPE_API_HOST: "127.0.0.1:12111" })).toThrow(
      /STRIPE_API_HOST[^]*redirected in production/,
    );
  });

  it("parses in production with the overrides unset", () => {
    expect(() => parse({ VERCEL_ENV: "production" })).not.toThrow();
  });

  it("rejects a malformed host", () => {
    expect(() => parse({ STRIPE_API_HOST: "https://evil.example/x" })).toThrow(/STRIPE_API_HOST/);
  });
});
