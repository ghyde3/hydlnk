import { RANGE_BUTTONS, type RangeDays } from "@/lib/analytics/dashboard/range";

/** The brass-soft "Pro" chip a Free account sees on the ranges it cannot open. */
export function ProChip() {
  return (
    <span className="rounded-sm bg-brass-soft px-1.5 py-px font-mono text-[10px] leading-4 text-brass-soft-text">
      Pro
    </span>
  );
}

/**
 * The segmented "Date range" control (7d, 30d, 90d, 1y): a group of toggle buttons, the chosen one
 * aria-pressed. Locked ranges stay pressable (choosing one shows the upgrade card) and carry the
 * Pro chip. 44px tall on phones, the mockup's 36px from 760px up.
 */
export function RangeControl({
  range,
  lockedFrom,
  onSelect,
}: {
  range: RangeDays;
  /** Ranges longer than this carry the Pro chip: the plan's history in days. */
  lockedFrom: number;
  onSelect: (range: RangeDays) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="flex w-full gap-0.5 rounded-md border border-line bg-track p-[3px] hl:w-auto"
    >
      {RANGE_BUTTONS.map(({ range: value, label }) => {
        const pressed = value === range;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelect(value)}
            className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-3 text-[13px] hl:min-h-9 hl:flex-none ${
              pressed
                ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--hl-line-2)]"
                : "bg-transparent font-medium text-text-2"
            }`}
          >
            {label}
            {value > lockedFrom ? <ProChip /> : null}
          </button>
        );
      })}
    </div>
  );
}
