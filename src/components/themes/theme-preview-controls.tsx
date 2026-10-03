"use client";

import { useEffect, useRef, useState } from "react";
import type { ThemePreviewView } from "./use-theme-preview";

const APPLY =
  "inline-flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded-md bg-ink px-4 py-2 text-center text-sm font-semibold break-words text-surface";
const SECONDARY =
  "inline-flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 py-2 text-center text-sm font-semibold break-words text-ink";

/**
 * The preview column's header while a theme is on show (M6-44), in place of "Live preview": the
 * title "Previewing Paper" and two 44px buttons under it, "Apply Paper" (charcoal) and "Stop
 * previewing" (secondary). Desktop only: it sits inside the 330px preview column.
 */
export function ThemePreviewHeader({ preview }: { preview: ThemePreviewView }) {
  const { name, onApply, onStop, attachApply } = preview;
  return (
    <div data-testid="theme-preview-header" className="flex w-full min-w-0 flex-col gap-2.5">
      <span className="font-mono text-[13px] font-semibold tracking-[0.06em] break-words text-text-2 uppercase">
        Previewing {name}
      </span>
      <div className="flex flex-col gap-2">
        <button
          ref={attachApply}
          type="button"
          data-testid="theme-preview-apply"
          onClick={onApply}
          className={APPLY}
        >
          Apply {name}
        </button>
        <button
          type="button"
          data-testid="theme-preview-stop"
          onClick={onStop}
          className={SECONDARY}
        >
          Stop previewing
        </button>
      </div>
    </div>
  );
}

/**
 * The phone's bar above the bottom tab bar while a theme is on show (M6-44): "Previewing Paper"
 * with "Apply Paper" and "Back to my style", 44px tall, wrapping onto two rows when the names are
 * long. It is fixed, so the page gets a spacer of its own height at the end: the bar never covers
 * the last of the page.
 */
export function ThemePreviewBar({ preview }: { preview: ThemePreviewView }) {
  const { name, onApply, onStop, attachApply } = preview;
  const bar = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="theme-preview-spacer"
        className="w-full shrink-0"
        style={{ height }}
      />
      <div
        ref={bar}
        role="region"
        aria-label="Theme preview"
        data-testid="theme-preview-bar"
        className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-stretch gap-2 border-t border-line bg-surface px-4 py-2.5 hl:hidden"
      >
        <p className="m-0 w-full text-sm font-semibold break-words">Previewing {name}</p>
        <button
          ref={attachApply}
          type="button"
          data-testid="theme-preview-apply"
          onClick={onApply}
          className={`${APPLY} flex-1 basis-[150px]`}
        >
          Apply {name}
        </button>
        <button
          type="button"
          data-testid="theme-preview-stop"
          onClick={onStop}
          className={`${SECONDARY} flex-1 basis-[150px]`}
        >
          Back to my style
        </button>
      </div>
    </>
  );
}
