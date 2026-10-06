"use client";

import type { Dispatch, ReactNode } from "react";
import { LIMITS } from "@/lib/document";
import { BLOCK_LIMIT_MESSAGE } from "@/lib/editor/messages";
import type { EditorAction } from "@/lib/editor/state";
import { BlockTypeChips } from "./block-type-chips";

/**
 * "Add a block" (M2-10): nine type chips in the order of BLOCK_TYPES. A chip appends one block of
 * its type, with the defaults from `blockDefaults`, at the end of the page. At the 50-block limit
 * every chip is disabled and the card says why.
 */
export function AddBlockCard({
  blockCount,
  dispatch,
  footer,
}: {
  blockCount: number;
  dispatch: Dispatch<EditorAction>;
  /** Under the chips and the limit note: the "Start from a template" button (M6-40). */
  footer?: ReactNode;
}) {
  const full = blockCount >= LIMITS.blocks;
  return (
    <section
      aria-labelledby="add-block-title"
      className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="add-block-title" className="text-sm font-semibold">
          Add a block
        </h2>
        <span className="text-xs text-text-2">Goes to the end of the page</span>
      </div>
      <BlockTypeChips
        disabled={full}
        onPick={(type) => dispatch({ type: "block/add", blockType: type })}
      />
      {full ? (
        <span role="status" className="text-[13px] text-text-2">
          {BLOCK_LIMIT_MESSAGE}
        </span>
      ) : null}
      {footer}
    </section>
  );
}
