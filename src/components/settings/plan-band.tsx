import type { BandText, BillingSummary } from "@/lib/settings/band";
import { BandActions } from "./plan-actions";

/**
 * The charcoal "Current plan" band (M4-05, Billing.dc.html): a mono label with a 6px brass square,
 * the plan in 30px/700 with its price line, the renewal sentence, and (right column) the portal
 * buttons. Every word comes from `describeBand`; the data is the account row, never the URL.
 */
export function PlanBand({ summary, text }: { summary: BillingSummary; text: BandText }) {
  return (
    <section
      aria-label="Current plan"
      data-plan-band
      className="overflow-hidden rounded-md border border-line bg-surface"
    >
      <div className="flex items-center gap-2 bg-ink px-3.5 py-2.5 font-mono text-[11px] tracking-[0.08em] text-on-ink uppercase hl:px-5">
        <span aria-hidden="true" className="inline-block size-1.5 bg-brass" />
        Current plan
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-3.5 hl:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span data-band-plan className="text-[30px] leading-none font-bold tracking-[-0.02em]">
              {text.name}
            </span>
            <span data-band-price className="text-[15px] text-text-2">
              {text.price}
            </span>
          </div>
          {text.renewal ? (
            <p data-band-renewal className="mt-2 text-sm text-text-2">
              {text.renewal}
            </p>
          ) : null}
        </div>
        <BandActions
          plan={summary.plan}
          interval={summary.interval}
          hasCustomer={summary.customerId !== null}
        />
      </div>
    </section>
  );
}
