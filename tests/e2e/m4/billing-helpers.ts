import type { BrowserContext } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { rand, signedInUser, type SignedInUser } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, type RawResponse } from "../fixtures/http";
import { addStubSubscription, priceIds, type StubRequest } from "../fixtures/stripe-stub";

/**
 * Shared by the billing specs that drive /api/billing/checkout and /api/billing/portal: sign-in,
 * a form POST with or without the session cookie, and accounts seeded the way the webhook would
 * leave them (customer, subscription, plan and interval), with the subscription also known to the
 * Stripe stub so the portal's own look-up finds it.
 */

export const STUB_ORIGIN = "http://127.0.0.1:12111";
export const APP_ORIGIN = "http://app.localhost:3000";
const FORM = { "content-type": "application/x-www-form-urlencoded" };

/** POST a urlencoded form to an app-host path. `context` null means no session cookie at all. */
export async function postForm(
  context: BrowserContext | null,
  path: string,
  fields: Record<string, string> | string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const cookie = context ? cookieHeader(await authCookies(context)) : undefined;
  return appRaw(path, {
    method: "POST",
    ...(cookie ? { cookie } : {}),
    headers: { ...FORM, ...headers },
    body: typeof fields === "string" ? fields : new URLSearchParams(fields).toString(),
  });
}

export const checkout = (
  context: BrowserContext | null,
  fields: Record<string, string> | string,
  headers?: Record<string, string>,
) => postForm(context, "/api/billing/checkout", fields, headers);

export const portal = (
  context: BrowserContext | null,
  fields: Record<string, string> | string,
  headers?: Record<string, string>,
) => postForm(context, "/api/billing/portal", fields, headers);

export async function accountRow(userId: string) {
  const { data, error } = await adminClient()
    .from("accounts")
    .select(
      "id, plan, stripe_customer_id, stripe_subscription_id, billing_interval, current_period_end, cancel_at_period_end, stripe_event_created_at, updated_at",
    )
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export type PaidPlan = "pro" | "studio";
export type Interval = "month" | "year";

const PRICE = {
  pro: { month: "proMonthly", year: "proYearly" },
  studio: { month: "studioMonthly", year: "studioYearly" },
} as const;

/** The configured price id for a plan and interval (the same four the app reads). */
export const priceFor = (plan: PaidPlan, interval: Interval): string =>
  priceIds()[PRICE[plan][interval]];

export interface BillingUser extends SignedInUser {
  customer: string | null;
  subscription: string | null;
}

/**
 * A signed-in user whose account holds a customer id and, for a paid plan, a live subscription on
 * the price of `plan` and `interval` (in the database as the webhook would have written it, and in
 * the Stripe stub). `plan: "free"` with `customer: true` is a Free account that once subscribed.
 */
export async function billingUser(
  context: BrowserContext,
  opts: {
    label: string;
    plan?: "free" | PaidPlan;
    interval?: Interval;
    customer?: boolean;
  },
): Promise<BillingUser> {
  const plan = opts.plan ?? "free";
  const interval = opts.interval ?? "month";
  const user = await signedInUser(context, { label: opts.label });
  const customer = plan !== "free" || opts.customer ? `cus_zq${rand(10)}` : null;
  const subscription = plan !== "free" ? `sub_zq${rand(10)}` : null;
  if (customer) {
    const patch: Record<string, unknown> = { stripe_customer_id: customer };
    if (plan !== "free" && subscription) {
      Object.assign(patch, {
        plan,
        stripe_subscription_id: subscription,
        billing_interval: interval,
        current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      });
    }
    const { error } = await adminClient().from("accounts").update(patch).eq("id", user.userId);
    if (error) throw new Error(`seeding the account failed: ${error.message}`);
  }
  if (plan !== "free" && customer && subscription) {
    await addStubSubscription({
      id: subscription,
      customer,
      priceId: priceFor(plan, interval),
    });
  }
  return { ...user, customer, subscription };
}

/** The form fields a request carried, for `needle` appearing in any value (customer, user id). */
export const formOf = (request: StubRequest): Record<string, string> => request.form;
