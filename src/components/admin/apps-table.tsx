"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { appOrigin, type AppRow } from "@/lib/admin/apps-view";
import { postAdmin } from "@/lib/blocklist/admin-client";
import { DANGER, FieldBox, LABEL, SECONDARY, TD, TH, controlClass } from "./fields";
import { formatWhen } from "./format";

/**
 * The connected AI apps (M13-10): a data table at 760px and up, stacked cards below. "Revoke for
 * everyone" opens a confirmation under the row that asks for a reason, then ends every connection of
 * the app and blocks it; "Restore" lifts the block (people connect it again themselves). Every value
 * is React text: an app's name is whatever the app called itself.
 */
export function AppsTable({ rows }: { rows: AppRow[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sending = useRef(false);

  async function send(path: string, body: Record<string, unknown>, done: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const result = await postAdmin(path, body);
    sending.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirming(null);
    setReason("");
    setNote(done);
    router.refresh();
  }

  return (
    <>
      {note ? (
        <p role="status" className="text-sm font-semibold text-good">
          {note}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <section className="rounded-md border border-line bg-surface p-4 hl:p-5">
          <p className="text-[15px] leading-relaxed text-text-2">
            No apps are connected or revoked right now.
          </p>
        </section>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="block w-full border-collapse text-sm hl:table">
            <thead className="hidden bg-page hl:table-header-group">
              <tr>
                {["App", "Connections", "Calls, 7 days", "Last call", "Status", "Actions"].map(
                  (name) => (
                    <th key={name} scope="col" className={TH}>
                      {name}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="block hl:table-row-group">
              {rows.flatMap((row) => {
                const open = confirming === row.clientId;
                const blocked = row.blockedAt !== null;
                const main = (
                  <tr
                    key={row.clientId}
                    data-client-id={row.clientId}
                    data-blocked={blocked ? "true" : "false"}
                    className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
                  >
                    <td className={`${TD} [overflow-wrap:anywhere]`}>
                      <span className={LABEL}>App</span>
                      <span className="font-semibold">{row.name}</span>
                      <span className="block font-mono text-xs text-text-2">{appOrigin(row)}</span>
                    </td>
                    <td className={`${TD} font-mono text-[13px]`}>
                      <span className={LABEL}>Connections</span>
                      {row.activeConnections}
                    </td>
                    <td className={`${TD} font-mono text-[13px]`}>
                      <span className={LABEL}>Calls, 7 days</span>
                      {row.calls7d}
                      {row.errors7d > 0 ? ` (${row.errors7d} failed)` : ""}
                    </td>
                    <td className={`${TD} font-mono text-[13px] hl:whitespace-nowrap`}>
                      <span className={LABEL}>Last call</span>
                      {row.lastCallAt ? formatWhen(row.lastCallAt) : "—"}
                    </td>
                    <td className={`${TD} [overflow-wrap:anywhere]`}>
                      <span className={LABEL}>Status</span>
                      {blocked ? (
                        <span className="inline-flex min-h-6 items-center rounded-sm border border-bad-line px-2 text-xs font-semibold text-bad">
                          Revoked
                        </span>
                      ) : (
                        <span className="inline-flex min-h-6 items-center rounded-sm bg-good-bg px-2 text-xs font-semibold text-good">
                          Allowed
                        </span>
                      )}
                      {blocked && row.blockedReason ? (
                        <span className="mt-1 block text-xs text-text-2">{row.blockedReason}</span>
                      ) : null}
                    </td>
                    <td className={TD}>
                      <div className="mt-1 hl:mt-0">
                        {blocked ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Restore ${row.name}`}
                            onClick={() =>
                              void send(
                                "/api/admin/apps/unblock",
                                { client_id: row.clientId },
                                `Restored ${row.name}. People can connect it again.`,
                              )
                            }
                            className={SECONDARY}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Revoke ${row.name} for everyone`}
                            aria-expanded={open}
                            onClick={() => {
                              setError(null);
                              setReason("");
                              setConfirming(open ? null : row.clientId);
                            }}
                            className={SECONDARY}
                          >
                            Revoke for everyone
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
                if (!open) return [main];
                return [
                  main,
                  <tr
                    key={`${row.clientId}-confirm`}
                    data-confirm-for={row.clientId}
                    className="block border-b border-track bg-page last:border-b-0 hl:table-row"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setConfirming(null);
                    }}
                  >
                    <td colSpan={6} className="block px-4 py-3 hl:table-cell">
                      <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                        Revoke {row.name} for everyone? It loses all {row.activeConnections}{" "}
                        {row.activeConnections === 1 ? "connection" : "connections"} and can’t
                        connect again until you restore it.
                      </p>
                      <div className="mt-2 max-w-[520px]">
                        <FieldBox label="Reason" hint="Required. Up to 500 characters.">
                          {(props) => (
                            <input
                              {...props}
                              type="text"
                              name="reason"
                              value={reason}
                              maxLength={500}
                              onChange={(event) => setReason(event.target.value)}
                              autoComplete="off"
                              className={controlClass(false)}
                            />
                          )}
                        </FieldBox>
                      </div>
                      <div className="mt-2 flex flex-col gap-2 hl:flex-row">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void send(
                              "/api/admin/apps/block",
                              { client_id: row.clientId, reason },
                              `Revoked ${row.name} for everyone.`,
                            )
                          }
                          className={DANGER}
                        >
                          Revoke app
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className={SECONDARY}
                        >
                          Keep allowed
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
      )}
      {error && confirming === null ? (
        <p role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      ) : null}
    </>
  );
}
