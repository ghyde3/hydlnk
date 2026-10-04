"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { postAdmin } from "@/lib/blocklist/admin-client";
import { formatAddedDate, type BlockedDomainRow } from "@/lib/blocklist/admin-view";

const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-middle";
const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";
const BUTTON =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY = `${BUTTON} border-line-3 bg-surface text-ink`;
const DANGER = `${BUTTON} border-bad-line bg-surface text-bad`;

/**
 * The blocked domains (M7-13): a data table (a mono uppercase header row on --hl-page, like
 * Analytics.dc.html and /admin/traffic) at 760px and up, stacked cards labeled Domain, Reason and
 * Added below it. Every value is React text.
 *
 * "Remove" opens a confirmation in the list, right under the row ("Remove x? Pages can link to it
 * again."). Escape and "Keep blocked" close it and give focus back to "Remove"; "Remove domain" posts
 * to the remove route once (a double click is one request), then the row leaves, `onRemoved` says so,
 * and the screen moves focus to the list's heading.
 */
export function BlockedDomainsTable({
  rows,
  onRemoved,
}: {
  rows: BlockedDomainRow[];
  onRemoved: (domain: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Domains removed from this list already: they leave at once, and the set expires with the rows
  // the refresh brings (a domain that is added again later must show).
  const [gone, setGone] = useState<{ source: BlockedDomainRow[]; domains: string[] }>({
    source: rows,
    domains: [],
  });
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const keepButton = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);

  // Focus moves into the confirmation when it opens, so Escape and Tab work from the keyboard.
  useEffect(() => {
    if (confirming !== null) keepButton.current?.focus();
  }, [confirming]);

  const hidden = gone.source === rows ? gone.domains : [];
  const visible = rows.filter((row) => !hidden.includes(row.domain));

  function close(domain: string) {
    setConfirming(null);
    setError(null);
    removeButtons.current.get(domain)?.focus();
  }

  async function remove(domain: string) {
    if (sending.current) return;
    sending.current = true;
    setRemoving(true);
    setError(null);
    const result = await postAdmin(
      `/api/admin/blocked-links/${encodeURIComponent(domain)}/remove`,
      {},
    );
    sending.current = false;
    setRemoving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirming(null);
    setGone({ source: rows, domains: [...hidden, domain] });
    onRemoved(domain);
  }

  if (visible.length === 0) {
    return (
      <section className="rounded-md border border-line bg-surface p-4 hl:p-5">
        <p className="text-[15px] leading-relaxed text-text-2">No domains are blocked.</p>
      </section>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="block w-full border-collapse text-sm hl:table">
        <thead className="hidden bg-page hl:table-header-group">
          <tr>
            <th scope="col" className={TH}>
              Domain
            </th>
            <th scope="col" className={TH}>
              Reason
            </th>
            <th scope="col" className={TH}>
              Added
            </th>
            <th scope="col" className={TH}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {visible.flatMap((row) => {
            const open = confirming === row.domain;
            const cells = (
              <tr
                key={row.domain}
                data-domain={row.domain}
                className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
              >
                <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                  <span className={LABEL}>Domain</span>
                  {row.domain}
                </td>
                <td className={`${TD} [overflow-wrap:anywhere]`}>
                  <span className={LABEL}>Reason</span>
                  {row.reason ?? "—"}
                </td>
                <td className={`${TD} font-mono text-[13px] hl:whitespace-nowrap`}>
                  <span className={LABEL}>Added</span>
                  {formatAddedDate(row.createdAt)}
                </td>
                <td className={TD}>
                  <div className="mt-1 hl:mt-0">
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) removeButtons.current.set(row.domain, element);
                        else removeButtons.current.delete(row.domain);
                      }}
                      aria-label={`Remove ${row.domain}`}
                      aria-expanded={open}
                      onClick={() => {
                        setError(null);
                        setConfirming(open ? null : row.domain);
                      }}
                      className={SECONDARY}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            );
            if (!open) return [cells];
            const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close(row.domain);
              }
            };
            return [
              cells,
              <tr
                key={`${row.domain}-confirm`}
                data-confirm-for={row.domain}
                className="block border-b border-track bg-page last:border-b-0 hl:table-row"
              >
                <td colSpan={4} className="block px-4 py-3 hl:table-cell" onKeyDown={onKeyDown}>
                  <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                    Remove {row.domain}? Pages can link to it again.
                  </p>
                  <div className="mt-2 flex flex-col gap-2 hl:flex-row">
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => void remove(row.domain)}
                      className={DANGER}
                    >
                      Remove domain
                    </button>
                    <button
                      type="button"
                      ref={keepButton}
                      onClick={() => close(row.domain)}
                      className={SECONDARY}
                    >
                      Keep blocked
                    </button>
                  </div>
                  {error ? (
                    <p role="alert" className="mt-2 text-[13px] text-bad">
                      {error}
                    </p>
                  ) : null}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
