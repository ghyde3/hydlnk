"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { postAdmin } from "@/lib/blocklist/admin-client";
import { formatAddedDate } from "@/lib/blocklist/admin-view";
import { reservedAddedBy, type ReservedRow } from "@/lib/admin/reserved-view";
import { DANGER, FieldBox, LABEL, PRIMARY, SECONDARY, TD, TH, controlClass } from "./fields";

/**
 * The /admin/reserved screen below its header (M13-08): the add form, the result of the last add or
 * remove, and the list. Adding a handle somebody already holds says whose it is and that nothing
 * changed for them; platform names (kind system) show Locked and have no Remove. Every string is React
 * text, and the server checks the caller is an admin on every POST.
 */

type Holder = { pageId: string; email: string | null } | null;
type Status =
  { kind: "added"; handle: string; holder: Holder } | { kind: "removed"; handle: string } | null;

export function ReservedManager({ rows }: { rows: ReservedRow[] }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ handle?: string; reason?: string }>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const sending = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setErrors({});
    const result = await postAdmin<{ handle: string; holder: Holder }>("/api/admin/reserved", {
      handle,
      reason,
    });
    sending.current = false;
    setPending(false);
    if (!result.ok) {
      setErrors({ [/reason/i.test(result.message) ? "reason" : "handle"]: result.message });
      return;
    }
    setHandle("");
    setReason("");
    setStatus({ kind: "added", handle: result.data.handle, holder: result.data.holder });
    router.refresh();
  }

  async function remove(target: string) {
    if (sending.current) return;
    sending.current = true;
    setRemoving(true);
    setRemoveError(null);
    const result = await postAdmin(`/api/admin/reserved/${encodeURIComponent(target)}/remove`, {});
    sending.current = false;
    setRemoving(false);
    if (!result.ok) {
      setRemoveError(result.message);
      return;
    }
    setConfirming(null);
    setStatus({ kind: "removed", handle: target });
    headingRef.current?.focus();
    router.refresh();
  }

  return (
    <>
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-label="Reserve a handle"
        className="rounded-md border border-line bg-surface p-4 hl:p-5"
      >
        <div className="grid gap-3 hl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] hl:items-start">
          <FieldBox label="Handle" error={errors.handle}>
            {(props) => (
              <input
                {...props}
                type="text"
                name="handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="brandname"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={controlClass(Boolean(errors.handle))}
              />
            )}
          </FieldBox>
          <FieldBox label="Reason" error={errors.reason} hint="Up to 200 characters.">
            {(props) => (
              <input
                {...props}
                type="text"
                name="reason"
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
                autoComplete="off"
                className={controlClass(Boolean(errors.reason))}
              />
            )}
          </FieldBox>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={`${PRIMARY} w-full hl:mt-[26px] hl:w-auto`}
          >
            {pending ? "Reserving..." : "Reserve handle"}
          </button>
        </div>
      </form>

      {status ? (
        <section
          role="status"
          data-reserved-status={status.kind}
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-surface p-4 hl:px-5"
        >
          <p className="min-w-0 flex-1 text-[15px] leading-relaxed [overflow-wrap:anywhere]">
            {status.kind === "removed"
              ? `Removed ${status.handle}. People can claim it again.`
              : status.holder
                ? `Reserved ${status.handle}. It is already in use${
                    status.holder.email ? ` by ${status.holder.email}` : ""
                  }, and nothing changes for them. Only new claims are stopped.`
                : `Reserved ${status.handle}. Nobody can claim it now.`}
          </p>
          <button type="button" onClick={() => setStatus(null)} className={SECONDARY}>
            Dismiss
          </button>
        </section>
      ) : null}

      <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-base font-bold outline-none">
        Reserved handles
      </h2>
      {rows.length === 0 ? (
        <section className="rounded-md border border-line bg-surface p-4 hl:p-5">
          <p className="text-[15px] leading-relaxed text-text-2">No reserved handles match.</p>
        </section>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <table className="block w-full border-collapse text-sm hl:table">
            <thead className="hidden bg-page hl:table-header-group">
              <tr>
                <th scope="col" className={TH}>
                  Handle
                </th>
                <th scope="col" className={TH}>
                  Reason
                </th>
                <th scope="col" className={TH}>
                  Kind
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
              {rows.flatMap((row) => {
                const open = confirming === row.handle;
                const main = (
                  <tr
                    key={row.handle}
                    data-handle={row.handle}
                    data-kind={row.kind}
                    className="block border-b border-track py-3 last:border-b-0 hl:table-row hl:py-0"
                  >
                    <td className={`${TD} font-mono text-[13px] [overflow-wrap:anywhere]`}>
                      <span className={LABEL}>Handle</span>
                      {row.handle}
                      {row.held ? (
                        <span className="ml-2 rounded-sm bg-track px-2 text-xs font-semibold text-text-2">
                          In use
                        </span>
                      ) : null}
                    </td>
                    <td className={`${TD} [overflow-wrap:anywhere]`}>
                      <span className={LABEL}>Reason</span>
                      {row.reason ?? "—"}
                    </td>
                    <td className={TD}>
                      <span className={LABEL}>Kind</span>
                      {row.kind === "system" ? "Platform name" : "Added"}
                    </td>
                    <td className={`${TD} font-mono text-[13px] hl:whitespace-nowrap`}>
                      <span className={LABEL}>Added</span>
                      {row.kind === "admin" ? `${formatAddedDate(row.createdAt)} · ` : ""}
                      <span data-added-by="" className="[overflow-wrap:anywhere]">
                        {reservedAddedBy(row)}
                      </span>
                    </td>
                    <td className={TD}>
                      <div className="mt-1 hl:mt-0">
                        {row.kind === "system" ? (
                          <span
                            data-locked
                            className="inline-flex min-h-11 items-center text-sm font-semibold text-text-2"
                          >
                            Locked
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Remove ${row.handle}`}
                            aria-expanded={open}
                            onClick={() => {
                              setRemoveError(null);
                              setConfirming(open ? null : row.handle);
                            }}
                            className={SECONDARY}
                          >
                            Remove
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
                    key={`${row.handle}-confirm`}
                    data-confirm-for={row.handle}
                    className="block border-b border-track bg-page last:border-b-0 hl:table-row"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setConfirming(null);
                    }}
                  >
                    <td colSpan={5} className="block px-4 py-3 hl:table-cell">
                      <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                        Remove {row.handle}? People can claim it again.
                      </p>
                      <div className="mt-2 flex flex-col gap-2 hl:flex-row">
                        <button
                          type="button"
                          disabled={removing}
                          onClick={() => void remove(row.handle)}
                          className={DANGER}
                        >
                          Remove reservation
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className={SECONDARY}
                        >
                          Keep reserved
                        </button>
                      </div>
                      {removeError ? (
                        <p role="alert" className="mt-2 text-[13px] text-bad">
                          {removeError}
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
    </>
  );
}
