import { formatNumber } from "@/lib/analytics/dashboard/format";
import type { LinkRow } from "@/lib/analytics/dashboard/types";

/*
 * Phone: link, clicks and CTR (the share bar is dropped, as DESIGN.md says). 760px and up: the
 * mockup's four columns. The same grid classes serve the header and every row.
 */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_60px_52px] gap-x-3 px-3.5 hl:grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_80px_70px] hl:gap-x-4 hl:px-5";

/**
 * "Clicks by link": one row per link with a click in the range, most clicks first. The share bar is
 * the row's clicks over the top row's; CTR is its clicks over the page's views.
 */
export function LinksTable({ links, views }: { links: LinkRow[]; views: number }) {
  return (
    <section
      aria-labelledby="links-heading"
      data-testid="links-card"
      className="overflow-hidden rounded-md border border-line bg-surface"
    >
      <h2 id="links-heading" className="m-0 px-3.5 py-3.5 text-sm font-semibold hl:px-5">
        Clicks by link
      </h2>
      <div role="table" aria-labelledby="links-heading">
        <div role="rowgroup">
          <div
            role="row"
            className={`${COLUMNS} border-y border-line bg-page py-2 font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase`}
          >
            <span role="columnheader">Link</span>
            <span role="columnheader" className="hidden hl:block">
              Share of clicks
            </span>
            <span role="columnheader" className="text-right">
              Clicks
            </span>
            <span role="columnheader" className="text-right">
              CTR
            </span>
          </div>
        </div>
        <div role="rowgroup">
          {links.map((link) => (
            <div
              key={link.id}
              role="row"
              data-testid="link-row"
              className={`${COLUMNS} min-h-11 items-center border-b border-track py-2 text-sm`}
            >
              <span role="cell" className="truncate" title={link.label}>
                {link.label}
              </span>
              <span role="cell" className="hidden h-1.5 rounded-[2px] bg-track hl:block">
                <span
                  className="block h-1.5 rounded-[2px] bg-brass"
                  style={{ width: `${link.sharePct}%` }}
                />
              </span>
              <span role="cell" className="text-right font-mono text-[13px]">
                {formatNumber(link.clicks)}
              </span>
              <span role="cell" className="text-right font-mono text-[13px] text-text-2">
                {link.ctr}
              </span>
            </div>
          ))}
        </div>
      </div>
      {links.length === 0 ? (
        <div data-testid="links-empty" className="px-3.5 py-5 text-sm text-text-2 hl:px-5">
          <p className="m-0">No clicks in this range yet.</p>
          {views > 0 ? (
            <p className="m-0 mt-1 text-[13px]">
              No clicks yet. Clicks appear here once someone taps a link.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
