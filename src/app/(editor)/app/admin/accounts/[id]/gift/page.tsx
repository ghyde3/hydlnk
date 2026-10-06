import Link from "next/link";
import { notFound } from "next/navigation";
import { GiftForm } from "@/components/admin/gift-form";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { requireAdmin } from "@/lib/admin/auth";
import { loadGiftAccount } from "@/lib/billing/gift-queries";
import { describeGift, formatGiftDate } from "@/lib/billing/gift-view";
import { PLAN_LABELS } from "@/lib/limits";

export const metadata = { title: "Gift a plan" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL = "text-[13px] font-semibold text-ink-2";
const VALUE = "m-0 min-h-6 text-sm [overflow-wrap:anywhere]";

/**
 * /admin/accounts/{id}/gift (M13-07): what an account pays for, what it gets (the effective plan) and
 * any gift, with the form to give Pro or Studio and End gift. A non-admin gets the app's 404 from
 * `requireAdmin` (a signed-out visitor goes to sign-in); an id that is not an account is a 404 too.
 * Every change is guarded again on the server (`gift_plan` and `end_gift`, both audited). A gift
 * never creates or changes anything in Stripe.
 */
export default async function AdminGiftScreen({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const account = await loadGiftAccount(id.toLowerCase());
  if (!account) notFound();
  const { gift } = account;

  return (
    <>
      <ScreenHeader breadcrumb="admin / accounts" title="Gift a plan" />
      <ScreenBody maxWidth="max-w-[920px]">
        <p className="text-sm leading-relaxed text-text-2">
          A gift raises the plan without a charge and never touches Stripe. The account keeps its
          own subscription, and when the gift ends it goes back to what it pays for. Nothing is
          deleted.
        </p>
        <Card className="flex flex-col gap-3.5">
          <h2 className="text-sm font-semibold">Account</h2>
          <dl className="grid gap-3 hl:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <dt className={LABEL}>Email</dt>
              <dd className={VALUE}>{account.email ?? "No email"}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className={LABEL}>Handles</dt>
              <dd className={`${VALUE} font-mono`}>
                {account.handles.length > 0 ? account.handles.join(", ") : "None"}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className={LABEL}>Paid plan</dt>
              <dd data-gift-paid-plan className={VALUE}>
                {PLAN_LABELS[account.paidPlan]}
                {account.hasStripeCustomer ? "" : " (no Stripe customer)"}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className={LABEL}>Effective plan</dt>
              <dd data-gift-effective-plan className={`${VALUE} font-semibold`}>
                {PLAN_LABELS[account.plan]}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 hl:col-span-2">
              <dt className={LABEL}>Gift</dt>
              <dd data-gift-current className={VALUE}>
                {gift ? describeGift(gift.plan, gift.until) : "No gift"}
              </dd>
              {gift ? (
                <dd className="m-0 text-[13px] text-text-2 [overflow-wrap:anywhere]">
                  {gift.giftedAt ? `Given ${formatGiftDate(gift.giftedAt)}` : "Given"}
                  {gift.giftedBy ? ` by ${gift.giftedBy}` : ""}
                  {gift.reason ? `. Reason: ${gift.reason}` : ". No reason given."}
                </dd>
              ) : null}
            </div>
          </dl>
        </Card>
        <GiftForm accountId={account.id} hasGift={gift !== null} />
        <Link
          href={`/admin/accounts/${account.id}`}
          className="inline-flex min-h-11 items-center text-sm font-semibold underline"
        >
          Back to the account
        </Link>
      </ScreenBody>
    </>
  );
}
