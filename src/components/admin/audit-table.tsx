import { auditLabel, formatDate, type AuditRow } from "@/lib/admin/account-view";
import { formatWhen } from "./format";

const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-top";
const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";

/** The detail of a row as `key: value` text, never markup. Long values are cut. */
function detailText(detail: Record<string, unknown>): string {
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
    });
  return parts.join(", ");
}

/**
 * Audit rows, newest first, read only (M13-05). A data table from 760px and stacked cards below. Every
 * string is React text (admin emails, details, reasons), never markup.
 */
export function AuditTable({
  rows,
  showAccount = true,
}: {
  rows: AuditRow[];
  showAccount?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="block w-full border-collapse text-sm hl:table" data-audit-table="">
        <thead className="hidden bg-page hl:table-header-group">
          <tr>
            <th scope="col" className={TH}>
              When
            </th>
            <th scope="col" className={TH}>
              Admin
            </th>
            <th scope="col" className={TH}>
              Action
            </th>
            {showAccount ? (
              <th scope="col" className={TH}>
                Account
              </th>
            ) : null}
            <th scope="col" className={TH}>
              Detail
            </th>
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {rows.map((row) => (
            <tr
              key={row.id}
              data-audit-id={row.id}
              data-action={row.action}
              className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
            >
              <td className={`${TD} font-mono text-[13px]`} title={row.createdAt}>
                <span className={LABEL}>When</span>
                {formatWhen(row.createdAt) || formatDate(row.createdAt)}
              </td>
              <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Admin</span>
                {row.adminEmail ?? row.adminId}
              </td>
              <td className={TD}>
                <span className={LABEL}>Action</span>
                <span className="font-semibold">{auditLabel(row.action)}</span>
              </td>
              {showAccount ? (
                <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                  <span className={LABEL}>Account</span>
                  {row.accountId ? (
                    <a
                      href={`/admin/accounts/${row.accountId}`}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      {row.accountId.slice(0, 8)}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
              <td className={`${TD} font-mono text-xs text-text-2 [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Detail</span>
                {detailText(row.detail) || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
