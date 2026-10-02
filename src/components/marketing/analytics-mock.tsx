const KPIS = [
  ["Views", "12,480"],
  ["Clicks", "3,906"],
  ["Click-through", "31.3%"],
  ["Unique visitors", "8,214"],
] as const;

// Fourteen days of sample views (bar height) and clicks (inner bar), as fractions of the peak.
const DAYS = [
  [0.42, 0.13], [0.5, 0.16], [0.46, 0.14], [0.61, 0.2], [0.55, 0.17], [0.7, 0.23], [0.66, 0.2],
  [0.58, 0.18], [0.74, 0.24], [0.69, 0.21], [0.83, 0.27], [0.77, 0.24], [0.9, 0.29], [1, 0.33],
] as const;

const LINKS = [
  ["Shop the spring kiln opening", "1,284", "100%"],
  ["Book a wheel class", "902", "70%"],
  ["Spring kiln", "688", "54%"],
] as const;

const SPLITS = [
  { title: "Referrers", rows: [["instagram.com", "46%"], ["Direct", "31%"], ["tiktok.com", "15%"], ["Other", "8%"]] },
  { title: "Devices", rows: [["Mobile", "81%"], ["Desktop", "16%"], ["Tablet", "3%"]] },
  { title: "Countries", rows: [["United States", "38%"], ["United Kingdom", "17%"], ["Canada", "11%"], ["Other", "34%"]] },
] as const;

/**
 * A still of the analytics dashboard with sample numbers (labelled as such): KPI strip, daily
 * views and clicks, clicks per link and the referrer, device and country splits. Decorative.
 */
export function AnalyticsMock({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-md border border-line-2 bg-surface text-sm">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-page px-4 py-3">
        <span className="font-semibold">Analytics</span>
        <span className="flex items-center gap-2">
          <span className="rounded-sm border border-line-3 bg-surface px-2 py-1 font-mono text-[11px]">
            Last 30 days
          </span>
          <span className="rounded-sm bg-track px-2 py-1 font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase">
            Sample data
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 border-b border-line min-[640px]:grid-cols-4">
        {KPIS.map(([label, value], index) => (
          <div
            key={label}
            className={`px-4 py-3 ${index % 2 === 1 ? "border-l border-line" : ""} ${index >= 2 ? "border-t border-line min-[640px]:border-t-0 min-[640px]:border-l" : ""}`}
          >
            <span className="block text-xs text-text-2">{label}</span>
            <span className="mt-0.5 block font-mono text-xl font-medium">{value}</span>
          </div>
        ))}
      </div>
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-end gap-1.5" style={{ height: compact ? 72 : 96 }}>
          {DAYS.map(([views, clicks], index) => (
            <span key={index} className="relative flex-1 rounded-t-[2px] bg-line-2" style={{ height: `${views * 100}%` }}>
              <span
                className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-brass"
                style={{ height: `${(clicks / views) * 100}%` }}
              />
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-4 font-mono text-[11px] text-text-2">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 bg-line-2" /> Views
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 bg-brass" /> Clicks
          </span>
        </div>
      </div>
      {compact ? null : (
        <>
          <div className="border-b border-line">
            <div className="flex justify-between bg-page px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase">
              <span>Clicks by link</span>
              <span>Clicks</span>
            </div>
            {LINKS.map(([label, clicks, width]) => (
              <div key={label} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-3 border-t border-line px-4 py-2.5">
                <span className="flex flex-col gap-1.5">
                  <span className="truncate">{label}</span>
                  <span style={{ width }} className="block h-1 rounded-[2px] bg-brass" />
                </span>
                <span className="text-right font-mono">{clicks}</span>
              </div>
            ))}
          </div>
          <div className="grid min-[640px]:grid-cols-3">
            {SPLITS.map((split, index) => (
              <div
                key={split.title}
                className={`px-4 py-3 ${index > 0 ? "border-t border-line min-[640px]:border-t-0 min-[640px]:border-l" : ""}`}
              >
                <span className="font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase">
                  {split.title}
                </span>
                <ul className="mt-2 flex flex-col gap-1">
                  {split.rows.map(([name, share]) => (
                    <li key={name} className="flex justify-between gap-3">
                      <span className="truncate">{name}</span>
                      <span className="font-mono text-text-2">{share}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
