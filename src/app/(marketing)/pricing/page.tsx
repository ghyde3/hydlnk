import type { ReactNode } from "react";
import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq";
import { FAQ_GROUPS } from "@/components/marketing/faq-data";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { COMPARISON, PLANS } from "@/components/marketing/plans";
import { PlanCards } from "@/components/marketing/pricing";
import { ArrowLink, Check, H2, Section, SectionIntro } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { monthlyText, perMonthBilledYearlyText, yearlyText } from "@/lib/marketing/prices";

export const metadata: Metadata = marketingMetadata({
  path: "/pricing",
  title: "Pricing",
  description: `Free forever, with every block and every design option. Pro is ${monthlyText("pro")} or ${yearlyText("pro")} (${perMonthBilledYearlyText("pro")}) and connects a domain you own. Studio is ${monthlyText("studio")} or ${yearlyText("studio")}.`,
  image: "pricing",
});

/** Lets "yourname.hydlnk.com" wrap before ".hydlnk.com" in a narrow cell instead of mid-word. */
function breakBeforeDomain(value: string): ReactNode {
  const at = value.indexOf(".hydlnk.com");
  if (at <= 0) return value;
  return (
    <>
      {value.slice(0, at)}
      <wbr />
      {value.slice(at)}
    </>
  );
}

const EVERY_PLAN = [
  "All nine blocks",
  "Every design option and every theme",
  "Live phone preview and autosaved drafts",
  "yourname.hydlnk.com over https",
  "Per-link analytics with no cookies",
  "No cut of your sales, ever",
];

const BILLING = [
  {
    title: "Upgrading",
    body: "Upgrade from your account settings. Payment happens on Stripe Checkout, so your card number goes to Stripe and never to HYDLNK.",
  },
  {
    title: "Managing billing",
    body: "Manage billing opens Stripe’s customer portal: change your card, download invoices, switch between monthly and yearly billing, or cancel.",
  },
  {
    title: "Canceling",
    body: "Cancel whenever you like from the portal. Your paid plan stays active until the end of the period you’ve paid for, then the account moves to Free.",
  },
  {
    title: "Prices",
    body: `Prices are in US dollars. Pro is ${monthlyText("pro")} or ${yearlyText("pro")} (${perMonthBilledYearlyText("pro")}); Studio is ${monthlyText("studio")} or ${yearlyText("studio")} (${perMonthBilledYearlyText("studio")}). Free costs nothing and has no time limit.`,
  },
];

export default function PricingPage() {
  const billingFaq = FAQ_GROUPS.find((group) => group.id === "billing")?.items ?? [];
  return (
    <MarketingShell current="pricing">
      <PageHero
        eyebrow="Pricing"
        title="Design is never the paywall."
        lead="Every plan gets every block and every design option. Upgrade when you want to connect a domain you own, more pages or a year of analytics. We never take a cut of your sales."
        secondary={{ href: "#compare", label: "Compare plans" }}
      />

      <Section id="plans" tone="page" labelledBy="plans-title">
        <h2 id="plans-title" className="sr-only">
          Plans
        </h2>
        <PlanCards />
        <div className="mt-8 rounded-md border border-line bg-surface p-[22px]">
          <p className="font-mono text-xs tracking-[0.08em] text-text-2 uppercase">On every plan</p>
          <ul className="mt-3 grid gap-x-6 gap-y-2.5 text-[15px] min-[640px]:grid-cols-2 min-[1024px]:grid-cols-3">
            {EVERY_PLAN.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="compare" labelledBy="compare-title">
        <SectionIntro
          eyebrow="Compare"
          titleId="compare-title"
          title="Side by side."
          lead="Everything that differs between the plans, line by line."
        />
        <div className="mt-10 overflow-hidden rounded-md border border-line-2">
          <table role="table" className="compare w-full border-collapse text-left text-sm">
            <thead role="rowgroup" className="bg-page">
              <tr role="row">
                <th role="columnheader" scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Feature</span>
                </th>
                {PLANS.map((plan) => (
                  <th
                    key={plan.id}
                    role="columnheader"
                    scope="col"
                    className="px-4 py-3 text-[15px] font-semibold"
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {COMPARISON.map((row) => (
                <tr key={row.label} role="row" className="border-t border-line">
                  <th role="rowheader" scope="row" className="px-4 py-3 font-medium text-ink">
                    {row.label}
                  </th>
                  {row.values.map((value, index) => (
                    <td
                      key={PLANS[index]!.id}
                      role="cell"
                      data-plan={PLANS[index]!.name}
                      className="px-4 py-3 text-text-2"
                    >
                      {breakBeforeDomain(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-[1.6] text-text-2">
          HYDLNK doesn’t sell or register domains: you connect a domain you already own, bought at
          any registrar. Pro includes 1 custom domain and Studio 15, and SSL is automatic.
        </p>
      </Section>

      <Section id="billing" tone="page" labelledBy="billing-title">
        <SectionIntro
          eyebrow="Billing"
          titleId="billing-title"
          title="Billing runs on Stripe."
          lead="No billing screens to learn: Stripe Checkout takes the payment and Stripe’s portal handles everything after it."
        />
        <ul className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          {BILLING.map((item) => (
            <li key={item.title} className="rounded-md border border-line bg-surface p-[22px]">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-[15px] leading-[1.6] text-text-2">{item.body}</p>
            </li>
          ))}
        </ul>
        <ArrowLink href={guideHref("plans-and-billing")} className="mt-6">
          Plans and billing, in detail
        </ArrowLink>
      </Section>

      <Section id="pricing-faq" labelledBy="pricing-faq-title">
        <div className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
          <div className="flex-[1_1_300px]">
            <h2 id="pricing-faq-title" className={H2}>
              Pricing questions
            </h2>
          </div>
          <div className="min-w-0 flex-[2_1_560px]">
            <FaqList items={billingFaq} />
          </div>
        </div>
      </Section>

      <CtaBand title="Start free. Upgrade when your page needs it." />
    </MarketingShell>
  );
}
