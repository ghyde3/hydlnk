"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { clampPageName, normalizePageName, PAGE_NAME_MAX } from "@/lib/pages/name";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** What the field says when the page could not be renamed and trying again may help. */
export const RENAME_FAILED_MESSAGE = "Couldn’t rename the page. Try again.";
/** The session is gone (a 401 from the database API): signing in again is the way out. */
export const RENAME_SIGNED_OUT_MESSAGE = "You’re signed out. Sign in again, then try again.";

/**
 * The page's name in the editor header (M6-14): the `<h1>` with a pencil "Rename page" button after
 * it. The button turns the title into a 16px text input labeled "Page name" (prefilled, selected)
 * with "Save" and "Cancel". Enter saves; Escape and "Cancel" restore the title and put focus back
 * on the pencil.
 *
 * Usage in the header: `<PageName pageId={pageId} name={name} />` where it used to render the title.
 * `name` is `pages.name` as the server read it; the component keeps what it just saved until a
 * refreshed `name` arrives.
 *
 * Saving is one PATCH to /rest/v1/pages?id=eq.{pageId} carrying only `{name}`, with the user's own
 * session and the publishable key, so RLS decides who may rename (the owner, while the account is
 * not suspended) and the `pages_name_format` check decides what a name may be. It is not part of the
 * page document: it never autosaves the draft, never changes `rev` or the publish status, and the
 * browser's own Ctrl+Z keeps working inside the field (the editor's undo does not own it).
 * A name that is empty or blank shows "Add a name." and sends nothing; a paste is cut at 60 code
 * points. After a save the route refreshes so the switcher, Settings and Domains show the new name.
 * Two tabs renaming one page: the last write wins and neither shows an error.
 */
export function PageName({ pageId, name }: { pageId: string; name: string }) {
  const router = useRouter();
  const suspended = useAccountSuspended();
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  const [shown, setShown] = useState(name);
  const [seen, setSeen] = useState(name);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refreshed name from the server (another tab renamed it, the page switched) replaces what is shown.
  if (name !== seen) {
    setSeen(name);
    setShown(name);
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      pencilRef.current?.focus();
    }
  }, [editing]);

  function startEditing() {
    if (suspended) return;
    setValue(shown);
    setError(null);
    setEditing(true);
  }

  function stopEditing() {
    restoreFocus.current = true;
    setError(null);
    setEditing(false);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (saving) return;
    const result = normalizePageName(value);
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const {
        data,
        error: failure,
        status,
      } = await createBrowserSupabase()
        .from("pages")
        .update({ name: result.name })
        .eq("id", pageId)
        .select("id");
      if (failure) {
        setError(status === 401 ? RENAME_SIGNED_OUT_MESSAGE : RENAME_FAILED_MESSAGE);
        return;
      }
      // No row changed: not this account's page, or the owner is suspended (RLS filtered it out).
      if (data.length === 0) {
        setError(RENAME_FAILED_MESSAGE);
        return;
      }
      setShown(result.name);
      stopEditing();
      router.refresh();
    } catch {
      // The request itself failed (offline, the connection dropped).
      setError(RENAME_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    // Only the rename field closes: nothing else listening for Escape (the preview tab) reacts.
    event.stopPropagation();
    stopEditing();
  }

  if (!editing) {
    return (
      <div className="mt-0.5 flex min-w-0 items-start gap-1">
        <h1
          data-page-name=""
          className="min-w-0 pt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em] [overflow-wrap:anywhere]"
        >
          {shown}
        </h1>
        <button
          ref={pencilRef}
          type="button"
          aria-label="Rename page"
          title={suspended ? SUSPENDED_REASON : undefined}
          disabled={suspended}
          onClick={startEditing}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-2 hover:bg-page disabled:cursor-not-allowed disabled:opacity-50 -my-2.5"
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      noValidate
      className="mt-1 flex min-w-0 flex-col gap-2 hl:flex-row hl:items-start"
    >
      <div className="flex min-w-0 flex-col gap-1 hl:w-[300px]">
        <label htmlFor={inputId} className="sr-only">
          Page name
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={value}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setValue(clampPageName(event.target.value));
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          data-max={PAGE_NAME_MAX}
          className={`min-h-11 w-full rounded-md border bg-surface px-3 text-base font-normal text-ink ${
            error ? "border-bad" : "border-line-3"
          }`}
        />
        {error ? (
          <span id={errorId} role="alert" className="text-[13px] text-bad">
            {error}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 hl:flex-row">
        <button
          type="submit"
          disabled={saving}
          aria-busy={saving || undefined}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-progress disabled:opacity-70"
        >
          Save
        </button>
        <button
          type="button"
          onClick={stopEditing}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14.5 7.5l3 3" />
    </svg>
  );
}
