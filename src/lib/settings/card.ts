import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import type { BillingSummary } from "./band";

/** The last four digits of a card, or null. Reads only; never throws. */
type CardLookup = Pick<BillingSummary, "customerId" | "subscriptionId">;

const LOOKUP_TIMEOUT_MS = 4_000;

function last4Of(method: string | Stripe.PaymentMethod | null | undefined): string | null {
  if (!method || typeof method === "string") return null;
  const last4 = method.card?.last4;
  return typeof last4 === "string" && /^\d{4}$/.test(last4) ? last4 : null;
}

/**
 * The card on file for the band's "Renews Nov 1, 2026 on the card ending 4242." (M4-05): the
 * customer's default payment method, else the subscription's. Both come from Stripe with the
 * server's key and only for the session user's own customer and subscription ids (read from their
 * `accounts` row, never from the request). Any failure, an unknown id or a slow answer reads as
 * "no card": the band drops the clause and renders the rest.
 */
export async function lookupCardLast4(
  ids: CardLookup,
  stripe: () => Stripe = getStripe,
): Promise<string | null> {
  const work = async (): Promise<string | null> => {
    const client = stripe();
    if (ids.customerId) {
      const customer = await client.customers.retrieve(ids.customerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (!("deleted" in customer && customer.deleted)) {
        const found = last4Of(
          (customer as Stripe.Customer).invoice_settings?.default_payment_method,
        );
        if (found) return found;
      }
    }
    if (ids.subscriptionId) {
      const subscription = await client.subscriptions.retrieve(ids.subscriptionId, {
        expand: ["default_payment_method"],
      });
      return last4Of(subscription.default_payment_method);
    }
    return null;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
