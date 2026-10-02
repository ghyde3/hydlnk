import { z } from "zod";
import { parseEnv, publicEnvSchema, readPublicEnv } from "./shared";

/**
 * The server environment schema, with no `server-only` import and no `process.env` read at import
 * time, so a unit test can parse any source object. "@/lib/env/server" is the module the app
 * imports: it feeds this schema the real environment, once, and re-exports the result.
 */

/**
 * Milestone 4 variables: required wherever the app really runs (see `requireM4` below).
 * `VERCEL_API_TOKEN` is deliberately not in this list: until the custom-domains wave it does not
 * exist in production, so a build or a start without it must succeed. Anything that has to call
 * the Vercel API (adding or removing a custom domain) fails closed at the point of use instead
 * (src/lib/pages/vercel-config.ts).
 */
export const M4_REQUIRED_KEYS = [
  "VERCEL_PROJECT_ID",
  "VERCEL_TEAM_ID",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "STRIPE_PRICE_STUDIO_MONTHLY",
  "STRIPE_PRICE_STUDIO_YEARLY",
  "CRON_SECRET",
  "VISITOR_HASH_SECRET",
] as const;
export type M4RequiredKey = (typeof M4_REQUIRED_KEYS)[number];

/** Stripe's real API host: what STRIPE_API_HOST defaults to. */
export const STRIPE_API_DEFAULT_HOST = "api.stripe.com";
/** The Vercel REST API: what VERCEL_API_BASE_URL defaults to. */
export const VERCEL_API_DEFAULT_BASE_URL = "https://api.vercel.com";

const nonEmpty = z.string().min(1);

export type StripeKeyKind = "live" | "test" | "unknown";

/** Which mode a Stripe secret or restricted key belongs to, from its prefix alone. */
export function stripeKeyKind(key: string): StripeKeyKind {
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unknown";
}

/**
 * The shape of a Stripe secret or restricted key. Whether the key may be used here (a live key
 * only in live mode on the production deployment, a test key never in live mode) depends on
 * STRIPE_LIVE_MODE and VERCEL_ENV, so it is decided across fields in `enforceStripeMode`. The
 * message never contains the value.
 */
export const stripeSecretKeySchema = nonEmpty.superRefine((key, ctx) => {
  if (stripeKeyKind(key) === "unknown") {
    ctx.addIssue({
      code: "custom",
      message: "expected a Stripe secret or restricted key (sk_test_..., or sk_live_... in live mode)",
    });
  }
});

/** A host with an optional port ("api.stripe.com", "127.0.0.1:12111"): no scheme, no path. */
const apiHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/, {
    error: 'expected a host such as "api.stripe.com" or "127.0.0.1:12111", without scheme or path',
  });

const m4Shape = {
  VERCEL_PROJECT_ID: nonEmpty,
  VERCEL_TEAM_ID: nonEmpty,
  /** Price ids (not secret). Lookup keys pro_monthly, pro_yearly, studio_monthly, studio_yearly. */
  STRIPE_PRICE_PRO_MONTHLY: nonEmpty,
  STRIPE_PRICE_PRO_YEARLY: nonEmpty,
  STRIPE_PRICE_STUDIO_MONTHLY: nonEmpty,
  STRIPE_PRICE_STUDIO_YEARLY: nonEmpty,
  /** Bearer secret Vercel Cron sends to /api/cron/*. */
  CRON_SECRET: nonEmpty,
  /** Secret for the visitor hash behind unique-visitor counts. */
  VISITOR_HASH_SECRET: nonEmpty,
};

/** Every variable the server reads, by name, so a test source and the real one agree. */
export const SERVER_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_ROOT_DOMAIN",
  "SUPABASE_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_LIVE_MODE",
  "PAID_PLANS_OPEN",
  "VERCEL_API_TOKEN",
  ...M4_REQUIRED_KEYS,
  "VERCEL_API_BASE_URL",
  "STRIPE_API_HOST",
  "VERCEL_ENV",
  "NODE_ENV",
] as const;

function baseShape() {
  return {
    /** `sb_secret_...`. Bypasses RLS. Server code only; the admin client is the sole consumer. */
    SUPABASE_SECRET_KEY: nonEmpty,
    /**
     * Stripe secret or restricted key. A sandbox key by default; a live key (sk_live_, rk_live_)
     * only with STRIPE_LIVE_MODE=true on the production deployment (see `enforceStripeMode`).
     */
    STRIPE_SECRET_KEY: stripeSecretKeySchema.optional(),
    /**
     * "true" or "false", default "false". The one switch to live Stripe: with "true" the key must
     * be live and VERCEL_ENV must be production; with "false" a live key is refused everywhere.
     */
    STRIPE_LIVE_MODE: z.enum(["true", "false"]).default("false"),
    /**
     * "true" or "false", default "true". With "false" the Upgrade buttons are disabled ("Paid plans
     * open soon") and POST /api/billing/checkout answers 403 plans_closed without calling Stripe.
     * Anything but the two words fails validation, so a typo cannot silently open the plans.
     */
    PAID_PLANS_OPEN: z.enum(["true", "false"]).default("true"),
    /**
     * Vercel REST API token (Domains API). Optional at build and startup: adding or removing a
     * custom domain fails closed with a clear error while it is unset (src/lib/pages/vercel-config.ts).
     */
    VERCEL_API_TOKEN: nonEmpty.optional(),
    /** `whsec_...` signing secret of the webhook endpoint. */
    STRIPE_WEBHOOK_SECRET: nonEmpty.optional(),
    /** Test-only: point the Stripe SDK at a local stub. Rejected when VERCEL_ENV=production. */
    STRIPE_API_HOST: apiHostSchema.default(STRIPE_API_DEFAULT_HOST),
    /** Test-only: point the Vercel client at a local stub. Rejected when VERCEL_ENV=production. */
    VERCEL_API_BASE_URL: z.url().default(VERCEL_API_DEFAULT_BASE_URL),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    NODE_ENV: z.string().optional(),
  };
}

type RedirectCheckInput = {
  STRIPE_API_HOST: string;
  VERCEL_API_BASE_URL: string;
  VERCEL_ENV?: "production" | "preview" | "development" | undefined;
};

type StripeModeInput = {
  STRIPE_SECRET_KEY?: string | undefined;
  STRIPE_LIVE_MODE: "true" | "false";
  VERCEL_ENV?: "production" | "preview" | "development" | undefined;
};

/**
 * Which Stripe keys may run where. Live keys are accepted only with STRIPE_LIVE_MODE=true AND
 * VERCEL_ENV=production; a test-mode key is refused when STRIPE_LIVE_MODE=true (live and test are
 * never mixed); with STRIPE_LIVE_MODE unset or "false" a live key is refused in every environment
 * and test keys behave as they always did. A key of no known shape is reported by the field.
 */
function enforceStripeMode(env: StripeModeInput, ctx: z.RefinementCtx): void {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return;
  const kind = stripeKeyKind(key);
  if (kind === "unknown") return;
  const issue = (message: string) =>
    ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message });
  if (env.STRIPE_LIVE_MODE === "true") {
    if (kind === "test") {
      issue(
        "a test-mode key (sk_test_, rk_test_) is not allowed when STRIPE_LIVE_MODE=true; live and test modes are never mixed",
      );
    } else if (env.VERCEL_ENV !== "production") {
      issue(
        "live keys are only allowed when VERCEL_ENV=production; use a sandbox key (sk_test_) with STRIPE_LIVE_MODE=false everywhere else",
      );
    }
  } else if (kind === "live") {
    issue(
      "live keys are not allowed until the move to Vercel Pro; use a sandbox key (sk_test_), or set STRIPE_LIVE_MODE=true on the production deployment",
    );
  }
}

/** API calls cannot be redirected in production: the overrides exist for the local stubs only. */
function refuseRedirectsInProduction(env: RedirectCheckInput, ctx: z.RefinementCtx): void {
  if (env.VERCEL_ENV !== "production") return;
  const message =
    "must not be set when VERCEL_ENV=production (API calls cannot be redirected in production)";
  if (env.STRIPE_API_HOST !== STRIPE_API_DEFAULT_HOST) {
    ctx.addIssue({ code: "custom", path: ["STRIPE_API_HOST"], message });
  }
  if (env.VERCEL_API_BASE_URL !== VERCEL_API_DEFAULT_BASE_URL) {
    ctx.addIssue({ code: "custom", path: ["VERCEL_API_BASE_URL"], message });
  }
}

function refineEnvironment(env: RedirectCheckInput & StripeModeInput, ctx: z.RefinementCtx): void {
  refuseRedirectsInProduction(env, ctx);
  enforceStripeMode(env, ctx);
}

const baseSchema = publicEnvSchema.extend(baseShape());
const strictSchema = baseSchema.extend(m4Shape).superRefine(refineEnvironment);
const lenientSchema = baseSchema
  .extend(z.object(m4Shape).partial().shape)
  .superRefine(refineEnvironment);

/** The parsed environment. The Milestone 4 variables are optional here: see `parseServerEnv`. */
export type ServerEnv = z.output<typeof lenientSchema>;

export interface ParseOptions {
  /** Default true: any of the eight required Milestone 4 variables missing is an error naming it. */
  requireM4?: boolean;
}

/**
 * Parses and validates a server environment source (the real `process.env` values, or a test
 * object) and throws one error that names every missing or invalid variable, never a value.
 * The Milestone 4 variables are required unless `requireM4: false`; "@/lib/env/server" passes
 * `requireM4: true` whenever VERCEL_ENV is set (Vercel builds and runtime), so production and
 * preview deployments cannot start without them, while a local `next dev`, CI or a Vitest run
 * that has not been given them still starts. (`VERCEL_API_TOKEN` is not among them: see
 * `M4_REQUIRED_KEYS`.)
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
  options: ParseOptions = {},
): ServerEnv {
  const requireM4 = options.requireM4 ?? true;
  const schema = requireM4 ? strictSchema : lenientSchema;
  return parseEnv(schema, source, "server") as ServerEnv;
}

/** Reads the named variables from `process.env` (each reference spelled out so bundlers can see it). */
export function readServerEnvSource(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const source: Record<string, string | undefined> = { ...readPublicEnv() };
  for (const key of SERVER_ENV_KEYS) {
    if (!(key in source) || source[key] === undefined) source[key] = env[key];
  }
  return source;
}
