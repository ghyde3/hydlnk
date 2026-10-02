"use client";

import type { ReactNode } from "react";
import { codePointLength, singleLine, truncateToCodePoints } from "@/lib/document";
import { Field, controlClass } from "./field";

/**
 * Control characters other than the line break: a text block keeps its newlines, but nothing
 * else below U+0020 (and nothing in U+007F to U+009F) belongs in a document.
 */
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** What a multi-line field stores: `\n` line breaks, no other control characters, at most `max` code points. */
export function clampMultiline(value: string, max: number): string {
  const unified = value.replace(/\r\n?/g, "\n").replace(CONTROL_EXCEPT_NEWLINE, "");
  return truncateToCodePoints(unified, max);
}

/** What a one-line field stores: line breaks and control characters become spaces, then at most `max` code points. */
export function clampSingleLine(value: string, max: number): string {
  return truncateToCodePoints(singleLine(value), max);
}

/**
 * A single-line text input that stores exactly what is typed (never trimmed: the schemas trim on
 * parse), collapsed to one line and cut to `max` code points, so a long paste is shortened rather
 * than refused and the draft always autosaves.
 */
export function TextField({
  label,
  value,
  onChange,
  max,
  error,
  hint,
  field,
  autoComplete = "off",
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  max: number;
  error?: string | null;
  hint?: ReactNode;
  /** Stable name for the input (`data-field`), so tests and the editor's focus handling can find it. */
  field: string;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(control) => (
        <input
          {...control}
          type="text"
          value={value}
          data-field={field}
          autoComplete={autoComplete}
          onChange={(event) => onChange(clampSingleLine(event.target.value, max))}
          className={controlClass(error != null && error !== "")}
        />
      )}
    </Field>
  );
}

/** A textarea that keeps line breaks, with a "{n} / {max}" counter in code points. */
export function TextAreaField({
  label,
  value,
  onChange,
  max,
  error,
  field,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  max: number;
  error?: string | null;
  field: string;
  rows?: number;
}) {
  return (
    <Field
      label={label}
      error={error}
      suffix={
        <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
          {codePointLength(value)} / {max}
        </span>
      }
    >
      {(control) => (
        <textarea
          {...control}
          value={value}
          rows={rows}
          data-field={field}
          onChange={(event) => onChange(clampMultiline(event.target.value, max))}
          className={`${controlClass(error != null && error !== "", "py-2.5 leading-normal")} resize-y`}
        />
      )}
    </Field>
  );
}
