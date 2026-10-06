"use client";

/**
 * A labelled on/off switch row: the whole row is one 44px button (`aria-pressed`), the track on the
 * right, the same control as the banner card's switch. Editor UI, HYDLNK tokens.
 */
export function ToggleRow({
  label,
  pressed,
  onToggle,
  testId,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onToggle}
      className="flex min-h-11 w-full max-w-full cursor-pointer items-center justify-between gap-3 text-left text-sm text-ink"
    >
      <span className="min-w-0">{label}</span>
      <span
        aria-hidden="true"
        className={`relative block h-[18px] w-8 shrink-0 rounded-full ${pressed ? "bg-ink" : "bg-line-3"}`}
      >
        <span
          className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${pressed ? "left-4" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}
