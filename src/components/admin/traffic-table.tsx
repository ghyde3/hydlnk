import {
  formatFlagDate,
  formatViews,
  planLabel,
  type TrafficFlagRow,
} from "@/lib/analytics/admin/view";
import { tenantOrigin } from "@/lib/publish/urls";
import { MarkReviewedButton } from "./traffic-actions";

const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-middle";
const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";

/**
 * The high-traffic review queue (M5-10): a data table (mono numbers, a mono uppercase header row on
 * --hl-page, like Analytics.dc.html) at 760px and up, stacked cards below it. A handle, an email and
 * every other string is React text, so nothing in it can run.
 */
export function TrafficTable({ flags, reviewed }: { flags: TrafficFlagRow[]; reviewed: boolean }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="block w-full border-collapse text-sm hl:table">
        <thead className="hidden bg-page hl:table-header-group">
          <tr>
            <th scope="col" className={TH}>
              Page
            </th>
            <th scope="col" className={TH}>
              Owner
            </th>
            <th scope="col" className={TH}>
              Plan
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Views, 30 days
            </th>
            <th scope="col" className={TH}>
              Flagged
            </th>
            <th scope="col" className={TH}>
              {reviewed ? "Reviewed" : "Actions"}
            </th>
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {flags.map((flag) => (
            <tr
              key={flag.flagId}
              data-flag-id={flag.flagId}
              data-page-id={flag.pageId}
              className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
            >
              <td className={`${TD} [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Page</span>
                <a
                  href={`${tenantOrigin(flag.handle)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-11 items-center font-mono text-[13px] underline"
                >
                  {flag.handle}
                </a>
              </td>
              <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Owner</span>
                {flag.ownerEmail ?? "—"}
              </td>
              <td className={TD}>
                <span className={LABEL}>Plan</span>
                <span
                  data-plan={flag.plan}
                  className="inline-flex min-h-6 items-center rounded-sm bg-track px-2 text-xs font-semibold whitespace-nowrap text-text-2"
                >
                  {planLabel(flag.plan)}
                </span>
              </td>
              <td className={`${TD} font-mono text-[13px] tabular-nums hl:text-right`}>
                <span className={LABEL}>Views, 30 days</span>
                <span data-views={flag.views}>{formatViews(flag.views)}</span>
              </td>
              <td className={`${TD} font-mono text-[13px]`}>
                <span className={LABEL}>Flagged</span>
                {formatFlagDate(flag.flaggedAt)}
              </td>
              <td className={reviewed ? `${TD} font-mono text-[13px]` : TD}>
                {reviewed ? (
                  <>
                    <span className={LABEL}>Reviewed</span>
                    {flag.reviewedAt ? formatFlagDate(flag.reviewedAt) : "—"}
                  </>
                ) : (
                  <div className="mt-1 hl:mt-0">
                    <MarkReviewedButton flagId={flag.flagId} handle={flag.handle} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
