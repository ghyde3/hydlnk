import type { Metadata } from "next";
import { AnalyticsMock } from "@/components/marketing/analytics-mock";
import { CtaBand } from "@/components/marketing/cta-band";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import {
  ArrowLink,
  Check,
  Chip,
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { RAW_EVENT_RETENTION_DAYS } from "@/lib/analytics/retention";
import { guideHref } from "@/components/marketing/site-map";

export const metadata: Metadata = marketingMetadata({
  path: "/link-analytics",
  title: "Analytics",
  description:
    "Views, clicks and click-through rate for every link, plus referrers, devices and countries on Pro. No cookies, no consent banner from HYDLNK, no tracking across sites.",
  image: "analytics",
});

const METRICS = [
  ["Views", "How many times your page was opened. Counted by a small signal your page sends as it loads."],
  ["Clicks", "How many times each link, card or tile was tapped. Counted on our side as the visitor is sent on, so it works even when scripts are turned off."],
  ["Click-through rate", "Clicks on a link divided by views of the page: the share of visitors who tapped it."],
  ["Unique visitors", "An estimate of how many different people visited each day, made without cookies (see below)."],
  ["Referrers", "The site a visitor came from, such as instagram.com, or Direct when the browser doesn’t say."],
  ["Devices", "Mobile, desktop or tablet, based on the visitor’s browser."],
  ["Countries", "The visitor’s country, from the network they connect through. We never store their IP address."],
] as const;

const PRIVACY = [
  "No cookies, no saved data in the browser and no tracking scripts on your page.",
  "IP addresses are never stored. Unique visitors come from a scrambled, one-way code made from the IP address and browser, mixed with a value that changes every day, so a visitor can’t be followed from one day to the next.",
  "Known bots and crawlers are filtered out before anything is counted.",
  `Individual views and clicks are kept for ${RAW_EVENT_RETENTION_DAYS} days, then combined into daily totals.`,
  "Your visitors’ data is used for your analytics only. HYDLNK doesn’t sell it or use it for advertising.",
] as const;

const LIMITS = [
  {
    title: "Numbers won’t match other dashboards exactly",
    body: "A social app counts taps on your bio link; HYDLNK counts visits that reach your page and clicks that leave it. Both are right; they measure different moments.",
  },
  {
    title: "Some views can go uncounted",
    body: "Views rely on a small signal that some ad blockers stop. Clicks are counted on our side, so they’re the more complete number.",
  },
  {
    title: "Uniques are estimates",
    body: "Without cookies, two people on the same network and browser can count as one visitor for the day, and one person on two devices as two.",
  },
] as const;

export default function AnalyticsPage() {
  return (
    <MarketingShell current="analytics">
      <PageHero
        eyebrow="Analytics"
        title="Analytics that answer something."
        lead="See which links people actually tap, where they came from and what they used, without cookies, consent banners or tracking scripts on your page."
        secondary={{ href: guideHref("understanding-analytics"), label: "Reading your numbers" }}
        aside={<AnalyticsMock compact />}
      />

      <Section id="metrics" tone="page" labelledBy="metrics-title">
        <div className="grid items-start gap-12 min-[1080px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <SectionIntro
              eyebrow="What we count"
              titleId="metrics-title"
              title="Seven numbers, each with a plain definition."
            />
            <dl className="mt-8 flex flex-col">
              {METRICS.map(([name, body]) => (
                <div key={name} className="border-t border-line py-3.5 first:border-t-0">
                  <dt className="text-base font-semibold">{name}</dt>
                  <dd className="mt-1 text-[15px] leading-[1.6] text-text-2">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <AnalyticsMock />
        </div>
      </Section>

      <Section id="privacy" labelledBy="privacy-title">
        <SectionIntro
          eyebrow="Private by design"
          titleId="privacy-title"
          title="Useful numbers without following anyone."
          lead="Your page sets no cookies, so HYDLNK never asks your visitors for consent. That only works because the analytics are built not to need it."
        />
        <ul className="mt-8 grid gap-3 min-[760px]:grid-cols-2">
          {PRIVACY.map((item) => (
            <li key={item} className="flex gap-3 rounded-md border border-line bg-surface p-[18px]">
              <Check className="stroke-good" />
              <span className="text-[15px] leading-[1.6] text-text-2">{item}</span>
            </li>
          ))}
        </ul>
        <ArrowLink href="/privacy" className="mt-6">
          Read the privacy policy
        </ArrowLink>
      </Section>

      <Section id="plans" tone="page" labelledBy="analytics-plans-title">
        <SectionIntro
          eyebrow="By plan"
          titleId="analytics-plans-title"
          title="Per-link numbers are free. History is Pro."
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]">
            <Chip tone="neutral" className="self-start">
              Free
            </Chip>
            <h3 className="text-lg font-semibold">The last 30 days, link by link</h3>
            <p className="text-[15px] leading-[1.6] text-text-2">
              Views, clicks and click-through rate for every link on your page.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]">
            <Chip tone="brass" className="self-start">
              Pro and Studio
            </Chip>
            <h3 className="text-lg font-semibold">A year of history, and where it came from</h3>
            <p className="text-[15px] leading-[1.6] text-text-2">
              Everything in Free over 7 days, 30 days, 90 days or a year, plus referrers, devices
              and countries.
            </p>
          </div>
        </div>
      </Section>

      <Section id="limits" labelledBy="limits-title">
        <SectionIntro
          eyebrow="Honest numbers"
          titleId="limits-title"
          title="What analytics can’t tell you."
          lead="Every analytics tool counts slightly differently. Here’s how ours differs, so you can read it with confidence."
        />
        <ul className="mt-10 grid gap-3 min-[1024px]:grid-cols-3">
          {LIMITS.map((item) => (
            <li key={item.title} className="rounded-md border border-line bg-surface p-[22px]">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-[1.6] text-text-2">{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <CtaBand
        title="Find out which links work."
        note="Per-link analytics are free on every plan. No cookies, ever."
      />
    </MarketingShell>
  );
}
