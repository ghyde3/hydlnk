"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { resolveTokens } from "@/lib/theme";
import type { ThemeRow } from "@/lib/themes";
import type { RenameResult } from "./use-theme-library";

/** Buttons under a saved theme's card: 44px tall, the way every editor control is. */
const ACTION_BUTTON =
  "inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-2 text-[13px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50";

/**
 * One theme in the saved-themes grid (M3-19): a button that applies it, with a 56px swatch (the
 * theme's background, a filled and an outlined accent bar), its name and, on the applied one only,
 * a tag. `aria-pressed` is the applied state. Saved themes (not system ones) also carry Rename and
 * Delete under the card, outside the apply button: a button never holds another button.
 *
 * Only validated colors reach the swatch's inline style: `theme.tokens` came through the token
 * schema, and `resolveTokens` fills the gaps from the system default.
 */
export function ThemeCard({
  theme,
  tag,
  onApply,
  onRename,
  onDelete,
}: {
  theme: ThemeRow;
  tag: "Applied" | "Edited" | null;
  onApply: () => void;
  onRename: (input: string) => Promise<RenameResult>;
  onDelete: (trigger: HTMLElement) => void;
}) {
  const tokens = resolveTokens(theme.tokens, {});
  const applied = tag !== null;
  const [renaming, setRenaming] = useState(false);
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const barRadius = `${Math.min(tokens.radius, 4)}px`;

  return (
    <li data-theme-id={theme.id} className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        aria-pressed={applied}
        onClick={onApply}
        data-testid="theme-card"
        className={`min-h-11 w-full min-w-0 cursor-pointer overflow-hidden rounded-md border bg-surface p-0 text-left text-ink ${
          applied ? "border-ink ring-1 ring-ink" : "border-line-2"
        }`}
      >
        <span
          aria-hidden="true"
          data-swatch=""
          className="flex h-14 flex-col justify-center gap-1.5 px-3"
          style={{ background: tokens.bg }}
        >
          <span
            className="block h-[7px] w-3/5"
            style={{ background: tokens.accent, borderRadius: barRadius }}
          />
          <span
            className="block h-[7px] w-4/5 box-border"
            style={{ border: `1px solid ${tokens.accent}`, borderRadius: barRadius }}
          />
        </span>
        <span className="flex justify-between gap-1.5 border-t border-line px-2.5 py-2 text-[13px] font-semibold">
          <span className="min-w-0 truncate" data-theme-name="">
            {theme.name}
          </span>
          {tag ? (
            <span data-theme-tag="" className="shrink-0 text-xs font-medium text-brass-text">
              {tag}
            </span>
          ) : null}
        </span>
      </button>

      {theme.system ? null : renaming ? (
        <RenameForm
          initial={theme.name}
          onSubmit={onRename}
          onDone={() => {
            setRenaming(false);
            // Back to the trigger once it is rendered again.
            setTimeout(() => renameTrigger.current?.focus(), 0);
          }}
        />
      ) : (
        <div className="flex gap-1.5">
          <button
            ref={renameTrigger}
            type="button"
            aria-label={`Rename ${theme.name}`}
            data-testid="theme-rename"
            onClick={() => setRenaming(true)}
            className={ACTION_BUTTON}
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Delete ${theme.name}`}
            data-testid="theme-delete"
            onClick={(event) => onDelete(event.currentTarget)}
            className={`${ACTION_BUTTON} text-bad`}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The inline rename (M3-23): a 16px input prefilled with the name. Enter saves, Escape cancels,
 * whitespace is trimmed, and an empty name says "Give the theme a name." Nothing is written until
 * the name checks out; the rule is `checkThemeName`, run again by the hook.
 */
function RenameForm({
  initial,
  onSubmit,
  onDone,
}: {
  initial: string;
  onSubmit: (input: string) => Promise<RenameResult>;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    input.current?.focus();
    input.current?.select();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    const result = await onSubmit(value);
    if (!mounted.current) return;
    setSaving(false);
    if (result.ok) onDone();
    else setError(result.message);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDone();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5">
      <input
        ref={input}
        type="text"
        value={value}
        aria-label="Theme name"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "theme-rename-error" : undefined}
        autoComplete="off"
        data-testid="theme-rename-input"
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        className={`min-h-11 w-full min-w-0 rounded-md border bg-surface px-3 text-base font-normal text-ink ${
          error ? "border-bad" : "border-line-3"
        }`}
      />
      {error ? (
        <p id="theme-rename-error" role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex gap-1.5">
        <button type="submit" disabled={saving} className={ACTION_BUTTON}>
          Save
        </button>
        <button type="button" onClick={onDone} className={ACTION_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}
