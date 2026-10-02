"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { billingMessage } from "@/lib/billing/prices";
import {
  BILLING_ERROR_PARAM,
  CHECKOUT_CANCELED,
  CHECKOUT_CONFIRMING,
  CHECKOUT_PARAM,
  CHECKOUT_POLL_INTERVAL_MS,
  CHECKOUT_POLL_LIMIT_MS,
  CHECKOUT_SLOW,
  parseCheckoutReturn,
} from "@/lib/billing/return";

const BOX =
  "flex items-start gap-2.5 rounded-md border bg-surface px-3.5 py-3 text-sm leading-normal";

function Notice({ plan }: { plan: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const checkout = parseCheckoutReturn(params.get(CHECKOUT_PARAM));
  const billingError = billingMessage(params.get(BILLING_ERROR_PARAM));
  const [slow, setSlow] = useState(false);

  const waiting = checkout === "success" && plan === "free";
  const confirmed = checkout === "success" && plan !== "free";

  // Waiting for the webhook: re-read the account every 2 seconds, for 30 seconds at most. The
  // refresh re-runs the Settings page on the server, which reads the plan from the database; the
  // moment it is no longer Free the effect below ends the wait.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= CHECKOUT_POLL_LIMIT_MS) {
        clearInterval(timer);
        setSlow(true);
        return;
      }
      router.refresh();
    }, CHECKOUT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  // The plan flipped: the band already shows it, so drop `?checkout=success` and a later reload
  // does not wait again.
  useEffect(() => {
    if (confirmed) router.replace("/settings", { scroll: false });
  }, [confirmed, router]);

  if (billingError) {
    return (
      <div role="alert" data-billing-notice="error" className={`${BOX} border-bad-line text-bad`}>
        {billingError}
      </div>
    );
  }
  if (checkout === "canceled") {
    return (
      <div role="status" data-billing-notice="canceled" className={`${BOX} border-line text-ink`}>
        {CHECKOUT_CANCELED}
      </div>
    );
  }
  if (waiting) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-billing-notice={slow ? "slow" : "confirming"}
        className={`${BOX} border-line text-ink`}
      >
        <span aria-hidden="true" className="mt-[7px] inline-block size-1.5 shrink-0 bg-brass" />
        <span>{slow ? CHECKOUT_SLOW : CHECKOUT_CONFIRMING}</span>
      </div>
    );
  }
  return null;
}

/**
 * The notice at the top of Settings & billing for what a trip to Stripe left behind (M4-06):
 * "Confirming your upgrade" (aria-live polite) while the page re-reads the account every 2
 * seconds for up to 30 seconds, the "taking longer than usual" sentence after that,
 * "Checkout canceled. Your plan hasn’t changed." after a canceled Checkout, and the message for a
 * billing form that failed (`?billing_error=`). `plan` is the plan the server read from the
 * database for this render; the URL never decides it.
 */
export function CheckoutReturnNotice({ plan }: { plan: string }) {
  return (
    <Suspense fallback={null}>
      <Notice plan={plan} />
    </Suspense>
  );
}
