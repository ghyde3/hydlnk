"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { postAdmin, type BlockResponse } from "@/lib/blocklist/admin-client";
import { fieldOfMessage } from "@/lib/blocklist/admin-domain";
import {
  draftsSentence,
  impactSentence,
  pageDetail,
  type ImpactPage,
} from "@/lib/blocklist/admin-impact";
import type { BlockedDomainRow } from "@/lib/blocklist/admin-view";
import { tenantOrigin } from "@/lib/publish/urls";
import { BlockedDomainsTable } from "./blocked-links-table";

/**
 * The /admin/blocked-links screen below its header (M7-13): the add form, the result of the last add
 * or remove, and the list. One client component, so the result and the focus after a remove survive
 * the refresh that brings the new list.
 *
 * Every string from the database or from the admin is React text: a reason of `<img onerror>` shows
 * as characters. The server checks the caller is an admin again on every POST (401 and 403 as HTTP
 * statuses), and answers each refusal with the sentence shown under the field it belongs to.
 */

const PRIMARY =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink";

type Status =
  { kind: "blocked"; result: BlockResponse } | { kind: "removed"; domain: string } | null;

type FieldErrors = { domain?: string; reason?: string; form?: string };

function FieldBox({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (props: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-text-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClass = (invalid: boolean) =>
  `min-h-11 w-full min-w-0 rounded-md border bg-surface px-3 text-base font-normal text-ink ${
    invalid ? "border-bad" : "border-line-3"
  }`;

function ImpactRow({ page }: { page: ImpactPage }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0 border-t border-track py-1 first:border-t-0">
      <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{page.handle}</span>
      <a
        href={`${tenantOrigin(page.handle)}/`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 min-w-11 items-center text-sm underline"
      >
        View page
      </a>
      <span className="min-w-0 font-mono text-xs text-text-2 [overflow-wrap:anywhere]">
        {pageDetail(page)}
      </span>
    </li>
  );
}

function StatusPanel({
  status,
  onDismiss,
}: {
  status: Exclude<Status, null>;
  onDismiss: () => void;
}) {
  if (status.kind === "removed") {
    return (
      <section
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4 hl:px-5"
      >
        <p className="text-[15px] [overflow-wrap:anywhere]">Removed {status.domain}.</p>
        <button type="button" onClick={onDismiss} className={SECONDARY}>
          Dismiss
        </button>
      </section>
    );
  }
  const { result } = status;
  const drafts = draftsSentence(result.drafts);
  return (
    <section role="status" className="rounded-md border border-line bg-surface p-4 hl:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-[15px] leading-relaxed [overflow-wrap:anywhere]">
          Blocked {result.domain}. {impactSentence(result.pages)} Nothing was unpublished.
        </p>
        <button type="button" onClick={onDismiss} className={SECONDARY}>
          Dismiss
        </button>
      </div>
      {result.list.length > 0 ? (
        <ul className="mt-2 flex flex-col">
          {result.list.map((page) => (
            <ImpactRow key={page.handle} page={page} />
          ))}
        </ul>
      ) : null}
      {result.pages > result.list.length && result.list.length > 0 ? (
        <p className="mt-2 text-sm text-text-2">
          Showing the first {result.list.length} of {result.pages}.
        </p>
      ) : null}
      {drafts ? <p className="mt-2 text-sm text-text-2">{drafts}</p> : null}
    </section>
  );
}

export function BlockedLinksManager({ rows }: { rows: BlockedDomainRow[] }) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const sending = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A double click (or Enter, then a click) is one request.
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setErrors({});
    const result = await postAdmin<BlockResponse>("/api/admin/blocked-links", { domain, reason });
    sending.current = false;
    setPending(false);
    if (!result.ok) {
      const field = fieldOfMessage(result.message);
      setErrors({ [field]: result.message });
      return;
    }
    setDomain("");
    setReason("");
    setStatus({ kind: "blocked", result: result.data });
    router.refresh();
  }

  return (
    <>
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-label="Block a domain"
        className="rounded-md border border-line bg-surface p-4 hl:p-5"
      >
        <div className="grid gap-3 hl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] hl:items-start">
          <FieldBox label="Domain" error={errors.domain}>
            {(props) => (
              <input
                {...props}
                type="text"
                name="domain"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="example.com"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                className={controlClass(Boolean(errors.domain))}
              />
            )}
          </FieldBox>
          <FieldBox label="Reason" error={errors.reason} hint="Up to 120 characters.">
            {(props) => (
              <input
                {...props}
                type="text"
                name="reason"
                value={reason}
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
            {pending ? "Blocking..." : "Block domain"}
          </button>
        </div>
        {errors.form ? (
          <p role="alert" className="mt-3 text-[13px] text-bad">
            {errors.form}
          </p>
        ) : null}
      </form>

      {status ? <StatusPanel status={status} onDismiss={() => setStatus(null)} /> : null}

      <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-base font-bold outline-none">
        Blocked domains
      </h2>
      <BlockedDomainsTable
        rows={rows}
        onRemoved={(removed) => {
          setStatus({ kind: "removed", domain: removed });
          headingRef.current?.focus();
          router.refresh();
        }}
      />
    </>
  );
}
