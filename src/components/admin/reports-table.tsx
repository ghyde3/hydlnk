import { previewDetails, type ReportRow } from "@/lib/admin/view";
import { tenantOrigin } from "@/lib/publish/urls";
import { DismissReportButton, SuspendAccountButton, UnsuspendButton } from "./admin-buttons";
import { ReportStatusChip } from "./chips";
import { formatWhen, reasonLabel } from "./format";

const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-top";
const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";

/**
 * The report queue (M5-06): a data table (mono numbers, header row on --hl-page) at 760px and up,
 * stacked cards below it. Everything a reporter typed (details, email) is React text, so markup in
 * it shows as the literal characters and nothing runs.
 */
export function ReportsTable({ reports }: { reports: ReportRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="block w-full border-collapse text-sm hl:table">
        <thead className="hidden bg-page hl:table-header-group">
          <tr>
            <th scope="col" className={TH}>
              Reported
            </th>
            <th scope="col" className={TH}>
              Page
            </th>
            <th scope="col" className={TH}>
              Reason
            </th>
            <th scope="col" className={TH}>
              Details
            </th>
            <th scope="col" className={TH}>
              Reporter
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Reports
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {reports.map((report) => (
            <tr
              key={report.id}
              data-report-id={report.id}
              className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
            >
              <td className={`${TD} font-mono text-[13px]`}>
                <span className={LABEL}>Reported</span>
                {formatWhen(report.createdAt)}
              </td>
              <td className={`${TD} [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Page</span>
                {report.pageDeleted || !report.handle ? (
                  <span className="text-text-2">Page deleted</span>
                ) : (
                  <a
                    href={`${tenantOrigin(report.handle)}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 min-w-11 items-center font-mono text-[13px] underline"
                  >
                    {report.handle}
                  </a>
                )}
              </td>
              <td className={TD}>
                <span className={LABEL}>Reason</span>
                {reasonLabel(report.reason)}
              </td>
              <td className={`${TD} max-w-[320px] [overflow-wrap:anywhere] text-text-2`}>
                <span className={LABEL}>Details</span>
                {previewDetails(report.details) || "—"}
              </td>
              <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Reporter</span>
                {report.reporterEmail ?? "—"}
              </td>
              <td className={`${TD} font-mono text-[13px] hl:text-right`}>
                <span className={LABEL}>Reports</span>
                {report.reportCount}
              </td>
              <td className={TD}>
                <span className={LABEL}>Status</span>
                <ReportStatusChip status={report.status} />
              </td>
              <td className={TD}>
                <ReportActions report={report} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportActions({ report }: { report: ReportRow }) {
  if (report.status !== "open") return <span className="text-text-3">—</span>;
  return (
    <div className="mt-1 flex flex-col gap-2 hl:mt-0 hl:flex-row hl:flex-wrap">
      <DismissReportButton reportId={report.id} />
      {report.pageDeleted || !report.ownerId || !report.handle ? null : report.ownerSuspended ? (
        <UnsuspendButton accountId={report.ownerId} handle={report.handle} />
      ) : (
        <SuspendAccountButton
          accountId={report.ownerId}
          handle={report.handle}
          pageCount={report.ownerPageCount}
          label="Suspend owner"
        />
      )}
    </div>
  );
}
