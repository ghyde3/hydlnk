"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  HONEYPOT_FIELD,
  REPORT_LIMITS,
  REPORT_MESSAGES,
  REPORT_REASONS,
  REPORT_SUBMIT_PATH,
  type ReportField,
} from "@/lib/reports/constants";

type Errors = Partial<Record<ReportField, string>>;

const FIELD =
  "min-h-12 w-full rounded-md border border-line-3 bg-surface px-3 text-base text-ink placeholder:text-text-3 aria-[invalid=true]:border-bad";
const LABEL = "text-sm font-semibold";
const ERROR = "text-[13px] text-bad";
const BUTTON =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-[15px] font-semibold text-surface disabled:cursor-default disabled:opacity-70";

/** One labeled field with its inline error and hint, wired for assistive technology. */
function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  children: (props: {
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children({ "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint ? (
        <p id={hintId} className="text-[13px] text-text-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={ERROR}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Report a page" (M5-05): the form behind the public page footer's "Report this page" link and the
 * marketing footer's "Report a page". With a `page` the address is shown read-only (the server read
 * it from the id in the link) and the id travels in a hidden field; without one the visitor types
 * the address. The submit goes to POST /report/submit as JSON; the answer is shown in place. A
 * hidden field (`company_url`) is the honeypot: real visitors never see or fill it.
 */
export function ReportForm({
  page,
  initialAddressError = null,
}: {
  page: { id: string; address: string } | null;
  initialAddressError?: string | null;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<Errors>(
    initialAddressError ? { address: initialAddressError } : {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Tests (and a slow connection) wait for this flag so nothing is pressed before the submit handler exists.
  useEffect(() => {
    formRef.current?.setAttribute("data-ready", "true");
  }, []);

  const id = (name: string) => `${uid}-${name}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    setSending(true);
    setErrors({});
    setFormError(null);
    try {
      const response = await fetch(REPORT_SUBMIT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page: text("page"),
          address: text("address"),
          reason: text("reason"),
          details: text("details"),
          email: text("email"),
          [HONEYPOT_FIELD]: text(HONEYPOT_FIELD),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        errors?: Errors;
      } | null;
      if (response.ok && body?.ok) {
        setSent(true);
        return;
      }
      if (body?.errors && Object.keys(body.errors).length > 0) {
        setErrors(body.errors);
        const first = (["address", "page", "reason", "details", "email"] as const).find(
          (key) => body.errors?.[key],
        );
        if (first)
          requestAnimationFrame(() =>
            document.getElementById(id(first === "page" ? "address" : first))?.focus(),
          );
        return;
      }
      setFormError(
        response.status === 429
          ? REPORT_MESSAGES.tooMany
          : (body?.message ?? REPORT_MESSAGES.server),
      );
    } catch {
      setFormError(REPORT_MESSAGES.server);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div role="status" data-report-sent="">
        <h2 className="text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">
          {REPORT_MESSAGES.sent}
        </h2>
        <p className="mt-2 text-[15px] leading-normal text-text-2">
          Thank you. We only act on what we can check, and we may not reply.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 items-center rounded-md border border-line-3 px-4 text-[15px] font-semibold text-ink"
        >
          Back to HYDLNK
        </Link>
      </div>
    );
  }

  const needsDetails = reason === "other";
  const addressError = errors.address ?? errors.page ?? null;

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      method="post"
      action={REPORT_SUBMIT_PATH}
      className="flex flex-col gap-5"
    >
      {page ? (
        <>
          <input type="hidden" name="page" value={page.id} />
          <Field
            id={id("address")}
            label="Page address"
            hint="Not this page? Open the report form again from the page you mean."
          >
            {(aria) => (
              <input
                {...aria}
                id={id("address")}
                name="address-display"
                type="text"
                readOnly
                value={page.address}
                className={`${FIELD} bg-page font-mono`}
              />
            )}
          </Field>
        </>
      ) : (
        <Field
          id={id("address")}
          label="Page address"
          error={addressError}
          hint="For example name.hydlnk.com, or the custom domain the page uses."
        >
          {(aria) => (
            <input
              {...aria}
              id={id("address")}
              name="address"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="name.hydlnk.com"
              defaultValue=""
              className={`${FIELD} font-mono`}
            />
          )}
        </Field>
      )}

      <Field id={id("reason")} label="Reason" error={errors.reason}>
        {(aria) => (
          <select
            {...aria}
            id={id("reason")}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD}
          >
            <option value="">Choose a reason</option>
            {REPORT_REASONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        id={id("details")}
        label={needsDetails ? "Details (required)" : "Details (optional)"}
        error={errors.details}
        hint={`${Array.from(details).length} of ${REPORT_LIMITS.details} characters`}
      >
        {(aria) => (
          <textarea
            {...aria}
            id={id("details")}
            name="details"
            rows={5}
            maxLength={REPORT_LIMITS.details}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="What is wrong with this page?"
            className={`${FIELD} resize-y py-3`}
          />
        )}
      </Field>

      <Field
        id={id("email")}
        label="Your email (optional)"
        error={errors.email}
        hint="Only if you want us to be able to follow up. We don’t tell the page’s owner who reported it."
      >
        {(aria) => (
          <input
            {...aria}
            id={id("email")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            className={FIELD}
          />
        )}
      </Field>

      {/* The honeypot: off screen, out of the tab order and hidden from assistive technology. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}
      >
        <label>
          Leave this field empty
          <input
            type="text"
            name={HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
            style={{ width: 1, height: 1, padding: 0, border: 0 }}
          />
        </label>
      </div>

      <button type="submit" disabled={sending} className={BUTTON}>
        {sending ? "Sending…" : "Send report"}
      </button>
      {formError ? (
        <p role="alert" className="-mt-2 text-[13px] text-bad">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
