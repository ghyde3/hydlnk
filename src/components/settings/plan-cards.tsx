"use client";

import { useEffect, useState } from "react";
import {
  BILLING_INTERVALS,
  formatCardPrice,
  type BillablePlan,
  type BillingInterval,
} from "@/lib/billing/prices";
import type { UpgradeBlock } from "@/components/billing/upgrade-button";
import { PLAN_IDS, PLAN_LABELS, PLAN_LIMITS, planBlurb, type PlanId } from "@/lib/limits";
import { versionHistoryCell } from "@/lib/versions/messages";
import { PlanCardAction } from "./plan-actions";

const INTERVAL_LABEL: Record<BillingInterval, string> = { month: "Monthly", year: "Yearly" };

/** "$0", "$9/mo", "$5/mo, billed yearly": from the one price table. Free has no yearly price. */
function cardPrice(plan: PlanId, interval: BillingInterval): string {
  return formatCardPrice(plan as BillablePlan | "free", interval);
}

/**
 * The Plans card (M4-05, M4-06 step 1; Billing.dc.html): Free, Pro and Studio side by side (one
 * column on a phone) with the blurbs from PLAN.md, the account's own plan marked "Current plan" and
 * every other card carrying its action (see PlanCardAction). A Free account also gets the
 * "Monthly | Yearly" control above the cards, which switches the Pro and Studio prices and the
 * interval its Upgrade buttons send. Nothing here mentions what v1 does not have.
 *
 * Two things switch the Upgrade buttons off while the cards and their prices stay: paid plans not
 * being open yet (`paidPlansOpen` false, from PAID_PLANS_OPEN: "Paid plans open soon") and the
 * "Confirming your upgrade" wait after Checkout (`confirming`: "Upgrade pending"), so a second
 * subscription is never offered while the first is still being confirmed.
 *
 * `/settings#plans` is where every "See plans" link lands: the section scrolls into view and the
 * Studio card's heading takes focus.
 */
export function PlanCards({
  current,
  paidPlansOpen = true,
  confirming = false,
}: {
  current: PlanId;
  paidPlansOpen?: boolean;
  confirming?: boolean;
}) {
  const blocked: UpgradeBlock | undefined = !paidPlansOpen
    ? "closed"
    : confirming
      ? "pending"
      : undefined;
  const [interval, setInterval] = useState<BillingInterval>("month");

  useEffect(() => {
    const focusStudio = () => {
      if (window.location.hash !== "#plans") return;
      document.getElementById("plan-studio-heading")?.focus({ preventScroll: true });
    };
    focusStudio();
    window.addEventListener("hashchange", focusStudio);
    return () => window.removeEventListener("hashchange", focusStudio);
  }, []);

  return (
    <section
      id="plans"
      aria-labelledby="plans-heading"
      className="flex scroll-mt-4 flex-col gap-3 rounded-md border border-line bg-surface p-4 hl:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <h2 id="plans-heading" className="text-sm font-semibold">
          Plans
        </h2>
        {current === "free" ? (
          <div
            role="group"
            aria-label="Billing interval"
            className="inline-flex w-full gap-0.5 rounded-md bg-track p-0.5 hl:w-auto"
          >
            {BILLING_INTERVALS.map((value) => {
              const selected = interval === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setInterval(value)}
                  className={`min-h-11 flex-1 rounded-sm px-4 text-[13px] font-semibold hl:flex-none ${
                    selected
                      ? "bg-surface text-ink shadow-[0_0_0_1px_var(--hl-line-2)]"
                      : "text-text-2"
                  }`}
                >
                  {INTERVAL_LABEL[value]}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2.5">
        {PLAN_IDS.map((plan) => {
          const isCurrent = plan === current;
          return (
            <div
              key={plan}
              data-plan-card={plan}
              data-current={isCurrent ? "true" : undefined}
              className={`flex flex-col gap-2 rounded-md border p-3.5 ${
                isCurrent ? "border-ink shadow-[0_0_0_1px_var(--hl-ink)]" : "border-line-2"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3
                  id={`plan-${plan}-heading`}
                  tabIndex={-1}
                  className="text-base font-bold outline-offset-4"
                >
                  {PLAN_LABELS[plan]}
                </h3>
                <span data-plan-price className="font-mono text-sm">
                  {cardPrice(plan, interval)}
                </span>
              </div>
              <p className="text-[13px] leading-normal text-text-2">{planBlurb(plan)}</p>
              <p
                data-plan-feature="version-history"
                className="flex items-baseline justify-between gap-2 text-[13px] leading-normal text-text-2"
              >
                <span>Version history</span>
                <span className="font-mono text-ink">
                  {versionHistoryCell(PLAN_LIMITS[plan].versionsKept)}
                </span>
              </p>
              <div className="mt-auto flex flex-col pt-1">
                <PlanCardAction
                  card={plan}
                  current={current}
                  interval={interval}
                  blocked={blocked}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
