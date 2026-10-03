"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  FONT_CATALOG,
  FONT_CATEGORY_LABELS,
  allFontsStylesheetUrl,
  fontEntry,
  type FontEntry,
} from "@/lib/design";
import type { FontFamily } from "@/lib/theme";

/** `"Fraunces", serif`: a family from the allowlist, quoted, with its generic fallback. */
function stack(entry: FontEntry): string {
  return `"${entry.family}", ${entry.generic}`;
}

/**
 * A font picker (M3-09): a button showing the chosen family in its own typeface that opens a
 * listbox of exactly the allowlisted families, each name in its own typeface. There is no free-text
 * field: the only values it can produce are allowlisted names. Keyboard: Enter, Space or the arrow
 * keys open it; Up and Down (and Home and End) move; Enter or Space picks; Escape closes. Options
 * are 44px tall; the list scrolls inside its own box, so it never widens the page.
 *
 * The typefaces of the other families load only once a picker is opened (one stylesheet, regular
 * weights), so a visitor who never opens it fetches nothing extra.
 */
export function FontPicker({
  label,
  value,
  onPick,
}: {
  label: string;
  value: FontFamily;
  onPick: (family: FontFamily) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const current = fontEntry(value) ?? FONT_CATALOG[0]!;

  function openList(): void {
    setActive(Math.max(0, FONT_CATALOG.findIndex((entry) => entry.family === value)));
    setLoaded(true);
    setOpen(true);
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Focus follows the active option while the list is open.
  useEffect(() => {
    if (open) optionRefs.current[active]?.focus();
  }, [open, active]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openList();
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const last = FONT_CATALOG.length - 1;
    if (event.key === "ArrowDown") setActive((index) => Math.min(last, index + 1));
    else if (event.key === "ArrowUp") setActive((index) => Math.max(0, index - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Escape") {
      close(true);
    } else if (event.key === "Tab") {
      close(false);
      return;
    } else return;
    event.preventDefault();
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-font-picker={label}>
      <h3 className="m-0 text-sm font-semibold text-ink">{label}</h3>
      {loaded ? <link rel="stylesheet" href={allFontsStylesheetUrl()} /> : null}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current.family}`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKeyDown}
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md border border-line-3 bg-surface px-3 text-left"
      >
        <span
          data-picker-value=""
          style={{ fontFamily: stack(current) }}
          className="min-w-0 truncate text-base text-ink"
        >
          {current.family}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-text-2">
          {FONT_CATEGORY_LABELS[current.category]}
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={`size-4 fill-none stroke-current stroke-[1.8] ${open ? "rotate-180" : ""}`}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 10l5 5 5-5" />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKeyDown}
          className="flex max-h-[min(22rem,60dvh)] flex-col gap-0.5 overflow-y-auto overflow-x-hidden rounded-md border border-line-2 bg-track p-[3px]"
        >
          {FONT_CATALOG.map((entry, index) => {
            const selected = entry.family === value;
            return (
              <button
                key={entry.family}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={entry.family}
                tabIndex={index === active ? 0 : -1}
                onClick={() => {
                  onPick(entry.family);
                  close(true);
                }}
                className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-sm px-3 text-left ${
                  selected ? "bg-surface text-ink ring-1 ring-line-2" : "bg-transparent text-text-2"
                }`}
              >
                <span
                  aria-hidden="true"
                  style={{ fontFamily: stack(entry) }}
                  className="min-w-0 truncate text-base"
                >
                  {entry.family}
                </span>
                <span aria-hidden="true" className="shrink-0 text-xs text-text-2">
                  {FONT_CATEGORY_LABELS[entry.category]}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
