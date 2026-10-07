"use client";

import { useId, type ReactNode } from "react";

/**
 * Form pieces shared by the Wave N admin screens (reserved handles, announcement, apps): a labeled
 * field with a hint and an error under it, and the button and control classes (44px minimum, 16px
 * text, DESIGN.md). Every value shown is React text.
 */

export const PRIMARY =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50";
export const SECONDARY =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50";
export const DANGER =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-bad-line bg-surface px-4 text-sm font-semibold text-bad disabled:cursor-not-allowed disabled:opacity-50";

export const controlClass = (invalid: boolean) =>
  `min-h-11 w-full min-w-0 rounded-md border bg-surface px-3 text-base font-normal text-ink ${
    invalid ? "border-bad" : "border-line-3"
  }`;

export function FieldBox({
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

export const TH =
  "px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-text-2 uppercase";
export const TD = "block px-4 py-1 hl:table-cell hl:px-4 hl:py-3 hl:align-middle";
export const LABEL = "mr-2 font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase hl:hidden";
