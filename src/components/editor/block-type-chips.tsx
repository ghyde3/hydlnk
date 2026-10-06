"use client";

import { Plus } from "lucide-react";
import { EDITOR_ICON_STROKE, Icon } from "@/components/app/icon";
import { BLOCK_TYPES, BLOCK_TYPE_LABELS, type BlockType } from "@/lib/document";

/**
 * The block-type chips in the order of BLOCK_TYPES (M2-10), 44px tall: the "Add a block" card
 * and the chooser under a "+" between two blocks (M6-04) show the same chips.
 */
export function BlockTypeChips({
  disabled = false,
  onPick,
}: {
  disabled?: boolean;
  onPick: (type: BlockType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {BLOCK_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          disabled={disabled}
          onClick={() => onPick(type)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-line-2 bg-surface px-2.5 text-[13px] text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* The 15px icon takes the room the 8.6px "+" did (-3.2px each side), so a chip is as wide as it was. */}
          <Icon
            icon={Plus}
            size={15}
            strokeWidth={EDITOR_ICON_STROKE}
            className="-mx-[3.2px] text-brass-text"
          />
          {BLOCK_TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
