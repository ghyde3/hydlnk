import "server-only";
import type Stripe from "stripe";
import {
  STRIPE_API_DEFAULT_HOST,
  parseServerEnv,
  readServerEnvSource,
} from "@/lib/env/server-schema";
import type { PriceIds } from "./price-map";

/**
 * The Stripe settings, read from `process.env` on every call instead of from the module-level
 * `serverEnv` constant: a local `next dev` picks up an edited .env.local without a restart, and a
 * test can point the SDK at a stub by setting STRIPE_API_HOST. Validation is the one in
 * "@/lib/env/server-schema" (sandbox keys unless STRIPE_LIVE_MODE=true on the production
 * deployment, no API redirects in production), so a key that may not run here fails exactly as it
 * fails at startup. Errors name the variable, never its value.
 */
export interface BillingEnv {
  secretKey: string;
  webhookSecret: string | null;
  apiHost: string;
  prices: PriceIds;
}

function missing(name: string): never {
  throw new Error(
    `Missing server environment variable ${name}. Local values are written to .env.local by scripts/init.sh; production values live in the Vercel project settings. See .env.example.`,
  );
}

function read() {
  return parseServerEnv(readServerEnvSource(), { requireM4: false });
}

/**
 * What the Stripe client needs and nothing else: the sandbox key and the API host. The calls that
 * name no price (opening the portal home, canceling subscriptions when an account is deleted)
 * must not depend on the four price ids being set.
 */
export function readStripeEnv(): { secretKey: string; apiHost: string } {
  const env = read();
  return {
    secretKey: env.STRIPE_SECRET_KEY ?? missing("STRIPE_SECRET_KEY"),
    apiHost: env.STRIPE_API_HOST,
  };
}

/** Everything the Checkout and portal-update calls need. Throws when a Stripe variable is unset. */
export function readBillingEnv(): BillingEnv {
  const env = read();
  return {
    ...readStripeEnv(),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
    prices: {
      proMonthly: env.STRIPE_PRICE_PRO_MONTHLY ?? missing("STRIPE_PRICE_PRO_MONTHLY"),
      proYearly: env.STRIPE_PRICE_PRO_YEARLY ?? missing("STRIPE_PRICE_PRO_YEARLY"),
      studioMonthly: env.STRIPE_PRICE_STUDIO_MONTHLY ?? missing("STRIPE_PRICE_STUDIO_MONTHLY"),
      studioYearly: env.STRIPE_PRICE_STUDIO_YEARLY ?? missing("STRIPE_PRICE_STUDIO_YEARLY"),
    },
  };
}

/**
 * What the webhook needs: the signing secret, the price ids, the API key and whether the
 * deployment is in live mode (an event of the other mode is not this deployment's). The key is for one
 * call only: every subscription event is answered by retrieving the subscription's current state
 * from Stripe, so a webhook without the key cannot do its job and says so up front.
 */
export function readWebhookEnv(): { webhookSecret: string; prices: PriceIds; liveMode: boolean } {
  const env = read();
  if (!env.STRIPE_SECRET_KEY) missing("STRIPE_SECRET_KEY");
  return {
    liveMode: env.STRIPE_LIVE_MODE === "true",
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? missing("STRIPE_WEBHOOK_SECRET"),
    prices: {
      proMonthly: env.STRIPE_PRICE_PRO_MONTHLY ?? missing("STRIPE_PRICE_PRO_MONTHLY"),
      proYearly: env.STRIPE_PRICE_PRO_YEARLY ?? missing("STRIPE_PRICE_PRO_YEARLY"),
      studioMonthly: env.STRIPE_PRICE_STUDIO_MONTHLY ?? missing("STRIPE_PRICE_STUDIO_MONTHLY"),
      studioYearly: env.STRIPE_PRICE_STUDIO_YEARLY ?? missing("STRIPE_PRICE_STUDIO_YEARLY"),
    },
  };
}

/**
 * True unless PAID_PLANS_OPEN is "false". Read on every call, like the rest of this file. The env
 * schema accepts only "true" and "false" (default "true"), so a typo is a startup error rather
 * than a silently open switch.
 */
export function readPaidPlansOpen(): boolean {
  return read().PAID_PLANS_OPEN === "true";
}

/** True when the key is unset (the account-deletion flow skips Stripe for an account with no customer). */
export function isStripeConfigured(): boolean {
  return Boolean(read().STRIPE_SECRET_KEY);
}

/** SDK connection options for an API host ("api.stripe.com" or a local stub like "127.0.0.1:12111"). */
export function sdkHostOptions(apiHost: string): Pick<Stripe.StripeConfig, "host" | "port" | "protocol"> {
  if (apiHost === STRIPE_API_DEFAULT_HOST) return {};
  const [host = apiHost, port] = apiHost.split(":");
  const local = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
  return {
    host,
    ...(port ? { port: Number(port) } : {}),
    protocol: local ? "http" : "https",
  };
}
