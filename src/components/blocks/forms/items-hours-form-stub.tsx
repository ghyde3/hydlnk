"use client";

import type { BlockFormProps } from "./types";

/** M12-01: the editor worker replaces this stub with the items form. */
export function ItemsFormStub({ block }: BlockFormProps) {
  if (block.type !== "items") return null;
  return <p className="text-[13px] text-ink-2">Item lists are coming soon.</p>;
}

/** M12-02: the editor worker replaces this stub with the hours form. */
export function HoursFormStub({ block }: BlockFormProps) {
  if (block.type !== "hours") return null;
  return <p className="text-[13px] text-ink-2">Opening hours are coming soon.</p>;
}
