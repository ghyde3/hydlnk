import { Chip, Container, SECTION_Y } from "./primitives";

const CARD =
  "flex flex-col gap-3 rounded-md border border-line bg-surface p-[clamp(20px,5vw,28px)]";
const CARD_TITLE = "text-[clamp(22px,5vw,26px)] font-bold tracking-[-0.02em]";
const CARD_BODY = "text-[15px] leading-[1.6] text-text-2";
const DNS_ROW =
  "grid grid-cols-[58px_50px_minmax(0,1fr)] gap-3 px-3.5 hl:grid-cols-[90px_90px_minmax(0,1fr)]";

const ANALYTICS_ROWS = [
  { label: "Portrait sessions — fall dates", clicks: "1,284", width: "100%" },
  { label: "Night Market — new series", clicks: "902", width: "70%" },
  { label: "Studio rental by the hour", clicks: "688", width: "54%" },
] as const;

/** Domain card and analytics card, side by side on desktop and stacked on phones. */
export function DomainAnalytics() {
  return (
    <section className={`border-b border-line bg-surface ${SECTION_Y}`}>
      <Container className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-3">
        <div className={CARD}>
          <Chip tone="brass" className="self-start">
            Pro
          </Chip>
          <h3 className={CARD_TITLE}>Your domain, not ours.</h3>
          <p className={CARD_BODY}>
            Add links.yourbrand.com, set the one DNS record we show you, and SSL is issued
            automatically. Click links stay on your domain too.
          </p>
          <div className="mt-2 overflow-hidden rounded-md border border-line-2 font-mono text-[13px]">
            <div
              className={`${DNS_ROW} bg-page py-2.5 text-[11px] tracking-[0.06em] text-text-2 uppercase`}
            >
              <span>Type</span>
              <span>Name</span>
              <span>Value</span>
            </div>
            <div className={`${DNS_ROW} border-t border-line py-3`}>
              <span>CNAME</span>
              <span>links</span>
              <span className="[overflow-wrap:anywhere]">cname.vercel-dns.com</span>
            </div>
            <div className="flex items-center gap-2 border-t border-line bg-good-bg px-3.5 py-3 text-good">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="size-4 fill-none stroke-current stroke-[2.2]"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              {/* #2F7D4F on #E7F3EC is 4.42:1; the label is a shade darker to clear AA (4.5:1). */}
              <span className="text-[#2B7448]">Verified · SSL issued</span>
            </div>
          </div>
          <span className="text-xs text-text-3">Example record</span>
        </div>

        <div className={CARD}>
          <Chip tone="neutral" className="self-start">
            Every plan
          </Chip>
          <h3 className={CARD_TITLE}>Analytics that answer something.</h3>
          <p className={CARD_BODY}>
            Views, clicks and click-through for every link, free. Pro adds a year of history with
            referrers, devices and countries.
          </p>
          <div className="mt-2 overflow-hidden rounded-md border border-line-2 text-[13px]">
            <div className="flex justify-between bg-page px-3.5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase">
              <span>Link · last 30 days</span>
              <span>Clicks</span>
            </div>
            {ANALYTICS_ROWS.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3 border-t border-line px-3.5 py-2.5"
              >
                <span className="flex flex-col gap-1.5">
                  <span>{row.label}</span>
                  <span style={{ width: row.width }} className="block h-1 rounded-[2px] bg-brass" />
                </span>
                <span className="text-right font-mono">{row.clicks}</span>
              </div>
            ))}
          </div>
          <span className="text-xs text-text-3">Sample numbers</span>
        </div>
      </Container>
    </section>
  );
}
