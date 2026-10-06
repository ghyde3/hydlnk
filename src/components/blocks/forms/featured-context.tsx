"use client";

import { createContext, useContext, type ReactNode } from "react";
import { isLinkFeatured, type Block } from "@/lib/document";

/**
 * The page's blocks, for the one block form that needs to know about the others: the link form's
 * "Feature this link" switch is disabled on a fourth featured link (M6-22). The block list mounts
 * one provider; without it (a form rendered alone) the count is 0 and the switch is never held back.
 *
 * Editor UI only: it carries data, never markup of the page.
 */
const PageBlocksContext = createContext<readonly Block[] | null>(null);

export function PageBlocksProvider({
  blocks,
  children,
}: {
  blocks: readonly Block[];
  children: ReactNode;
}) {
  return <PageBlocksContext.Provider value={blocks}>{children}</PageBlocksContext.Provider>;
}

/**
 * How many visible links, other than `blockId`, carry a featured style. A hidden block does not
 * count: Publish drops it, so it takes no part in the limit.
 */
export function useOtherFeaturedCount(blockId: string): number {
  const blocks = useContext(PageBlocksContext);
  if (!blocks) return 0;
  return blocks.filter(
    (block) =>
      block.type === "link" &&
      block.id !== blockId &&
      block.visible !== false &&
      isLinkFeatured(block.featured),
  ).length;
}
