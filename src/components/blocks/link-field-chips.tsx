import { hasCustomUtm, type Block } from "@/lib/document";

/**
 * The block row's chips for a link's own UTM tags and its lock (M9-28, M9-30): 'Custom tags' or 'No
 * tags', and 'Locked'. Mono 11px, `brass-soft` like the Featured chip, hidden below 760px like the
 * other chips (on a phone the group inside the row says it).
 */
const CHIP =
  "hidden shrink-0 rounded-sm bg-brass-soft px-[7px] py-[3px] font-mono text-[11px] whitespace-nowrap text-brass-soft-text hl:inline-block";

export function LinkTagsChip({ block }: { block: Block }) {
  if (block.type !== "link") return null;
  const utm = block.utm;
  const label = utm?.off === true ? "No tags" : hasCustomUtm(utm) ? "Custom tags" : null;
  if (label === null) return null;
  return (
    <span data-testid="link-tags-chip" className={CHIP}>
      {label}
    </span>
  );
}

export function LockChip({ block }: { block: Block }) {
  if (block.type !== "link" || !block.lock) return null;
  return (
    <span data-testid="lock-chip" className={CHIP}>
      Locked
    </span>
  );
}
