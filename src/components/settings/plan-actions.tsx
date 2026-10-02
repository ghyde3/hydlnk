import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import {
  DowngradeButton,
  SwitchToYearlyButton,
  UpgradeToStudioButton,
} from "@/components/billing/portal-button";
import { UpgradeButton, type UpgradeBlock } from "@/components/billing/upgrade-button";
import type { BillablePlan, BillingInterval } from "@/lib/billing/prices";
import type { PlanId } from "@/lib/limits";

/**
 * The one file of Settings & billing that imports the Stripe buttons (the billing components own
 * what each button does: Checkout for a Free account, the customer portal for everything else).
 * This file only decides which button belongs where; the rest of the screen never names them.
 * No hooks and no server-only imports, so the server band and the client plan cards can both use it.
 */

/** The inert tile that replaces the button on the card matching the account's plan. */
export function CurrentPlanTile() {
  return (
    <span
      data-current-plan-tile
      className="flex min-h-11 items-center justify-center rounded-md bg-track text-[13px] font-semibold text-ink"
    >
      Current plan
    </span>
  );
}

/**
 * The action at the foot of one plan card.
 *   the account's own plan   an inert "Current plan" tile
 *   Free account             "Upgrade to Pro" / "Upgrade to Studio" (Checkout, at the chosen interval),
 *                            disabled when `blocked` says why (see UpgradeButton)
 *   Pro account              Free: "Downgrade" (cancel in the portal); Studio: "Upgrade to Studio" (portal)
 *   Studio account           Free and Pro: "Downgrade" (portal)
 */
export function PlanCardAction({
  card,
  current,
  interval,
  blocked,
}: {
  card: PlanId;
  current: PlanId;
  interval: BillingInterval;
  blocked?: UpgradeBlock | undefined;
}) {
  if (card === current) return <CurrentPlanTile />;
  if (current === "free") {
    return card === "free" ? null : (
      <UpgradeButton plan={card} interval={interval} blocked={blocked} />
    );
  }
  if (card === "free") return <DowngradeButton to="free" />;
  if (current === "pro" && card === "studio") return <UpgradeToStudioButton />;
  if (current === "studio" && card === "pro") return <DowngradeButton to="pro" />;
  return null;
}

/**
 * The buttons in the plan band's right column: "Manage billing" for any account that has a Stripe
 * customer (a Free account that once subscribed included), "Switch to yearly" for monthly
 * subscribers only. Renders nothing (and no helper text) when there is nothing to offer.
 */
export function BandActions({
  plan,
  interval,
  hasCustomer,
}: {
  plan: PlanId;
  interval: BillingInterval | null;
  hasCustomer: boolean;
}) {
  const showYearly = plan !== "free" && interval === "month";
  if (!hasCustomer && !showYearly) return null;
  return (
    <div className="flex w-full flex-col items-stretch gap-2 hl:w-auto hl:max-w-80 hl:flex-[1_1_240px]">
      {hasCustomer ? <ManageBillingButton /> : null}
      {showYearly ? <SwitchToYearlyButton plan={plan as BillablePlan} /> : null}
      <span className="text-xs leading-normal text-text-2">
        Card, invoices and cancellation open in Stripe’s secure customer portal.
      </span>
    </div>
  );
}
