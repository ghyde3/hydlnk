"use client";

import { useEffect, useState, type ReactNode } from "react";

const BASE =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:cursor-default disabled:opacity-70";
const VARIANTS = {
  primary: "border border-ink bg-ink text-surface",
  secondary: "border border-line-3 bg-surface text-ink",
} as const;

export type BillingButtonVariant = keyof typeof VARIANTS;

/**
 * A plain HTML form that POSTs to one of the billing endpoints and lets the browser follow the
 * 303 to Stripe. It works without JavaScript; the script only disables the button once the form
 * is submitted (and re-enables it when the page comes back from Stripe through the back button),
 * so a double tap cannot start two sessions. The fields are fixed by the caller: the endpoints
 * accept nothing from the page but the plan and interval, or the portal intent.
 */
export function BillingFormButton({
  action,
  fields,
  children,
  variant = "primary",
  className = "",
  pendingLabel,
}: {
  action: string;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: BillingButtonVariant;
  /** Extra classes (width, for instance); the 44px height and the colours come from `variant`. */
  className?: string;
  /** Shown while the request is in flight; the label stays when omitted. */
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <form
      method="post"
      action={action}
      className="contents"
      onSubmit={() => {
        // After the submit has gone out: disabling inside the handler would race the submission.
        setTimeout(() => setPending(true), 0);
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className={`${BASE} ${VARIANTS[variant]} ${className}`}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
    </form>
  );
}

/**
 * The stand-in for a billing button that cannot be used right now: the same 44px box, disabled,
 * and no form, so there is nothing to submit. `reason` is what `data-unavailable` carries
 * ("closed" while paid plans are not open yet, "pending" while an upgrade is being confirmed).
 */
export function UnavailableBillingButton({
  children,
  reason,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  reason: string;
  variant?: BillingButtonVariant;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      data-unavailable={reason}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
