import "server-only";
import Stripe from "stripe";
import { readStripeEnv, sdkHostOptions } from "./env";

/** The Stripe API version every request is made with (and the one the types describe). */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-09-30.endive";

let cached: { key: string; host: string; client: Stripe } | null = null;

/**
 * The one Stripe client: HYDLNK sandbox only. The key comes from `readStripeEnv`, whose
 * validation refuses live keys (sk_live_, rk_live_) in every environment, so there is no way to
 * build a client with one. `STRIPE_API_HOST` (test-only, refused when VERCEL_ENV=production)
 * points the SDK at a local stub; against a stub the SDK does not retry, so a failing call is one
 * request. Server only: `server-only` makes importing this from a Client Component a build error.
 */
export function getStripe(): Stripe {
  const env = readStripeEnv();
  if (cached && cached.key === env.secretKey && cached.host === env.apiHost) return cached.client;
  const stubbed = Object.keys(sdkHostOptions(env.apiHost)).length > 0;
  const client = new Stripe(env.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    ...sdkHostOptions(env.apiHost),
    maxNetworkRetries: stubbed ? 0 : 1,
    timeout: 15_000,
    telemetry: false,
    appInfo: { name: "HYDLNK" },
  });
  cached = { key: env.secretKey, host: env.apiHost, client };
  return client;
}

/** True for the SDK's "no such resource" answer (a customer or subscription deleted in Stripe). */
export function isMissingResource(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}
