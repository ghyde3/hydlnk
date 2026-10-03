import { isLinkFeatured, type Block } from "@/lib/document";

/**
 * The block row's "Featured" chip (M6-22) for a link that carries a featured style: mono 11px,
 * `brass-soft` background and `brass-soft-text`, 4px radius, hidden below 760px like the override
 * chip and the Hidden chip (on a phone the Feature switch inside the row says it).
 */
export function FeaturedChip({ block }: { block: Block }) {
  if (block.type !== "link" || !isLinkFeatured(block.featured)) return null;
  return (
    <span
      data-testid="featured-chip"
      className="hidden shrink-0 rounded-sm bg-brass-soft px-[7px] py-[3px] font-mono text-[11px] whitespace-nowrap text-brass-soft-text hl:inline-block"
    >
      Featured
    </span>
  );
}
