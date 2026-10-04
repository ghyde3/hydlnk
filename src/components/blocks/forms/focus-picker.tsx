"use client";

import { Locate } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "@/components/app/icon";
import { cn } from "@/lib/cn";
import { focusOf, objectPositionOf, type Focus, type ImageRef } from "@/lib/document";
import {
  describeFocus,
  focusFromPoint,
  markerPosition,
  stepFocus,
} from "@/lib/editor/focus-geometry";
import { mediaUrl } from "@/lib/media/url";
import { FORM_BUTTON } from "../field";

/** The picture is never taller than this in the picker. */
const MAX_PICTURE_HEIGHT = 240;

/**
 * The focus control of a card's banner and of a shaped image block (M6-25): where the picture
 * stays in view when the frame crops it.
 *
 * A picker shows the whole picture (`object-fit: contain`, at most 240px tall) with a 44px marker
 * on the current focus. Dragging the marker, or clicking or tapping anywhere on the picture, sets
 * the focus as two numbers from 0 to 1 measured on the picture itself and clamped to it. Below it
 * (beside it on a wide screen) "How it will look" shows the crop at the block's real ratio, and
 * the live preview follows as well. `Center` removes the focus.
 *
 * The marker is a button named "Focus point": the arrow keys move it by 5 percent (Shift: 1
 * percent), and a polite live region says "Focus 30 percent across, 70 percent down". Only the
 * picture has `touch-action: none`, so a drag on a phone does not scroll the page and the rest of
 * the panel still does. This component reads and writes only numbers on the draft: it makes no
 * request of its own (the image is uploaded by the upload control, and a new image arrives without
 * a focus).
 */
export function FocusPicker({
  image,
  ratio,
  error,
  onChange,
}: {
  /** The block's picture; its `focus` is read through `focusOf`, so a bad stored value shows as the center. */
  image: ImageRef;
  /** The frame's width : height: 5 : 2 for a card, the chosen shape's for an image. */
  ratio: { width: number; height: number };
  /** The Publish gate's message for the focus, shown under the control. */
  error?: string | null;
  /** The next focus, rounded to three decimals, or undefined for "Center" (the key is removed). */
  onChange: (focus: Focus | undefined) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const pictureRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  // The real size of the file once it loaded: the box follows it, so the marker's 0 to 1 is the
  // picture's, even if the stored width and height were ever wrong.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const stored = focusOf(image.focus);
  const current: Focus = stored ?? { x: 0.5, y: 0.5 };
  const size = natural ?? { width: image.width, height: image.height };
  const src = mediaUrl(image.path);

  function setFrom(event: ReactPointerEvent<HTMLDivElement>): void {
    const rect = pictureRef.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(focusFromPoint(event.clientX, event.clientY, rect));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault(); // no text selection, no image drag; focus is moved by hand below
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    markerRef.current?.focus({ preventScroll: true });
    setFrom(event);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragging.current) setFrom(event);
  }

  function endDrag(): void {
    dragging.current = false;
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const next = stepFocus(current, event.key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    onChange(next);
  }

  const invalid = error != null && error !== "";
  return (
    <div
      role="group"
      aria-label="Focus"
      data-testid="focus-picker"
      className="flex min-w-0 flex-col gap-1.5"
    >
      <span className="text-[13px] font-semibold text-ink-2">Focus</span>
      <div className="flex min-w-0 flex-col gap-3 hl:flex-row">
        <div className="flex min-w-0 flex-col gap-1.5 hl:flex-1">
          <div
            data-testid="focus-picker-area"
            className="flex w-full justify-center rounded-md border border-line bg-track p-[22px]"
          >
            <div
              ref={pictureRef}
              data-testid="focus-picture"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              style={{
                aspectRatio: `${size.width} / ${size.height}`,
                width: `min(100%, ${(MAX_PICTURE_HEIGHT * size.width) / size.height}px)`,
                maxHeight: MAX_PICTURE_HEIGHT,
                touchAction: "none",
              }}
              className="relative cursor-crosshair select-none"
            >
              {/* A plain <img>: the path is an image reference into the public page-media bucket. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) {
                    setNatural({ width: naturalWidth, height: naturalHeight });
                  }
                }}
                className="pointer-events-none absolute inset-0 size-full object-contain"
                referrerPolicy="no-referrer"
              />
              {/* The block row moves focus to the first `aria-invalid` control after a failed Publish. */}
              {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props */}
              <button
                ref={markerRef}
                type="button"
                aria-label="Focus point"
                aria-describedby={[hintId, invalid ? errorId : null].filter(Boolean).join(" ")}
                aria-invalid={invalid ? true : undefined}
                data-focus-x={current.x}
                data-focus-y={current.y}
                onKeyDown={onKeyDown}
                style={markerPosition(current)}
                className={cn(
                  "absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-md border-2 bg-surface",
                  invalid ? "border-bad" : "border-ink",
                )}
              >
                <Icon icon={Locate} size={22} className="text-ink" />
              </button>
            </div>
          </div>
          <p id={hintId} className="text-xs text-text-2">
            Drag the marker or tap the picture. Arrow keys move it.
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 hl:flex-1">
          <span className="text-[13px] font-semibold text-ink-2">How it will look</span>
          <div
            data-testid="focus-strip"
            style={{ aspectRatio: `${ratio.width} / ${ratio.height}` }}
            className="relative w-full max-w-[360px] overflow-hidden rounded-md border border-line-2 bg-track"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              draggable={false}
              style={objectPositionOf(stored)}
              className="pointer-events-none absolute inset-0 size-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => onChange(undefined)} className={FORM_BUTTON}>
          Center
        </button>
      </div>

      <div aria-live="polite" data-testid="focus-live" className="sr-only">
        {describeFocus(current)}
      </div>
      <div aria-live="polite" className="empty:hidden">
        {invalid ? (
          <p id={errorId} data-field="focus" className="text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
