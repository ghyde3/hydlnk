"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { HexColorPicker } from "react-colorful";
import { normalizeHex } from "@/lib/design";

/**
 * The color picker of the Design screen's color rows and a block's color overrides (M9-07):
 * `react-colorful`'s `HexColorPicker` (six-digit hex, no alpha) in an inline panel under its row,
 * opened by a 44px swatch button. Client-side editor code only: public pages never import it, it
 * makes no request and keeps nothing in `localStorage`.
 *
 * The hex field next to the swatch stays the way to type a color; the picker is the way to drag one.
 */

/** The panel's colors in the form the picker needs: `#rrggbb`, lowercase, whatever the token holds. */
export function pickerValue(value: string | undefined, fallback = "#000000"): string {
  if (typeof value !== "string") return fallback.toLowerCase();
  const hex = normalizeHex(value) ?? (/^#[0-9a-fA-F]{8}$/.test(value) ? value.slice(0, 7) : null);
  return (hex ?? fallback).toLowerCase();
}

/**
 * What the picker's `onChange` may write: a complete six-digit hex, upper case, or null. The
 * library only ever sends `#rrggbb`, but nothing that is not a color reaches the draft whatever
 * calls this (NaN, Infinity, an object, a hostile string).
 */
export function pickedColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return null;
  return normalizeHex(value);
}

// Which picker is open: one at a time, across the Design screen's rows and the block forms --------

let openId: string | null = null;
const listeners = new Set<() => void>();
function setOpen(next: string | null): void {
  if (openId === next) return;
  openId = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * The open state of one picker panel. Opening one closes whichever other was open (choosing another
 * row's swatch closes this one), and a panel that goes away (its row collapsed, the screen left)
 * closes itself.
 */
export function useColorPanel(): {
  open: boolean;
  panelId: string;
  toggle: () => void;
  close: () => void;
} {
  const id = useId();
  const open = useSyncExternalStore(
    subscribe,
    () => openId === id,
    () => false,
  );
  useEffect(
    () => () => {
      if (openId === id) setOpen(null);
    },
    [id],
  );
  const toggle = useCallback(() => setOpen(openId === id ? null : id), [id]);
  const close = useCallback(() => {
    if (openId === id) setOpen(null);
  }, [id]);
  return { open, panelId: `color-panel-${id.replace(/:/g, "")}`, toggle, close };
}

/** The swatch: a 44px button that shows the color, named `<name> color`, with the open row's ring. */
export function ColorSwatchButton({
  name,
  label,
  color,
  open,
  panelId,
  onToggle,
  onEscape,
  buttonRef,
  className = "",
  ...data
}: {
  /** The plain name of what the color is (`Accent`). The accessible name is `<name> color`. */
  name: string;
  /** Overrides the accessible name when it is not `<name> color`. */
  label?: string;
  color: string;
  open: boolean;
  panelId: string;
  onToggle: () => void;
  onEscape: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  className?: string;
  "data-field"?: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label ?? `${name} color`}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          onEscape();
        }
      }}
      style={{
        background: color,
        // The checked-state ring of the accent swatches: surface, then ink.
        boxShadow: open ? "0 0 0 2px var(--hl-surface), 0 0 0 4px var(--hl-ink)" : undefined,
      }}
      className={`block size-11 shrink-0 cursor-pointer rounded-md border border-line-2 p-0 ${className}`}
      {...data}
    />
  );
}

/**
 * The library draws a 200px square with a 24px strip and 28px thumbs, and takes away its own focus
 * outline. Its stylesheet is injected unlayered, so Tailwind's layered utilities cannot win (and an
 * underscore in an arbitrary variant is a space, which `react-colorful__hue` is full of): these rules
 * have two classes against its one, and the panel carries them.
 */
const PICKER_CSS = `
.hl-color-picker.react-colorful { width: 100%; height: 248px; }
.hl-color-picker .react-colorful__hue { height: 44px; }
.hl-color-picker .react-colorful__hue-pointer { width: 44px; height: 44px; }
.hl-color-picker .react-colorful__interactive:focus-visible { outline: var(--hl-focus-width) solid var(--hl-brass); outline-offset: var(--hl-focus-offset); }
`;

const DONE =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink";

/**
 * The inline panel (not a modal and not a popover): the picker as wide as its row, a square at least
 * 160px tall, a hue strip and its thumb 44px tall (the library's own are 24px and 28px, raised
 * here), and a 44px "Done". Escape closes it and puts focus back on the swatch. Dragging writes the
 * draft as it moves (`onPick`, always `#RRGGBB`, upper case); the undo history merges the writes of
 * one drag into one step.
 */
export function ColorPanel({
  id,
  name,
  value,
  onPick,
  onDone,
}: {
  id: string;
  name: string;
  /** The color the picker shows: any stored form; the picker shows its six-digit equivalent. */
  value: string;
  onPick: (hex: string) => void;
  /** "Done" or Escape: close the panel and put focus on the swatch. */
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const shown = pickerValue(value);

  // The library names the hue strip but gives it no `aria-valuetext`: say it in degrees.
  useEffect(() => {
    const hue = root.current?.querySelector<HTMLElement>(
      ".react-colorful__hue .react-colorful__interactive",
    );
    const now = hue?.getAttribute("aria-valuenow");
    if (hue && now !== null && now !== undefined) hue.setAttribute("aria-valuetext", `${now} degrees`);
  }, [shown]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onDone();
  }

  return (
    <div
      ref={root}
      id={id}
      role="group"
      aria-label={`${name} color picker`}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-md border border-line bg-page p-3"
    >
      <style>{PICKER_CSS}</style>
      <HexColorPicker
        color={shown}
        onChange={(next) => {
          const hex = pickedColor(next);
          if (hex !== null) onPick(hex);
        }}
        className="hl-color-picker"
      />
      <div>
        <button type="button" onClick={onDone} className={`${DONE} w-full hl:w-auto`}>
          Done
        </button>
      </div>
    </div>
  );
}
