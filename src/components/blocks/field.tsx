"use client";

import { useId, type ReactNode } from "react";

/**
 * Field chrome shared by every block form: a 13px label, the control, an optional hint and an
 * inline error. Editor UI, so it uses the HYDLNK tokens (Tailwind), never `--t-*`.
 *
 * The control gets its `id`, `aria-invalid` and `aria-describedby` from the render prop, so an
 * error is always tied to the input it is about. The error sits in a polite live region that is
 * present from the start, so it is announced when it appears.
 */
export interface FieldControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

export function Field({
  label,
  hint,
  error,
  suffix,
  className = "",
  children,
}: {
  label: string;
  /** Help text under the control. */
  hint?: ReactNode;
  /** The message to show, or null/undefined for none. */
  error?: string | null;
  /** Right of the label, for example a character counter. */
  suffix?: ReactNode;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
          {label}
        </label>
        {suffix}
      </div>
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
      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p id={errorId} className="text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Border and text classes for a 44px form control; red border when it holds an error. */
export function controlClass(invalid: boolean, extra = ""): string {
  return `min-h-11 w-full min-w-0 rounded-md border bg-surface px-3 text-base font-normal text-ink ${
    invalid ? "border-bad" : "border-line-3"
  } ${extra}`.trim();
}

/** The 44px bordered button used for the move, remove and add controls inside a form. */
export const FORM_BUTTON =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-3 text-[13px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50";

export const FORM_BUTTON_DANGER =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-bad-line bg-surface px-3 text-[13px] font-medium text-bad disabled:cursor-not-allowed disabled:opacity-50";
