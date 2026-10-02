/**
 * What /settings shows after Stripe sends the browser back (M4-06), and how long it waits for the
 * webhook. No secrets and no server-only import: the Settings screen's client notice reads it.
 *
 * Returning from Checkout proves nothing. `?checkout=success` only starts a short wait for the
 * signed webhook to change the plan in the database; the plan the screen shows is always the one
 * the database holds, so loading the URL by hand as a Free account changes nothing.
 */

/** The query parameter Checkout's success and cancel URLs carry. */
export const CHECKOUT_PARAM = "checkout";
/** The query parameter a failed billing form submit is sent back with (see `answer` in ./http). */
export const BILLING_ERROR_PARAM = "billing_error";

/** Re-read the account this often while waiting for the webhook … */
export const CHECKOUT_POLL_INTERVAL_MS = 2_000;
/** … and give up after this long. */
export const CHECKOUT_POLL_LIMIT_MS = 30_000;

export const CHECKOUT_CONFIRMING = "Confirming your upgrade";
export const CHECKOUT_SLOW =
  "This is taking longer than usual. Refresh in a minute. You are only charged once.";
export const CHECKOUT_CANCELED = "Checkout canceled. Your plan hasn’t changed.";

export type CheckoutReturn = "success" | "canceled" | null;

/** The value of the `checkout` parameter when it is one of the two Checkout sets, else null. */
export function parseCheckoutReturn(value: string | null | undefined): CheckoutReturn {
  return value === "success" || value === "canceled" ? value : null;
}
