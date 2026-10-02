import type { Block } from "@/lib/document";
import { overrideChipLabel } from "@/lib/themes";

/**
 * The block row's override chip (M3-17, M3-18): "Fill override" for one override (the style's own
 * name for a button style, "Color override", "Radius override"), "2 overrides" for two, nothing for
 * none. Mono 11px, #F6EEDF background and #6B5226 text (`brass-soft` and `brass-soft-text`), 4px
 * radius, hidden below 760px like the Hidden chip: on a phone the control's own value says it.
 */
export function OverrideChip({ block }: { block: Block }) {
  const label = overrideChipLabel(block);
  if (label === null) return null;
  return (
    <span
      data-testid="override-chip"
      className="hidden shrink-0 rounded-sm bg-brass-soft px-[7px] py-[3px] font-mono text-[11px] whitespace-nowrap text-brass-soft-text hl:inline-block"
    >
      {label}
    </span>
  );
}
