import type { ReactNode } from "react";
import {

  PORTAL_PATH,
  formatPrice,
  type BillablePlan,
  type DowngradeTarget,
  type PortalIntent,
} from "@/lib/billing/prices";
import { BillingFormButton, type BillingButtonVariant } from "./billing-form-button";

/**
 * A button that POSTs one portal intent (manage, switch_yearly, upgrade_studio or downgrade) to
 * /api/billing/portal, which opens a Stripe billing-portal session for the signed-in account's own
 * customer and answers 303 to it. Nothing else is sent: no customer id, no price id.
 */
export function PortalButton({
  intent,
  to,
  children,
  variant = "secondary",
  className = "w-full",
}: {
  intent: PortalIntent;
  /** Downgrade only: "free" (cancel) or "pro" (Studio to Pro). Omitted, one step down. */
  to?: DowngradeTarget;
  children: ReactNode;
  variant?: BillingButtonVariant;
  className?: string;
}) {
  return (
    <BillingFormButton
      action={PORTAL_PATH}
      fields={to ? { intent, to } : { intent }}
      variant={variant}
      className={className}
      pendingLabel="Opening Stripe…"
    >
      {children}
    </BillingFormButton>
  );
}

/** "Switch to yearly · $60/yr" (the plan's yearly price). Show it to monthly subscribers only. */
export function SwitchToYearlyButton({ plan }: { plan: BillablePlan }) {
  return (
    <PortalButton intent="switch_yearly">
      Switch to yearly · {formatPrice(plan, "year")}
    </PortalButton>
  );
}

/** "Upgrade to Studio" through the portal, for a Pro account (never a Checkout Session). */
export function UpgradeToStudioButton({ variant = "primary" }: { variant?: BillingButtonVariant }) {
  return (
    <PortalButton intent="upgrade_studio" variant={variant}>
      Upgrade to Studio
    </PortalButton>
  );
}

/** "Downgrade" on a plan card: `to` is the card's plan ("free" cancels, "pro" is Studio to Pro). */
export function DowngradeButton({ to }: { to: DowngradeTarget }) {
  return (
    <PortalButton intent="downgrade" to={to}>
      Downgrade
    </PortalButton>
  );
}

