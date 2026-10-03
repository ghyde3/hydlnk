"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import type { BlockType } from "@/lib/document";
import { BlockTypeChips } from "./block-type-chips";

/**
 * (Class names are written out in full: Tailwind finds them by scanning the source text.)
 *
 * The "+" between two blocks (M6-04): a slot of its own in the block list (not a sortable item, no
 * drag handle) with a hairline and a 24px circle. It is 44px tall wherever there is no hover, so a
 * thumb can hit it; with a mouse on a desktop it is a 20px hairline whose circle shows on hover and
 * on keyboard focus. A press opens the nine type chips right under the gap; Escape or a second press
 * closes them and puts focus back on the "+". `position` counts from 1: the new block lands there.
 */
export function AddSlot({
  position,
  open,
  full,
  onToggle,
  onPick,
}: {
  position: number;
  open: boolean;
  /** The page is at the 50-block limit: nothing can be added. */
  full: boolean;
  onToggle: () => void;
  onPick: (type: BlockType) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const chooserId = useId();

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>): void {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    onToggle();
    buttonRef.current?.focus();
  }

  return (
    <li data-add-slot={position} onKeyDown={onKeyDown} className="m-0 list-none p-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Add a block at position ${position}`}
        aria-expanded={open}
        aria-controls={open ? chooserId : undefined}
        disabled={full}
        onClick={() => {
          onToggle();
          buttonRef.current?.focus();
        }}
        className="group relative flex h-11 w-full items-center justify-center disabled:cursor-not-allowed disabled:opacity-40 [@media(hover:hover)_and_(min-width:760px)]:h-5"
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-2"
        />
        <span
          aria-hidden="true"
          className="relative flex size-6 items-center justify-center rounded-full border border-line-3 bg-surface text-[16px] leading-none text-ink [@media(hover:hover)_and_(min-width:760px)]:scale-0 [@media(hover:hover)_and_(min-width:760px)]:group-hover:scale-100 [@media(hover:hover)_and_(min-width:760px)]:group-focus-visible:scale-100 [@media(hover:hover)_and_(min-width:760px)]:group-aria-expanded:scale-100"
        >
          +
        </span>
        <span
          aria-hidden="true"
          className="absolute hidden size-1.5 rounded-full bg-line-3 [@media(hover:hover)_and_(min-width:760px)]:block [@media(hover:hover)_and_(min-width:760px)]:group-hover:hidden [@media(hover:hover)_and_(min-width:760px)]:group-focus-visible:hidden [@media(hover:hover)_and_(min-width:760px)]:group-aria-expanded:hidden"
        />
      </button>
      {open ? (
        <div
          id={chooserId}
          role="group"
          aria-label={`Block types for position ${position}`}
          className="rounded-md border border-line bg-surface p-2.5"
        >
          <BlockTypeChips onPick={onPick} />
        </div>
      ) : null}
    </li>
  );
}
