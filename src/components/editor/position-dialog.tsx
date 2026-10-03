"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  NUDGE_FINE_PX,
  NUDGE_PX,
  ZOOM_STEP,
  clampCrop,
  cropToFile,
  initialCrop,
  movePicture,
  pictureLayout,
  zoomAnnouncement,
  zoomCrop,
  type Crop,
  type PositionPhoto,
} from "@/lib/media/position-crop";

/**
 * What the dialog is called and what its primary button says. The profile photo is "photo"; a link's
 * thumbnail (M6-20, M6-21) is "image": the same dialog, the same square crop and the same upload
 * kind, with a square viewfinder outline (6px radius) instead of a circle.
 */
export type PositionVariant = "photo" | "image";

const COPY: Record<PositionVariant, { title: string; use: string; file: string }> = {
  photo: { title: "Position your photo", use: "Use photo", file: "photo" },
  image: { title: "Position your image", use: "Use image", file: "image" },
};

export const POSITION_FAILED_MESSAGE = "We couldn’t prepare that picture. Try again.";

export interface PositionDialogProps {
  /** A picture the browser already decoded (`decodeForPositioning`), so a bad file never opens the dialog. */
  photo: PositionPhoto;
  variant?: PositionVariant;
  /**
   * The chosen square as a file: a JPEG at quality 0.9 for a photo, a PNG for a PNG or WebP with
   * transparency, at most 800px on a side. Upload it with `kind=avatar`; the dialog sends nothing
   * itself. The caller closes the dialog (unmounts it) in this callback.
   */
  onUse: (file: File) => void;
  /** Cancel, Escape: nothing is uploaded. The caller unmounts the dialog and returns focus to the button that opened it. */
  onCancel: () => void;
}

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY = `${BUTTON} border-line-3 bg-surface text-ink`;
const PRIMARY = `${BUTTON} border-ink bg-ink text-surface`;

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * "Position your photo" (M6-24): the picture under a square viewfinder with a circular outline.
 * Drag it (pointer events, `touch-action: none` on the viewfinder), zoom it with the slider (1x to
 * 4x), or use the keyboard: the arrow keys move it by 10px (Shift: 1px), plus and minus zoom, and
 * a polite live region says "Zoom 200 percent". The picture always covers the viewfinder, so there
 * are never empty edges. "Use photo" draws the chosen square at the picture's real resolution (at
 * most 800px) and hands the file to `onUse`; Reset, Cancel and Escape change nothing.
 *
 * A native modal `<dialog>`: the page behind is inert and does not scroll, Escape asks to cancel,
 * and Tab stays inside. On a phone it is a full-height sheet (`100dvh`) with the two buttons pinned
 * at the bottom above the safe-area inset; from 760px up it is centered, about 440px wide, with a
 * 280px viewfinder.
 */
export function PositionDialog({ photo, variant = "photo", onUse, onCancel }: PositionDialogProps) {
  const copy = COPY[variant];
  const titleId = useId();
  const hintId = useId();
  const zoomId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const finderRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; crop: Crop; size: number } | null>(null);
  const { width, height } = photo;
  const [crop, setCrop] = useState<Crop>(() => initialCrop(width, height));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open as a modal, focus the viewfinder (so the arrow keys work at once), and stop the page behind
  // from scrolling: a modal's backdrop still lets the wheel scroll the document.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    finderRef.current?.focus({ preventScroll: true });
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
      if (dialog.open) dialog.close();
    };
  }, []);

  const finderSize = (): number => finderRef.current?.getBoundingClientRect().width ?? 0;

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      crop,
      size: finderSize(),
    };
    finderRef.current?.focus({ preventScroll: true });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    setCrop(
      movePicture(
        start.crop,
        event.clientX - start.x,
        event.clientY - start.y,
        width,
        height,
        start.size,
      ),
    );
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function onFinderKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const px = event.shiftKey ? NUDGE_FINE_PX : NUDGE_PX;
      const size = finderSize();
      setCrop((current) => movePicture(current, arrow[0] * px, arrow[1] * px, width, height, size));
      return;
    }
    const direction =
      event.key === "+" || event.key === "=" ? 1 : event.key === "-" || event.key === "_" ? -1 : 0;
    if (direction !== 0) {
      event.preventDefault();
      setCrop((current) => zoomCrop(current, current.zoom + direction * ZOOM_STEP, width, height));
    }
  }

  // The dialog's own key handling: Tab stays inside (the page behind is inert, but Tab could still
  // leave for the browser's own UI).
  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[tabindex="0"], input:not([type="hidden"]):not(:disabled), button:not(:disabled)',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function use(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    let file: File | null = null;
    try {
      file = await cropToFile(photo, clampCrop(crop, width, height), copy.file);
    } catch {
      file = null;
    }
    if (!file) {
      setBusy(false);
      setError(POSITION_FAILED_MESSAGE);
      return;
    }
    onUse(file);
  }

  const layout = pictureLayout(crop, width, height);
  const zoomText = `${Number(crop.zoom.toFixed(2))}x`;
  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      data-testid="position-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={onDialogKeyDown}
      className="m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-surface p-0 text-ink open:flex backdrop:bg-ink/60 hl:m-auto hl:h-auto hl:max-h-[calc(100dvh-32px)] hl:w-[440px] hl:rounded-md hl:border hl:border-line"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-3">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-base font-bold">
            {copy.title}
          </h2>
          <p id={hintId} className="text-sm text-text-2">
            Drag the picture to move it. Use the slider to zoom.
          </p>
        </div>

        <div
          ref={finderRef}
          role="group"

          tabIndex={0}
          aria-label="Picture position"
          aria-describedby={hintId}
          data-testid="position-viewfinder"
          data-variant={variant}
          onKeyDown={onFinderKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ touchAction: "none" }}
          className="relative mx-auto aspect-square w-full max-w-[320px] cursor-grab touch-none overflow-hidden rounded-md bg-track select-none hl:max-w-[280px]"
        >
          {/* A plain <img> of the file's own object URL: nothing is requested from anywhere. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt=""
            draggable={false}
            data-testid="position-picture"
            data-zoom={crop.zoom}
            style={{
              left: `${layout.left}%`,
              top: `${layout.top}%`,
              width: `${layout.width}%`,
              height: `${layout.height}%`,
            }}
            className="pointer-events-none absolute max-w-none"
          />
          <span
            aria-hidden="true"
            data-testid="position-outline"
            className={`pointer-events-none absolute inset-0 border-2 border-surface shadow-[0_0_0_999px_rgb(28_27_26/0.55)] ${
              variant === "photo" ? "rounded-full" : "rounded-md"
            }`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={zoomId} className="text-[13px] font-semibold text-ink-2">
              Zoom
            </label>
            <span aria-hidden="true" className="font-mono text-xs text-text-2">
              {zoomText}
            </span>
          </div>
          <input
            id={zoomId}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            aria-valuetext={`${Math.round(crop.zoom * 100)} percent`}
            onChange={(event) =>
              setCrop((current) => zoomCrop(current, Number(event.target.value), width, height))
            }
            className="h-11 w-full accent-ink"
          />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setCrop(initialCrop(width, height))}
            className={`${SECONDARY} w-full hl:w-auto`}
          >
            Reset
          </button>
        </div>

        <div aria-live="polite" data-testid="position-live" className="sr-only">
          {zoomAnnouncement(crop.zoom)}
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-line px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] hl:justify-end">
        <button type="button" onClick={onCancel} className={`${SECONDARY} flex-1 hl:flex-none`}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void use()}
          className={`${PRIMARY} flex-1 hl:flex-none`}
        >
          {copy.use}
        </button>
      </div>
    </dialog>
  );
}
