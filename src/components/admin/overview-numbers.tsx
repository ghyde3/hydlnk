import { STRIPE_DASHBOARD_URL, type OverviewNumbers, type SignupDay } from "@/lib/admin/numbers";
import { SignupsChart } from "./signups-chart";

const STAT = "flex min-w-0 flex-col gap-1 rounded-md border border-line bg-surface p-4";
const nf = new Intl.NumberFormat("en-US");

function Stat({
  id,
  label,
  value,
  note,
}: {
  id: string;
  label: string;
  value: number;
  note?: string;
}) {
  return (
    <div className={STAT} data-stat={id}>
      <span className="font-mono text-xs text-text-2">{label}</span>
      <span className="font-mono text-[22px] font-semibold tabular-nums">{nf.format(value)}</span>
      {note ? <span className="text-xs text-text-2">{note}</span> : null}
    </div>
  );
}

/**
 * The numbers at a glance (M13-03): a row of stats, the 30-day signups chart, and a link to the
 * Stripe dashboard (exact revenue stays in Stripe). Paying accounts are `paid_plan` Pro or Studio,
 * so a gifted plan is never counted.
 */
export function OverviewNumbersSection({
  numbers,
  signups,
}: {
  numbers: OverviewNumbers | null;
  signups: SignupDay[] | null;
}) {
  return (
    <section aria-label="Numbers at a glance" className="flex flex-col gap-3">
      {numbers ? (
        <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
          <Stat
            id="accounts"
            label="Accounts"
            value={numbers.accountsTotal}
            note={`Free ${numbers.accountsFree}, Pro ${numbers.accountsPro}, Studio ${numbers.accountsStudio}`}
          />
          <Stat
            id="paying"
            label="Paying accounts"
            value={numbers.payingTotal}
            note={`Pro ${numbers.payingPro}, Studio ${numbers.payingStudio}. Gifts not counted`}
          />
          <Stat id="live-sites" label="Live sites" value={numbers.liveSites} />
          <Stat
            id="sub-pages"
            label="Sub-pages"
            value={numbers.subPages}
            note={`${numbers.liveSubPages} live`}
          />
          <Stat
            id="domains"
            label="Custom domains"
            value={numbers.liveCustomDomains}
            note="Connected"
          />
          <Stat
            id="views"
            label="Page views"
            value={numbers.views7d}
            note="All sites, last 7 days"
          />
        </div>
      ) : (
        <p
          role="status"
          className="rounded-md border border-line bg-surface p-4 text-sm text-text-2"
        >
          The numbers couldn’t be read right now. Reload to try again.
        </p>
      )}
      <div className="grid gap-3 hl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={STAT}>
          {signups ? (
            <SignupsChart days={signups} />
          ) : (
            <p className="text-sm text-text-2">The signups chart couldn’t be read right now.</p>
          )}
        </div>
        <div className={`${STAT} justify-between`}>
          <span className="font-mono text-xs text-text-2">Revenue</span>
          <p className="text-sm leading-relaxed text-text-2">
            Exact revenue and payouts stay in Stripe.
          </p>
          <a
            href={STRIPE_DASHBOARD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink"
          >
            Open the Stripe dashboard
          </a>
        </div>
      </div>
    </section>
  );
}
