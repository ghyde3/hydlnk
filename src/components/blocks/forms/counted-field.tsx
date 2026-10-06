"use client";

import type { HTMLInputTypeAttribute, ReactNode } from "react";
import { codePointLength } from "@/lib/document";
import { Field, controlClass } from "../field";
import { clampSingleLine } from "../text-field";

/**
 * A one-line input with a "{n} / {max}" counter in code points, for the FAQ, contact and discount
 * forms (M9-16, M9-17, M9-19). It stores what is typed (collapsed to one line and cut to `max`, never
 * trimmed: the schemas trim on parse), so the draft always autosaves.
 *
 * `invalidWhen` is the field's own rule, shown as the person types (the draft saves anyway); `error`
 * is the Publish gate's message, which the editor clears the moment the draft passes the gate again
 * (`reconcileErrors`). Editor UI: HYDLNK tokens only, 16px text and at least 44px tall.
 */
export function CountedField({
  label,
  value,
  onChange,
  max,
  field,
  error,
  invalidWhen,
  type = "text",
  inputMode,
  mono = false,
  placeholder,
  hint,
  autoComplete = "off",
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  max: number;
  /** Stable name for the input (`data-field`). */
  field: string;
  error?: string | null;
  /** The message for a value that is not acceptable yet, or null when it is. */
  invalidWhen?: (value: string) => string | null;
  type?: HTMLInputTypeAttribute;
  inputMode?: "text" | "tel" | "email" | "url";
  mono?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  autoComplete?: string;
  className?: string;
}) {
  const local = invalidWhen ? invalidWhen(value) : null;
  const shown = local ?? (error ? error : null);
  return (
    <Field
      label={label}
      error={shown}
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
          type={type}
          {...(inputMode ? { inputMode } : {})}
          value={value}
          data-field={field}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...(placeholder ? { placeholder } : {})}
          onChange={(event) => onChange(clampSingleLine(event.target.value, max))}
          onBlur={() => {
            if (value !== value.trim()) onChange(value.trim());
          }}
          className={controlClass(shown !== null, mono ? "font-mono" : "")}
        />
      )}
    </Field>
  );
}
