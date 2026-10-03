import { chipFor, type ChipTone } from "./view-model";
import type { DomainStatus } from "@/lib/domains/types";

const TONES: Record<ChipTone, { box: string; dot: string }> = {
  wait: { box: "bg-brass-soft text-brass-soft-text", dot: "bg-brass-soft-text" },
  live: { box: "bg-good-bg text-good", dot: "bg-good" },
  error: { box: "border border-bad-line bg-surface text-bad", dot: "bg-bad" },
};

/**
 * The status chip of a domain card (M4-14): "Waiting for DNS", "Live · SSL issued" or, for a row
 * the server marked `error`, "Needs attention". It is a polite live region and it renders from
 * `domains.status` alone, so a flip found by the poll or the sweep is announced without a reload.
 */
export function StatusChip({ status }: { status: DomainStatus }) {
  const chip = chipFor(status);
  const tone = TONES[chip.tone];
  return (
    <span
      aria-live="polite"
      data-domain-chip={chip.tone}
      className={`inline-flex items-center gap-1.5 rounded-sm px-[9px] py-[5px] text-xs font-semibold whitespace-nowrap ${tone.box}`}
    >
      <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${tone.dot}`} />
      {chip.text}
    </span>
  );
}
