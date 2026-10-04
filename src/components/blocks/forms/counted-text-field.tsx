"use client";

import type { ReactNode } from "react";
import { codePointLength } from "@/lib/document";
import { Field, controlClass } from "../field";
import { clampSingleLine } from "../text-field";

/**
 * A single-line text input with a "{n} / {max}" counter in code points, like the multi-line field's
 * (M9-20, M9-22). It stores exactly what is typed, collapsed to one line and cut to `max` code
 * points, so a long paste is shortened rather than refused and the draft always autosaves. The
 * counter is decorative (`aria-hidden`): the limit is also what the field refuses to exceed.
 */
export function CountedTextField({
  label,
  value,
  onChange,
  max,
  error,
  hint,
  field,
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  max: number;
  error?: string | null;
  hint?: ReactNode;
  /** Stable name for the input (`data-field`). */
  field: string;
  className?: string;
}) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      className={className}
      suffix={
        <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
          {codePointLength(value)} / {max}
        </span>
      }
    >
      {(control) => (
        <input
          {...control}
          type="text"
          value={value}
          data-field={field}
          autoComplete="off"
          onChange={(event) => onChange(clampSingleLine(event.target.value, max))}
          className={controlClass(error != null && error !== "")}
        />
      )}
    </Field>
  );
}
