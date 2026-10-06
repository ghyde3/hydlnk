import type { Metadata } from "next";
import { DeleteAccountDialog } from "@/components/app/delete-account-dialog";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { CheckoutReturnNotice } from "@/components/billing/checkout-return";
import { ConnectedAppsCard } from "@/components/settings/connected-apps-card";
import { PagesCard } from "@/components/settings/pages-card";
import { PlanBand } from "@/components/settings/plan-band";
import { PlanCards } from "@/components/settings/plan-cards";
import { UsageCard } from "@/components/settings/usage-card";
import { readSupportEmail } from "@/lib/admin/env";
import { signOut } from "@/lib/auth/actions";
import { readPaidPlansOpen } from "@/lib/billing/env";
import { CHECKOUT_PARAM, parseCheckoutReturn } from "@/lib/billing/return";
import { buildMeters } from "@/lib/limits";
import { loadAccountUsage } from "@/lib/limits/usage";
import { getAppContext } from "@/lib/pages/context";
import { PRODUCT_DOMAIN, handleAddress } from "@/lib/pages/plans";
import { describeBand, wantsCardLookup } from "@/lib/settings/band";
import { loadBillingSummary } from "@/lib/settings/billing-summary";
import { lookupCardLast4 } from "@/lib/settings/card";
import { failIfInjected } from "@/lib/testing/faults";

export const metadata: Metadata = { title: "Settings & billing" };

const FIELD_LABEL = "text-[13px] font-semibold text-ink-2";
const FIELD_VALUE =
  "m-0 flex min-h-11 items-center rounded-md border border-line-3 bg-surface px-3 text-sm break-all";

/**
 * Settings & billing (Billing.dc.html). Top to bottom: the "Current plan" band (the account's plan,
 * its price and renewal, the portal buttons), Usage (pages, custom domains, uploads, saved themes
 * against the plan's limits), Plans (Free, Pro, Studio and what each button does), Pages (delete a
 * page), Connected apps (apps the person let manage their pages, Wave L) and Account (Milestone 1: the
 * session user's email, the current page's handle, Sign out and Delete account).
 *
 * The gate runs first (`getAppContext`): a signed-out request redirects to sign-in before anything
 * below is read, so no plan data is rendered for it. Everything shown is the signed-in user's own:
 * the plan, the subscription columns and the usage numbers are keyed by the verified session user.
 * Over a plan's limits (after a downgrade) the meters say so and nothing is removed.
 *
 * A gifted account (M13-07) shows the gift in the band and on its plan card; the plan cards and the
 * portal buttons follow what it pays for (`paidPlan`), so it still gets a real upgrade, and Manage
 * billing shows only when a Stripe customer exists.
 *
 * The Upgrade buttons are off in two cases, both decided here on the server: paid plans are not
 * open (PAID_PLANS_OPEN=false) and a Free account has just come back from Checkout
 * (`?checkout=success`, the "Confirming your upgrade" wait). The URL only ever turns a button off.
 */
export default async function SettingsScreen({ searchParams }: PageProps<"/app/settings">) {
  const { user, pages, current, plan } = await getAppContext();
  // The end-to-end specs' way to make a screen throw (M5-20); does nothing in production.
  await failIfInjected("route-throw");
  const query = await searchParams;
  const checkoutParam = query[CHECKOUT_PARAM];
  const [summary, usage] = await Promise.all([
    loadBillingSummary(user.id),
    loadAccountUsage(user.id),
  ]);
  // The plan on this screen is the one the rest of the shell shows (read once, with the session).
  const account = { ...summary, plan };
  // The wait after Checkout is for the webhook to write what the account PAYS for: a gift raises
  // the plan to Pro without Checkout having finished, so the effective plan cannot answer it.
  const confirming =
    parseCheckoutReturn(Array.isArray(checkoutParam) ? checkoutParam[0] : checkoutParam) ===
      "success" && account.paidPlan === "free";
  const cardLast4 = wantsCardLookup(account) ? await lookupCardLast4(account) : null;

  return (
    <>
      <ScreenHeader breadcrumb="Account" title="Settings & billing" />
      <ScreenBody maxWidth="max-w-[920px]">
        <CheckoutReturnNotice plan={account.paidPlan} supportEmail={readSupportEmail()} />
        <PlanBand summary={account} text={describeBand(account, cardLast4)} />
        <UsageCard meters={buildMeters(plan, usage)} plan={plan} />
        <PlanCards
          current={account.paidPlan}
          paidPlansOpen={readPaidPlansOpen()}
          confirming={confirming}
          gift={
            account.gift
              ? { plan: account.gift.plan, note: describeBand(account, cardLast4).gift ?? "" }
              : undefined
          }
        />
        <PagesCard
          pages={pages.map((page) => ({
            id: page.id,
            handle: page.handle,
            name: page.name,
            published: page.published_at !== null,
          }))}
        />
        {/* Wave L (M10-18): apps the person let manage their pages, between Pages and Account. */}
        <ConnectedAppsCard userId={user.id} />

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
