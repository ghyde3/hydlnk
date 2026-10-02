import "server-only";
import { readBillingAccount } from "./account";
import { getStripe, isMissingResource } from "./stripe";

/** Subscription statuses that are already over: nothing left to cancel. */
const ENDED = new Set(["canceled", "incomplete_expired"]);

/**
 * Cancels every live subscription of the account's Stripe customer, once each (M4-34): the first
 * step of deleting an account, before anything is removed, so a deletion never leaves a paying
 * account with nobody to cancel it. An account with no customer id has nothing to cancel and
 * makes no Stripe call. The customer id is read from the account of `accountId` (the verified
 * session user), never from the request.
 *
 * Safe to run again after a failure: subscriptions that were already canceled are not in the live
 * set the next time, so a retry cancels only what is left. A customer that no longer exists in
 * Stripe has nothing to cancel. Any other failure throws and the caller stops the deletion.
 * Returns how many subscriptions it canceled.
 */
export async function cancelAccountBilling(accountId: string): Promise<number> {
  const account = await readBillingAccount(accountId);
  const customer = account?.stripe_customer_id;
  if (!customer) return 0;

  const stripe = getStripe();
  let canceled = 0;
  let startingAfter: string | undefined;
  for (let pageCount = 0; pageCount < 20; pageCount++) {
    let page;
    try {
      page = await stripe.subscriptions.list({
        customer,
        status: "all",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (error) {
      if (isMissingResource(error)) return canceled;
      throw error;
    }
    for (const subscription of page.data) {
      if (ENDED.has(subscription.status)) continue;
      try {
        await stripe.subscriptions.cancel(subscription.id);
        canceled += 1;
      } catch (error) {
        if (!isMissingResource(error)) throw error;
      }
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]!.id;
  }
  return canceled;
}
