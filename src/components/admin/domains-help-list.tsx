import Link from "next/link";
import { formatAge, type DomainHelp } from "@/lib/admin/domains-help";
import { formatWhen } from "./format";
import { DomainRecheckButton } from "./domain-recheck";

const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-middle";
const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";

/** Domains unverified over 24 hours or failing (M13-04). Every string is React text. */
export function DomainsHelpList({ domains }: { domains: DomainHelp[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="block w-full border-collapse text-sm hl:table">
        <thead className="hidden bg-page hl:table-header-group">
          <tr>
            <th scope="col" className={TH}>
              Domain
            </th>
            <th scope="col" className={TH}>
              Owner
            </th>
            <th scope="col" className={TH}>
              Age
            </th>
            <th scope="col" className={TH}>
              Last check
            </th>
            <th scope="col" className={TH}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {domains.map((domain) => (
            <tr
              key={domain.id}
              data-domain-id={domain.id}
              data-hostname={domain.hostname}
              data-reason={domain.reason}
              className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
            >
              <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Domain</span>
                {domain.hostname}
                <span className="mt-0.5 block text-xs text-text-2">
                  {domain.reason === "failed" ? "Failing" : "Unverified over 24 hours"}
                </span>
              </td>
              <td className={`${TD} [overflow-wrap:anywhere]`}>
                <span className={LABEL}>Owner</span>
                <Link
                  href={`/admin/accounts/${domain.ownerId}`}
                  className="inline-flex min-h-11 items-center font-mono text-[13px] underline"
                >
                  {domain.ownerEmail ?? domain.handle}
                </Link>
                <span className="block font-mono text-xs text-text-2">{domain.handle}</span>
              </td>
              <td className={`${TD} font-mono text-[13px] whitespace-nowrap`}>
                <span className={LABEL}>Age</span>
                {formatAge(domain.ageSeconds)}
              </td>
              <td className={`${TD} text-[13px]`}>
                <span className={LABEL}>Last check</span>
                <span data-testid="last-result">{domain.result}</span>
                <span data-testid="last-checked" className="block font-mono text-xs text-text-2">
                  {domain.lastCheckedAt ? formatWhen(domain.lastCheckedAt) : "—"}
                </span>
              </td>
              <td className={TD}>
                <div className="mt-1 hl:mt-0">
                  <DomainRecheckButton domainId={domain.id} hostname={domain.hostname} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
