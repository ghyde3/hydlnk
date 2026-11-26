"use client";

/** A toggle switch in a 44px row, the look of "Feature this link". */
export function SwitchRow({
  label,
  hint,
  on,
  field,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  field: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        aria-pressed={on}
        data-field={field}
        onClick={onToggle}
        className="flex min-h-12 min-w-[52px] max-w-full items-center justify-between gap-3 text-left text-[13px] font-semibold text-ink-2"
      >
        <span className="min-w-0">{label}</span>
        <span
          aria-hidden="true"
          className={`relative block h-[18px] w-8 shrink-0 rounded-full ${on ? "bg-ink" : "bg-line-3"}`}
        >
          <span
            className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${on ? "left-4" : "left-0.5"}`}
          />
        </span>
      </button>
      <p className="m-0 text-xs text-text-2">{hint}</p>
    </div>
  );
}
