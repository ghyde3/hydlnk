import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  M4_REQUIRED_KEYS,
  STRIPE_API_DEFAULT_HOST,
  VERCEL_API_DEFAULT_BASE_URL,
  parseServerEnv,
  readServerEnvSource,
  stripeKeyKind,
} from "@/lib/env/server-schema";

/**
 * M4-01: the Milestone 4 variables validate at startup and Stripe stays sandbox-only unless the
 * live-mode switch is on in production. Release fixes (2026-10-02): PAID_PLANS_OPEN and
 * STRIPE_LIVE_MODE are the two server switches. Wave E (2026-10-04): VERCEL_API_TOKEN, optional
 * until then, joined the required variables.
 */

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

// The production deployment has the real root domain (a localhost one is refused there, see
// admin-env.test.ts), so a case that sets VERCEL_ENV=production starts from hydlnk.com.
const parse = (overrides: Record<string, string | undefined> = {}) =>
  parseServerEnv({
    ...FULL,
    ...(overrides.VERCEL_ENV === "production" ? { NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.com" } : {}),
    ...overrides,
  });

describe("M4-01 .env.example", () => {
  const path = process.env.ENV_EXAMPLE_PATH ?? resolve(process.cwd(), ".env.example");
  const lines = readFileSync(path, "utf8").split("\n");

  const REQUIRED = [
    // VERCEL_API_TOKEN is required since the custom-domains wave (see "VERCEL_API_TOKEN is required").
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

  const find = (name: string) =>
    lines.findIndex((line) => new RegExp(`^#?\\s*${name}=`).test(line));
  const valueOf = (name: string, index: number) =>
    lines[index]!.replace(new RegExp(`^#?\\s*${name}=`), "").trim();

  for (const name of REQUIRED) {
    it(`lists ${name} with a one-line comment and no real value`, () => {
      const index = find(name);
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      const value = valueOf(name, index);
      // A placeholder, never a live-looking id or secret.
      expect(value, `${name}=${value}`).toMatch(/replace_me/);
      expect(lines[index - 1]?.trim().startsWith("#"), `${name} has no comment above it`).toBe(
        true,
      );
    });
  }

  for (const name of OVERRIDES) {
    it(`lists the test-only override ${name}, commented out, with a one-line comment`, () => {
      const index = find(name);
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      expect(lines[index]!.trim().startsWith("#"), `${name} must be commented out`).toBe(true);
      expect(lines[index - 1]?.trim().startsWith("#"), `${name} has no comment above it`).toBe(
        true,
      );
    });
  }

  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
    it(`keeps ${name} listed without a real value`, () => {
      const index = find(name);
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      expect(valueOf(name, index)).toMatch(/replace_me/);
    });
  }

  // The two switches: not secrets, listed with their defaults and a comment that says what they do.
  for (const [name, fallback] of [
    ["STRIPE_LIVE_MODE", "false"],
    ["PAID_PLANS_OPEN", "true"],
  ] as const) {
    it(`lists the switch ${name} with its default (${fallback}) and a comment above it`, () => {
      const index = find(name);
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      expect(valueOf(name, index)).toBe(fallback);
      expect(lines[index]!.trim().startsWith("#"), `${name} is a default, not commented out`).toBe(
        false,
      );
      expect(lines[index - 1]?.trim().startsWith("#"), `${name} has no comment above it`).toBe(
        true,
      );
    });
  }

  it("the STRIPE_LIVE_MODE comment says live keys need production, and the VERCEL_API_TOKEN one says it is required", () => {
    const above = (name: string) => {
      const index = find(name);
      const block: string[] = [];
      for (let i = index - 1; i >= 0 && lines[i]!.trim().startsWith("#"); i--)
        block.unshift(lines[i]!);
      return block.join(" ");
    };
    expect(above("STRIPE_LIVE_MODE")).toMatch(/production/i);
    expect(above("STRIPE_LIVE_MODE")).toMatch(/live/i);
    expect(above("VERCEL_API_TOKEN")).toMatch(/required/i);
    expect(above("PAID_PLANS_OPEN")).toMatch(/Paid plans open soon/);
  });
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
      for (const other of M4_REQUIRED_KEYS)
        if (other !== name) expect(message).not.toContain(other);
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

describe("VERCEL_API_TOKEN is required wherever the app really runs (custom domains, Wave E)", () => {
  it("is one of the required variables (nine in all)", () => {
    expect(M4_REQUIRED_KEYS).toContain("VERCEL_API_TOKEN");
    expect(M4_REQUIRED_KEYS).toHaveLength(9);
  });

  for (const vercelEnv of [undefined, "development", "preview", "production"]) {
    for (const token of [undefined, ""]) {
      it(`refuses to start without it (${token === undefined ? "unset" : "empty"}) with VERCEL_ENV=${vercelEnv ?? "(unset)"}, the strict build and runtime check, naming only it`, () => {
        let message = "";
        try {
          parse({ VERCEL_API_TOKEN: token, VERCEL_ENV: vercelEnv });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain("VERCEL_API_TOKEN");
        for (const other of M4_REQUIRED_KEYS)
          if (other !== "VERCEL_API_TOKEN") expect(message).not.toContain(other);
      });
    }
  }

  it("may be unset only when asked (local dev, CI, Vitest): the point of use fails closed instead", () => {
    const { VERCEL_API_TOKEN: _token, ...rest } = FULL;
    void _token;
    expect(parseServerEnv(rest, { requireM4: false }).VERCEL_API_TOKEN).toBeUndefined();
  });

  it("still reads it when it is set", () => {
    expect(parse().VERCEL_API_TOKEN).toBe(FULL.VERCEL_API_TOKEN);
    expect(readServerEnvSource({ VERCEL_API_TOKEN: "abc" }).VERCEL_API_TOKEN).toBe("abc");
  });

  it("everything else stays validated: with the token present, a missing project, team or secret still fails and names only that one", () => {
    for (const name of M4_REQUIRED_KEYS) {
      if (name === "VERCEL_API_TOKEN") continue;
      let message = "";
      try {
        parse({ [name]: undefined, VERCEL_ENV: "production" });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, name).toContain(name);
      expect(message, name).not.toContain("VERCEL_API_TOKEN");
    }
  });
});

describe("PAID_PLANS_OPEN", () => {
  it("defaults to open when unset or empty", () => {
    expect(parse().PAID_PLANS_OPEN).toBe("true");
    expect(parse({ PAID_PLANS_OPEN: "" }).PAID_PLANS_OPEN).toBe("true");
  });

  it("accepts exactly true and false", () => {
    expect(parse({ PAID_PLANS_OPEN: "true" }).PAID_PLANS_OPEN).toBe("true");
    expect(parse({ PAID_PLANS_OPEN: "false" }).PAID_PLANS_OPEN).toBe("false");
  });

  for (const bad of ["no", "0", "FALSE", "False", "closed", " false", "yes"]) {
    it(`refuses ${JSON.stringify(bad)} by name, so a typo cannot leave the plans open`, () => {
      expect(() => parse({ PAID_PLANS_OPEN: bad })).toThrow(/PAID_PLANS_OPEN/);
    });
  }

  it("is read from the real environment by readServerEnvSource", () => {
    expect(readServerEnvSource({ PAID_PLANS_OPEN: "false" }).PAID_PLANS_OPEN).toBe("false");
  });
});

describe("M4-01 Stripe stays sandbox-only unless live mode is on in production", () => {
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

  it("accepts sk_test_ (and a restricted test key) and refuses anything that is not a Stripe key", () => {
    expect(parse({ STRIPE_SECRET_KEY: "sk_test_abcdefghijklmnop" }).STRIPE_SECRET_KEY).toBe(
      "sk_test_abcdefghijklmnop",
    );
    expect(() => parse({ STRIPE_SECRET_KEY: "rk_test_abcdefghijklmnop" })).not.toThrow();
    expect(() => parse({ STRIPE_SECRET_KEY: "pk_test_abcdefghijklmnop" })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    expect(() => parse({ STRIPE_SECRET_KEY: "whsec_abcdefghijklmnop" })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    // Not a key of any mode, whatever the switch says.
    for (const liveMode of ["true", "false"]) {
      expect(() =>
        parse({
          STRIPE_SECRET_KEY: "pk_live_abcdefghijklmnop",
          STRIPE_LIVE_MODE: liveMode,
          VERCEL_ENV: "production",
        }),
      ).toThrow(/STRIPE_SECRET_KEY/);
    }
  });

  it("allows the key to be unset (nothing reads it until Stripe is called)", () => {
    expect(() => parse({ STRIPE_SECRET_KEY: undefined })).not.toThrow();
  });

  it("classifies a key by its prefix alone", () => {
    expect(stripeKeyKind("sk_live_x")).toBe("live");
    expect(stripeKeyKind("rk_live_x")).toBe("live");
    expect(stripeKeyKind("sk_test_x")).toBe("test");
    expect(stripeKeyKind("rk_test_x")).toBe("test");
    for (const other of [
      "",
      "pk_live_x",
      "pk_test_x",
      "sk_x",
      "whsec_x",
      "SK_LIVE_x",
      " sk_live_x",
    ]) {
      expect(stripeKeyKind(other), other).toBe("unknown");
    }
  });
});

describe("STRIPE_LIVE_MODE", () => {
  it("defaults to false when unset or empty, and accepts exactly true and false", () => {
    expect(parse().STRIPE_LIVE_MODE).toBe("false");
    expect(parse({ STRIPE_LIVE_MODE: "" }).STRIPE_LIVE_MODE).toBe("false");
    expect(parse({ STRIPE_SECRET_KEY: undefined, STRIPE_LIVE_MODE: "true" }).STRIPE_LIVE_MODE).toBe(
      "true",
    );
    expect(parse({ STRIPE_LIVE_MODE: "false" }).STRIPE_LIVE_MODE).toBe("false");
    for (const bad of ["yes", "1", "TRUE", "True", "live", " true"]) {
      expect(() => parse({ STRIPE_SECRET_KEY: undefined, STRIPE_LIVE_MODE: bad }), bad).toThrow(
        /STRIPE_LIVE_MODE/,
      );
    }
  });

  it("is read from the real environment by readServerEnvSource", () => {
    expect(readServerEnvSource({ STRIPE_LIVE_MODE: "true" }).STRIPE_LIVE_MODE).toBe("true");
  });

  // Every combination of the switch, the deployment and the key. The rule: a live key is accepted
  // ONLY with STRIPE_LIVE_MODE=true AND VERCEL_ENV=production; a test key is refused when
  // STRIPE_LIVE_MODE=true (no mixing); everything else is as it was (sandbox keys, no live keys).
  const MODES = [undefined, "false", "true"] as const;
  const DEPLOYMENTS = [undefined, "development", "preview", "production"] as const;
  const KEYS = [
    ["sk_test_abcdefghijklmnop", "test"],
    ["rk_test_abcdefghijklmnop", "test"],
    ["sk_live_abcdefghijklmnop", "live"],
    ["rk_live_abcdefghijklmnop", "live"],
    [undefined, "none"],
  ] as const;

  for (const mode of MODES) {
    for (const vercelEnv of DEPLOYMENTS) {
      for (const [key, kind] of KEYS) {
        const live = mode === "true";
        const accepted =
          kind === "none" ||
          (live ? kind === "live" && vercelEnv === "production" : kind === "test");
        const label = `${kind === "none" ? "no key" : `${key!.slice(0, 8)}...`} with STRIPE_LIVE_MODE=${mode ?? "(unset)"} on VERCEL_ENV=${vercelEnv ?? "(unset)"} is ${accepted ? "accepted" : "refused"}`;
        it(label, () => {
          const run = () =>
            parse({ STRIPE_SECRET_KEY: key, STRIPE_LIVE_MODE: mode, VERCEL_ENV: vercelEnv });
          if (accepted) {
            expect(run).not.toThrow();
            return;
          }
          let message = "";
          try {
            run();
          } catch (error) {
            message = (error as Error).message;
          }
          expect(message).toContain("STRIPE_SECRET_KEY");
          expect(message).not.toContain(key!);
          if (live && kind === "test") {
            expect(message).toMatch(/test-mode key[^]*not allowed when STRIPE_LIVE_MODE=true/);
          } else if (live) {
            expect(message).toMatch(/live keys are only allowed when VERCEL_ENV=production/);
          } else {
            expect(message).toMatch(/live keys are not allowed until the move to Vercel Pro/);
          }
        });
      }
    }
  }

  it("a live key in production in live mode does not relax anything else: API redirects are still refused", () => {
    const live = {
      STRIPE_SECRET_KEY: "sk_live_abcdefghijklmnop",
      STRIPE_LIVE_MODE: "true",
      VERCEL_ENV: "production",
    };
    expect(() => parse(live)).not.toThrow();
    expect(() => parse({ ...live, STRIPE_API_HOST: "127.0.0.1:12111" })).toThrow(/STRIPE_API_HOST/);
    expect(() => parse({ ...live, VERCEL_API_BASE_URL: "http://127.0.0.1:12112" })).toThrow(
      /VERCEL_API_BASE_URL/,
    );
    // And the required Milestone 4 variables are still required.
    expect(() => parse({ ...live, STRIPE_PRICE_PRO_MONTHLY: undefined })).toThrow(
      /STRIPE_PRICE_PRO_MONTHLY/,
    );
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
