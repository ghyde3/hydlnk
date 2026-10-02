"use client";

import type { Dispatch } from "react";
import { BLOCK_TYPES, BLOCK_TYPE_LABELS, LIMITS } from "@/lib/document";
import { BLOCK_LIMIT_MESSAGE } from "@/lib/editor/messages";
import type { EditorAction } from "@/lib/editor/state";

/**
 * "Add a block" (M2-10): nine type chips in the order of BLOCK_TYPES. A chip appends one block of
 * its type, with the defaults from `blockDefaults`, at the end of the page. At the 50-block limit
 * every chip is disabled and the card says why.
 */
export function AddBlockCard({
  blockCount,
  dispatch,
}: {
  blockCount: number;
  dispatch: Dispatch<EditorAction>;
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
      <div className="flex flex-wrap gap-1.5">
        {BLOCK_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            disabled={full}
            onClick={() => dispatch({ type: "block/add", blockType: type })}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-line-2 bg-surface px-2.5 text-[13px] text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              className="text-[15px] leading-none font-semibold text-brass-text"
            >
              +
            </span>
            {BLOCK_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      {full ? (
        <span role="status" className="text-[13px] text-text-2">
          {BLOCK_LIMIT_MESSAGE}
        </span>
      ) : null}
    </section>
  );
}
