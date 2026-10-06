import type { AdminPageRow } from "@/lib/admin/view";
import { tenantOrigin } from "@/lib/publish/urls";
import { SuspendAccountButton, UnsuspendButton } from "./admin-buttons";
import { StateChip } from "./chips";

const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-top";
const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";

/** The /admin/pages list (M5-07): one row per page, with its owner's plan and suspension state. */
export function PagesTable({ rows }: { rows: AdminPageRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="block w-full border-collapse text-sm hl:table">
        <thead className="hidden bg-page hl:table-header-group">
          <tr>
            <th scope="col" className={TH}>
              Handle
            </th>
            <th scope="col" className={TH}>
              Owner
            </th>
            <th scope="col" className={TH}>
              Plan
            </th>
            <th scope="col" className={TH}>
              State
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Pages
            </th>
            <th scope="col" className={TH}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {rows.map((row) => (
            <tr
              key={row.pageId ?? `account-${row.ownerId}`}
              data-page-id={row.pageId ?? undefined}
              data-handle={row.handle ?? undefined}
              data-owner-id={row.ownerId}
              className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
            >
              <td className={`${TD} [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Handle</span>
                {row.handle ? (
                  <a
                    href={`${tenantOrigin(row.handle)}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 min-w-11 items-center font-mono text-[13px] underline"
                  >
                    {row.handle}
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 items-center text-text-2">No page</span>
                )}
              </td>
              <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Owner</span>
                {row.ownerEmail || "—"}
              </td>
              <td className={`${TD} capitalize`}>
                <span className={LABEL}>Plan</span>
                {row.plan}
              </td>
              <td className={TD}>
                <span className={LABEL}>State</span>
                <StateChip state={row.state} />
              </td>
              <td className={`${TD} font-mono text-[13px] hl:text-right`}>
                <span className={LABEL}>Pages</span>
                {row.pageCount}
              </td>
              <td className={TD}>
                <div className="mt-1 flex flex-col items-start gap-2 hl:mt-0 hl:flex-row hl:items-center">
                  <a
                    href={`/admin/accounts/${row.ownerId}`}
                    aria-label={`Account details for ${row.handle ?? row.ownerEmail}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink no-underline"
                  >
                    Account
                  </a>
                  {row.state === "suspended" ? (
                    <UnsuspendButton
                      accountId={row.ownerId}
                      handle={row.handle ?? row.ownerEmail}
                    />
                  ) : (
                    <SuspendAccountButton
                      accountId={row.ownerId}
                      handle={row.handle ?? row.ownerEmail}
                      pageCount={row.pageCount}
                    />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
