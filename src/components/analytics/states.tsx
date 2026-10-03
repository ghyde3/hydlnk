import Link from "next/link";
import { Panel } from "./panel";

/** A Free account asked for 90 days or a year (M4-30): the upgrade card replaces the data. */
export function UpgradeCard() {
  return (
    <Panel testId="upgrade-card" className="flex flex-col items-start gap-3">
      <h2 className="m-0 text-sm font-semibold">Longer ranges come with Pro</h2>
      <p className="m-0 max-w-[560px] text-[15px] leading-relaxed text-text-2">
        Free shows the last 7 and 30 days. Pro keeps a full year of views and clicks, and adds
        referrers, devices and countries.
      </p>
      <Link
        href="/settings#plans"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface hl:w-auto"
      >
        Upgrade to Pro
      </Link>
    </Panel>
  );
}

/** The stats could not be loaded (M5-17): what happened, what to do, and a Retry. No details. */
export function StatsError({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel testId="stats-error" className="flex flex-col items-start gap-3">
      <p role="alert" className="m-0 text-[15px] leading-relaxed">
        We couldn{"’"}t load your stats. Try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface"
      >
        Retry
      </button>
    </Panel>
  );
}

/** The one line under the cards. The sentence about Free is added on a plan without breakdowns. */
export function Footnote({ free }: { free: boolean }) {
  return (
    <p
      data-testid="analytics-footnote"
      className="m-0 mt-0.5 text-[13px] leading-normal text-text-2"
    >
      Counted without cookies. Bots are filtered out before anything is stored.
      {free
        ? " On Free, this page shows 30 days of per-link clicks; referrers, devices and countries come with Pro."
        : ""}
    </p>
  );
}

/** Shown while the numbers are samples: why, and what ends it. */
export function SampleNote({ published }: { published: boolean }) {
  return (
    <p
      data-testid="sample-note"
      className="m-0 rounded-md border border-line bg-surface px-3.5 py-3 text-[13px] leading-normal text-text-2 hl:px-5"
    >
      {published
        ? "No visits yet. These numbers are samples. Yours appear after the first view."
        : "Publish your page to start counting views."}
    </p>
  );
}
