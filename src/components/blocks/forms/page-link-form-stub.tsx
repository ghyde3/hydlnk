"use client";

import type { BlockFormProps } from "./types";

/** M11-07: the editor worker replaces this stub with the page link form (label and target). */
export function PageLinkFormStub({ block }: BlockFormProps) {
  if (block.type !== "page_link") return null;
  return <p className="text-[13px] text-ink-2">Page links are coming soon.</p>;
}
