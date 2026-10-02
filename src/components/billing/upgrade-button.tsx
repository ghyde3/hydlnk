import {
  BillingFormButton,
  UnavailableBillingButton,
  type BillingButtonVariant,
} from "./billing-form-button";
import { CHECKOUT_PATH, type BillablePlan, type BillingInterval } from "@/lib/billing/prices";

const LABEL: Record<BillablePlan, string> = { pro: "Upgrade to Pro", studio: "Upgrade to Studio" };

/** Why an Upgrade button is not offered: paid plans are not open yet, or one is being confirmed. */
export type UpgradeBlock = "closed" | "pending";

export const PAID_PLANS_CLOSED_LABEL = "Paid plans open soon";
export const UPGRADE_PENDING_LABEL = "Upgrade pending";

/**
 * "Upgrade to Pro" / "Upgrade to Studio" (M4-06): a form that POSTs the plan and the interval to
 * /api/billing/checkout, which creates the Stripe Checkout Session and answers 303 to it. Show it
 * to a Free account only; the endpoint refuses a paid account (409) either way. A full-width,
 * 44px-tall button; pass `className` for layout.
 *
 * `blocked` replaces it with a disabled button of the same size and no form: "Paid plans open soon"
 * while PAID_PLANS_OPEN=false (the endpoint answers 403 plans_closed regardless), "Upgrade pending"
 * while the "Confirming your upgrade" wait is showing, so a second subscription is not offered
 * while the first one is still being confirmed.
 */
export function UpgradeButton({
  plan,
  interval,
  variant = "primary",
  className = "w-full",
  blocked,
}: {
  plan: BillablePlan;
  interval: BillingInterval;
  variant?: BillingButtonVariant;
  className?: string;
  blocked?: UpgradeBlock | undefined;
}) {
  if (blocked) {
    return (
      <UnavailableBillingButton reason={blocked} variant={variant} className={className}>
        {blocked === "closed" ? PAID_PLANS_CLOSED_LABEL : UPGRADE_PENDING_LABEL}
      </UnavailableBillingButton>
    );
  }
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
