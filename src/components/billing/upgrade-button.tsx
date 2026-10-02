import { BillingFormButton, type BillingButtonVariant } from "./billing-form-button";
import { CHECKOUT_PATH, type BillablePlan, type BillingInterval } from "@/lib/billing/prices";

const LABEL: Record<BillablePlan, string> = { pro: "Upgrade to Pro", studio: "Upgrade to Studio" };

/**
 * "Upgrade to Pro" / "Upgrade to Studio" (M4-06): a form that POSTs the plan and the interval to
 * /api/billing/checkout, which creates the Stripe Checkout Session and answers 303 to it. Show it
 * to a Free account only; the endpoint refuses a paid account (409) either way. A full-width,
 * 44px-tall button; pass `className` for layout.
 */
export function UpgradeButton({
  plan,
  interval,
  variant = "primary",
  className = "w-full",
}: {
  plan: BillablePlan;
  interval: BillingInterval;
  variant?: BillingButtonVariant;
  className?: string;
}) {
  return (
    <BillingFormButton
      action={CHECKOUT_PATH}
      fields={{ plan, interval }}
      variant={variant}
      className={className}
      pendingLabel="Opening Stripe…"
    >
      {LABEL[plan]}
    </BillingFormButton>
  );
}
