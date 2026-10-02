import type { Metadata } from "next";
import { DeleteAccountDialog } from "@/components/app/delete-account-dialog";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { CheckoutReturnNotice } from "@/components/billing/checkout-return";
import { PagesCard } from "@/components/settings/pages-card";
import { PlanBand } from "@/components/settings/plan-band";
import { PlanCards } from "@/components/settings/plan-cards";
import { UsageCard } from "@/components/settings/usage-card";
import { signOut } from "@/lib/auth/actions";
import { buildMeters } from "@/lib/limits";
import { loadAccountUsage } from "@/lib/limits/usage";
import { getAppContext } from "@/lib/pages/context";
import { PRODUCT_DOMAIN, handleAddress } from "@/lib/pages/plans";
import { describeBand, wantsCardLookup } from "@/lib/settings/band";
import { loadBillingSummary } from "@/lib/settings/billing-summary";
import { lookupCardLast4 } from "@/lib/settings/card";

export const metadata: Metadata = { title: "Settings & billing" };

const FIELD_LABEL = "text-[13px] font-semibold text-ink-2";
const FIELD_VALUE =
  "m-0 flex min-h-11 items-center rounded-md border border-line-3 bg-surface px-3 text-sm break-all";

/**
 * Settings & billing (Billing.dc.html). Top to bottom: the "Current plan" band (the account's plan,
 * its price and renewal, the portal buttons), Usage (pages, custom domains, uploads, saved themes
 * against the plan's limits), Plans (Free, Pro, Studio and what each button does), Pages (delete a
 * page) and Account (Milestone 1: the session user's email, the current page's handle, Sign out and
 * Delete account).
 *
 * The gate runs first (`getAppContext`): a signed-out request redirects to sign-in before anything
 * below is read, so no plan data is rendered for it. Everything shown is the signed-in user's own:
 * the plan, the subscription columns and the usage numbers are keyed by the verified session user.
 * Over a plan's limits (after a downgrade) the meters say so and nothing is removed.
 */
export default async function SettingsScreen() {
  const { user, pages, current, plan } = await getAppContext();
  const [summary, usage] = await Promise.all([
    loadBillingSummary(user.id),
    loadAccountUsage(user.id),
  ]);
  // The plan on this screen is the one the rest of the shell shows (read once, with the session).
  const account = { ...summary, plan };
  const cardLast4 = wantsCardLookup(account) ? await lookupCardLast4(account) : null;

  return (
    <>
      <ScreenHeader breadcrumb="Account" title="Settings & billing" />
      <ScreenBody maxWidth="max-w-[920px]">
        <CheckoutReturnNotice plan={plan} />
        <PlanBand summary={account} text={describeBand(account, cardLast4)} />
        <UsageCard meters={buildMeters(plan, usage)} />
        <PlanCards current={plan} />
        <PagesCard
          pages={pages.map((page) => ({
            id: page.id,
            handle: page.handle,
            published: page.published_at !== null,
          }))}
        />

        <Card className="flex flex-col gap-3.5">
          <h2 className="text-sm font-semibold">Account</h2>
          <dl className="flex flex-wrap gap-3">
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
              <dt className={FIELD_LABEL}>Email</dt>
              <dd className={FIELD_VALUE}>{user.email}</dd>
            </div>
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
              <dt className={FIELD_LABEL}>Handle</dt>
              <dd className={`${FIELD_VALUE} font-mono`}>
                <span>
                  {current.handle}
                  <span className="text-text-3">.{PRODUCT_DOMAIN}</span>
                </span>
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 border-t border-line pt-3.5 hl:flex-row hl:items-center hl:justify-between">
            <form action={signOut} className="contents">
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink hl:w-auto"
              >
                Sign out
              </button>
            </form>
            <DeleteAccountDialog
              handle={current.handle}
              addresses={pages.map((page) => handleAddress(page.handle))}
            />
          </div>
        </Card>
      </ScreenBody>
    </>
  );
}
