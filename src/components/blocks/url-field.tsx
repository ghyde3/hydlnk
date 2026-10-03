"use client";

import { useState, type ReactNode } from "react";
import { BLOCKED_FIELD_MESSAGE } from "@/lib/blocklist/messages";
import {
  LIMITS,
  URL_ERROR_MESSAGE,
  embedErrorMessage,
  isHttpUrl,
  normalizeUrl,
  parseEmbed,
} from "@/lib/document";
import { Field, controlClass } from "./field";

/**
 * The shared URL input of the link, card, image, embed, social and grid forms (M2-15).
 *
 *   - A phone keyboard for web addresses (`type="url"`, `inputMode="url"`, no auto-capitalize, no
 *     spell check), Geist Mono at 16px so iOS does not zoom, at least 44px tall, placeholder "https://".
 *   - On blur a bare address becomes an https URL (`maraokafor.com/x` -> `https://maraokafor.com/x`).
 *     Anything with another scheme is kept as typed: an unsafe address is never made to look valid.
 *   - A value that is not a valid address keeps its place in the draft (so the draft still
 *     autosaves) and shows "Enter a full web address, like https://example.com." with
 *     `aria-invalid` and `aria-describedby`. The error appears after the first blur and then follows
 *     every keystroke. An empty field shows no error of its own; Publish names it.
 *   - `error` carries the Publish gate's message for this field. It shows until the value being
 *     edited validates, even if the parent has not re-run its check yet. The one exception is the
 *     blocked-site message (M5-03): a well-formed address is exactly what that is about, so it
 *     shows for as long as the parent passes it (the parent clears it when the address changes).
 *
 * It never trims, rewrites or validates on the fly while typing: the value in the draft is exactly
 * what was typed, apart from the blur normalization above.
 */
export function UrlField({
  label = "Link",
  value,
  onChange,
  error,
  kind = "web",
  optional = false,
  hint,
  field = "url",
  className,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  /** The Publish gate's message for this field, if it has one. */
  error?: string | null;
  /** `embed` accepts only links from the eight embed providers and says so in its message. */
  kind?: "web" | "embed";
  /** An empty value is fine (the image block's optional link). */
  optional?: boolean;
  hint?: ReactNode;
  /** Stable name for the input (`data-field`). */
  field?: string;
  className?: string;
}) {
  const [touched, setTouched] = useState(false);
  const [edited, setEdited] = useState(false);

  const trimmed = value.trim();
  // An embed link that does not parse says which providers work, or, for a short link, to open it first.
  const message = kind === "embed" ? embedErrorMessage(trimmed) : URL_ERROR_MESSAGE;
  const valid =
    trimmed === ""
      ? optional
      : kind === "embed"
        ? parseEmbed(trimmed) !== null
        : isHttpUrl(trimmed);

  // Local rule: a non-empty value that is not valid, once the field has been left.
  const localError = touched && trimmed !== "" && !valid ? message : null;
  // Publish's message stays until this field is edited into a valid value.
  const blocked = error === BLOCKED_FIELD_MESSAGE;
  const shown = localError ?? (error && (blocked || !(edited && valid)) ? error : null);

  return (
    <Field label={label} error={shown} hint={hint} className={className}>
      {(control) => (
        <input
          {...control}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          value={value}
          data-field={field}
          onChange={(event) => {
            setEdited(true);
            onChange(event.target.value.slice(0, LIMITS.draftUrl));
          }}
          onBlur={() => {
            setTouched(true);
            const next = normalizeUrl(value);
            if (next !== value) onChange(next);
          }}
          className={controlClass(shown !== null, "font-mono")}
        />
      )}
    </Field>
  );
}
