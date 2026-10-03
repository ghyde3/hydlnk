import Link from "next/link";
import { PLAN_LIMITS, type PlanId } from "@/lib/limits";
import { AddDomainForm } from "./add-domain-form";
import type { PageOption } from "./page-options";
import { SECONDARY } from "./ui";
import { canAddDomain, usageLine } from "./view-model";

/**
 * The "Custom domain" card (M4-10, M4-12, M5-18): the title with the usage line at the right
 * ("0 of 1 used on Pro", counts from the server's usage query), and under it one of
 *   - the locked state for a plan without custom domains ("Custom domains start on Pro." and a
 *     "See plans" link, and no input anywhere in the DOM),
 *   - the add form while a slot is free (a Pro account with nothing yet sees the form and no list),
 *   - nothing at the limit: the usage line is the whole message, the form is gone.
 * The domains themselves are separate cards under this one.
 */
export function CustomDomainCard({
  plan,
  used,
  pages,
  currentPageId,
}: {
  plan: PlanId;
  used: number;
  pages: PageOption[];
  currentPageId: string;
}) {
  const usage = usageLine(plan, used);
  const locked = PLAN_LIMITS[plan].customDomains === 0;
  const canAdd = canAddDomain(plan, used);
  return (
    <section
      aria-labelledby="custom-domain-heading"
      data-custom-domain-card
      className="overflow-hidden rounded-md border border-line bg-surface"
    >
      <div
        className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3.5 hl:px-5 ${
          locked || canAdd ? "border-b border-line" : ""
        }`}
      >
        <h2 id="custom-domain-heading" className="text-sm font-semibold">
          Custom domain
        </h2>
        {usage ? (
          <span data-domain-usage className="text-xs text-text-2">
            {usage}
          </span>
        ) : null}
      </div>
      {locked ? (
        <div
          data-domains-locked
          className="flex flex-col gap-3 px-4 py-3.5 hl:flex-row hl:items-center hl:justify-between hl:px-5"
        >
          <p className="text-sm text-text-2">Custom domains start on Pro.</p>
          <Link href="/settings#plans" className={`${SECONDARY} w-full hl:w-auto`}>
            See plans
          </Link>
        </div>
      ) : canAdd ? (
        <AddDomainForm pages={pages} currentPageId={currentPageId} />
      ) : null}
    </section>
  );
}
