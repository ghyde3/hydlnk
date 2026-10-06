"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY = `${BUTTON} border-line-3 bg-surface text-ink`;
const DANGER = `${BUTTON} border-bad-line bg-surface text-bad`;

const FAILED = "That didn’t work. Try again.";
const SIGNED_OUT = "You’re signed out. Sign in again.";

/** POST to an admin route with the session cookie. Resolves with an error sentence, or null. */
async function post(path: string): Promise<string | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (response.ok) return null;
    if (response.status === 401) return SIGNED_OUT;
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    return typeof body?.message === "string" ? body.message : FAILED;
  } catch {
    return FAILED;
  }
}

/** Runs one admin POST and refreshes the screen. The error sentence shows under the button. */
function useAdminPost(path: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setError(null);
    const failure = await post(path);
    setPending(false);
    if (failure) {
      setError(failure);
      return false;
    }
    router.refresh();
    return true;
  }
  return { run, pending, error, setError };
}

/** "Dismiss" for a report row: sets it dismissed. Idempotent on the server, so a double click is fine. */
export function DismissReportButton({ reportId }: { reportId: string }) {
  const { run, pending, error } = useAdminPost(
    `/api/admin/reports/${encodeURIComponent(reportId)}/dismiss`,
  );
  return (
    <div className="flex flex-col gap-1">
      <button type="button" disabled={pending} onClick={() => void run()} className={SECONDARY}>
        {pending ? "Dismissing..." : "Dismiss"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Unsuspend" for a suspended account: no confirm, it only brings pages back. */
export function UnsuspendButton({ accountId, handle }: { accountId: string; handle: string }) {
  const { run, pending, error } = useAdminPost(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/unsuspend`,
  );
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        aria-label={`Unsuspend ${handle}`}
        className={SECONDARY}
      >
        {pending ? "Unsuspending..." : "Unsuspend"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Suspend account" / "Suspend owner": a danger button that opens a confirm (a native <dialog>
 * shown with showModal(), so focus is trapped and Escape closes it) reading "Suspend {handle}? All
 * {n} of its pages stop serving right away." Confirming POSTs the suspend route; the server checks
 * the caller is an admin again and refuses to suspend an admin ("Admins can’t be suspended.").
 */
export function SuspendAccountButton({
  accountId,
  handle,
  pageCount,
  label = "Suspend account",
}: {
  accountId: string;
  handle: string;
  pageCount: number;
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const { run, pending, error, setError } = useAdminPost(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/suspend`,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label} ${handle}`}
        onClick={() => dialogRef.current?.showModal()}
        className={DANGER}
      >
        {label}
      </button>
      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        onClose={() => {
          setError(null);
          triggerRef.current?.focus();
        }}
        className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[440px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:p-5"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run().then((done) => {
              if (done) dialogRef.current?.close();
            });
          }}
          className="flex flex-col gap-4"
        >
          <h2 id={titleId} className="text-base font-bold [overflow-wrap:anywhere]">
            Suspend {handle}? All {pageCount} of its pages stop serving right away.
          </h2>
          <p className="text-sm leading-relaxed text-text-2">
            The owner can still sign in, but can’t publish or change anything until you unsuspend
            the account.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 hl:flex-row hl:justify-end">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={`${SECONDARY} w-full hl:w-auto`}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className={`${DANGER} w-full hl:w-auto`}>
              {pending ? "Suspending..." : "Suspend account"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
