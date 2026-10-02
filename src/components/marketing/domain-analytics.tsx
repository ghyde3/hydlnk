import { ArrowLink, Chip } from "./primitives";

const CARD =
  "flex flex-col gap-3 rounded-md border border-line bg-surface p-[clamp(20px,5vw,28px)]";
const CARD_TITLE = "text-[clamp(22px,5vw,26px)] font-bold tracking-[-0.02em]";
const CARD_BODY = "text-[15px] leading-[1.6] text-text-2";
const DNS_ROW =
  "grid grid-cols-[58px_50px_minmax(0,1fr)] gap-3 px-3.5 hl:grid-cols-[90px_90px_minmax(0,1fr)]";

const ANALYTICS_ROWS = [
  { label: "Shop the spring kiln opening", clicks: "1,284", width: "100%" },
  { label: "Book a wheel class", clicks: "902", width: "70%" },
  { label: "Spring kiln", clicks: "688", width: "54%" },
] as const;

/** An example DNS record with the real target left to the editor (it differs per project). */
export function DnsExample({ name = "links", type = "CNAME" }: { name?: string; type?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line-2 font-mono text-[13px]">
      <div className={`${DNS_ROW} bg-page py-2.5 text-[11px] tracking-[0.06em] text-text-2 uppercase`}>
        <span>Type</span>
        <span>Name</span>
        <span>Value</span>
      </div>
      <div className={`${DNS_ROW} border-t border-line py-3`}>
        <span>{type}</span>
        <span>{name}</span>
        <span className="text-text-2 [overflow-wrap:anywhere]">shown in your editor</span>
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
  );
}

/** Sample per-link analytics table (labelled as sample numbers wherever it appears). */
export function AnalyticsSample() {
  return (
    <div className="overflow-hidden rounded-md border border-line-2 text-[13px]">
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
  );
}

/** Home: the custom-domain card and the analytics card, side by side from 760px. */
export function DomainAnalytics() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-3">
      <div className={CARD}>
        <Chip tone="brass" className="self-start">
          Pro
        </Chip>
        <h3 className={CARD_TITLE}>Your domain, not ours.</h3>
        <p className={CARD_BODY}>
          Connect a domain you already own, bought at any registrar: add links.yourbrand.com, set
          the one DNS record the editor shows you, and SSL is issued automatically. HYDLNK doesn’t
          sell domains.
        </p>
        <div className="mt-2">
          <DnsExample />
        </div>
        <span className="text-xs text-text-3">Example record</span>
        <ArrowLink href="/custom-domains" className="self-start">
          How custom domains work
        </ArrowLink>
      </div>

      <div className={CARD}>
        <Chip tone="neutral" className="self-start">
          Every plan
        </Chip>
        <h3 className={CARD_TITLE}>Analytics that answer something.</h3>
        <p className={CARD_BODY}>
          Views, clicks and click-through for every link, free. Pro adds a year of history with
          referrers, devices and countries. No cookies, on any plan.
        </p>
        <div className="mt-2">
          <AnalyticsSample />
        </div>
        <span className="text-xs text-text-3">Sample numbers</span>
        <ArrowLink href="/link-analytics" className="self-start">
          What analytics measure
        </ArrowLink>
      </div>
    </div>
  );
}
