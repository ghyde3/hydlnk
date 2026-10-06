"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { HANDLE_MAX_LENGTH, normalizeHandle } from "@/lib/handles/rules";
import { ADDRESS_SUFFIX, PLACEHOLDER_HANDLE, type SpecimenFace } from "./address";

/*
 * The visitor's handle, mirrored from the claim fields. Every ClaimForm input carries
 * data-claim-handle, and its native input events bubble to the document, so the claim form itself
 * stays exactly as it is: this only listens. The value is normalized with the same rule sign-up
 * uses, so the specimen shows the address the visitor will really get.
 *
 * It also keeps the claim fields in step: what the visitor types in one (the hero's) is written
 * into the others (the close's), so the field they submit at the end already holds their handle.
 */

const FIELDS = "input[data-claim-handle]";
const listeners = new Set<() => void>();
let current = "";

function clean(raw: string): string {
  return normalizeHandle(raw).slice(0, HANDLE_MAX_LENGTH);
}

function set(next: string) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

let mirroring = false;

/**
 * Writes one field's text into the other claim fields. ClaimForm's inputs are React-managed, so
 * the value goes through the native setter and a bubbling input event, which React reads as a
 * change (its hint and width follow). A field the visitor is typing in is never overwritten.
 */
function mirror(from: HTMLInputElement) {
  if (mirroring) return;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setValue) return;
  mirroring = true;
  try {
    for (const field of document.querySelectorAll<HTMLInputElement>(FIELDS)) {
      if (field === from || field === document.activeElement || field.value === from.value) {
        continue;
      }
      setValue.call(field, from.value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } finally {
    mirroring = false;
  }
}

function onInput(event: Event) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement) || !field.matches(FIELDS)) return;
  set(clean(field.value));
  mirror(field);
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener("input", onInput);
    // A value the browser restored (back navigation, autofill) fires no input event.
    const restored = [...document.querySelectorAll<HTMLInputElement>(FIELDS)].find(
      (field) => field.value.trim() !== "",
    );
    if (restored) {
      queueMicrotask(() => {
        set(clean(restored.value));
        mirror(restored);
      });
    }
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener("input", onInput);
  };
}

/** The normalized handle typed so far, or "" (also on the server and without JavaScript). */
function useLiveHandle(): string {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "",
  );
}

/** The handle as text, "you" until something is typed. */
export function LiveHandle() {
  return <>{useLiveHandle() || PLACEHOLDER_HANDLE}</>;
}

/**
 * Fine-tunes each copy's size once its face has loaded: the CSS estimate (characters x an average
 * advance) can be a few percent off for a given handle, so this measures the copy on one line and
 * scales it to fill the measure (--fit). Without JavaScript the estimate stands, set slightly small.
 */
function textWidth(element: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
}

function fitCopies(line: HTMLElement) {
  for (const copy of line.querySelectorAll<HTMLElement>(".sp-line-copy")) {
    copy.style.setProperty("--fit", "1");
    copy.style.whiteSpace = "nowrap";
    const parts = [...copy.children] as HTMLElement[];
    // On phones the parts are stacked blocks (the widest one counts); from 760px one line.
    const stacked = parts[0] ? getComputedStyle(parts[0]).display === "block" : false;
    const natural = Math.max(...(stacked ? parts : [copy]).map(textWidth));
    copy.style.whiteSpace = "";
    if (natural > 0) {
      const fit = Math.min(1.2, Math.max(0.4, (copy.clientWidth * 0.985) / natural));
      copy.style.setProperty("--fit", fit.toFixed(3));
    }
  }
}

/**
 * The handle line: the visitor's address, set as large as the measure allows. One copy per face,
 * stacked in one grid cell, so the hero can fade between looks (a font can't be animated). The
 * size comes from the character count (see .sp-line in home.css): one line from 760px, and on
 * phones the handle over a smaller ".hydlnk.com", so a 30-letter handle still fits at 390px.
 * Screen readers get the address once, as plain text.
 */
export function SpecimenLine({
  faces,
  className = "",
}: {
  faces: readonly SpecimenFace[];
  className?: string;
}) {
  const handle = useLiveHandle() || PLACEHOLDER_HANDLE;
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const line = ref.current;
    if (!line) return;
    fitCopies(line);
    let stopped = false;
    void document.fonts.ready.then(() => {
      if (!stopped) fitCopies(line);
    });
    let width = line.clientWidth;
    const observer = new ResizeObserver(() => {
      if (line.clientWidth === width) return;
      width = line.clientWidth;
      fitCopies(line);
    });
    observer.observe(line);
    return () => {
      stopped = true;
      observer.disconnect();
    };
  }, [handle]);

  const style = {
    "--chars-1": handle.length + ADDRESS_SUFFIX.length,
    "--chars-h": Math.max(handle.length, 6),
    "--chars-s": ADDRESS_SUFFIX.length,
  } as CSSProperties;

  return (
    <p ref={ref} className={`sp-line ${className}`} style={style}>
      <span className="sr-only">
        {handle}
        {ADDRESS_SUFFIX}
      </span>
      {faces.map((face) => (
        <span
          key={face.family}
          aria-hidden="true"
          data-look={face.look}
          className="sp-line-copy"
          style={
            {
              fontFamily: face.family,
              fontWeight: face.weight,
              "--advance": face.advance,
            } as CSSProperties
          }
        >
          <span className="sp-line-handle">{handle}</span>
          <span className="sp-line-suffix">{ADDRESS_SUFFIX}</span>
        </span>
      ))}
    </p>
  );
}
