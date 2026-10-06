import { signupsChart, type SignupDay } from "@/lib/admin/numbers";

/**
 * Signups per day for the last 30 days (M13-03): inline SVG bars in the brass token, no library.
 * The figure has a text label (total and busiest day) and every bar a <title>, so it reads without
 * the picture. The viewBox scales to the card's width; the height stays small.
 */
export function SignupsChart({ days }: { days: readonly SignupDay[] }) {
  const chart = signupsChart(days);
  const first = days[0]?.day;
  const last = days[days.length - 1]?.day;
  return (
    <figure data-testid="signups-chart" className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-mono text-xs text-text-2">Signups, last {days.length} days</span>
        <span className="font-mono text-xs text-text-2">
          {chart.total} total, busiest day {chart.peak === 1 && chart.total === 0 ? 0 : chart.peak}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Signups per day, ${chart.total} in the last ${days.length} days`}
        className="h-16 w-full"
      >
        <line
          x1="0"
          x2={chart.width}
          y1={chart.height - 0.5}
          y2={chart.height - 0.5}
          className="stroke-line-2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {chart.bars.map((bar) => (
          <rect
            key={bar.day}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            className={bar.signups > 0 ? "fill-brass" : "fill-line-2"}
          >
            <title>{`${bar.day}: ${bar.signups}`}</title>
          </rect>
        ))}
      </svg>
      {first && last ? (
        <div className="flex justify-between font-mono text-[11px] text-text-3">
          <span>{first}</span>
          <span>{last}</span>
        </div>
      ) : null}
    </figure>
  );
}
