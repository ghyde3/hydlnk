import type { Metadata } from "next";
import { BLOCK_CATALOG } from "@/components/marketing/block-catalog";
import { CtaBand } from "@/components/marketing/cta-band";
import { DemoGallery } from "@/components/marketing/demo/demo-gallery";
import { DomainAnalytics } from "@/components/marketing/domain-analytics";
import { FaqList } from "@/components/marketing/faq";
import { HOME_FAQ } from "@/components/marketing/faq-data";
import { Hero } from "@/components/marketing/hero";
import { PlanCards } from "@/components/marketing/pricing";
import {
  ArrowLink,
  ButtonLink,
  H2,
  IconTile,
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { ThemeTokens } from "@/components/marketing/theme-tokens";
import { marketingMetadata } from "@/components/marketing/metadata";
import { monthlyText, perMonthBilledYearlyText } from "@/lib/marketing/prices";

export const metadata: Metadata = marketingMetadata({
  path: "/",
  title: { absolute: "HYDLNK — Link in bio, with real design control" },
  description: `Block layouts, a full theme system and your own domain — so your link page looks like your brand, not ours. Free forever; connect a domain you own on Pro, ${monthlyText("pro")} or ${perMonthBilledYearlyText("pro")}.`,
  image: "home",
});

const STEPS = [
  {
    number: "01",
    title: "Claim your name",
    body: "Pick a handle and your page lives at yourname.hydlnk.com. Sign in with an email link or Google: there’s no password to remember.",
    href: guideHref("choosing-a-handle"),
    link: "Choosing a handle",
  },
  {
    number: "02",
    title: "Build it with blocks",
    body: "Add links, cards, images, video and music, social icons and grids, then drag them into order. Every change autosaves as a draft, next to a live phone preview.",
    href: guideHref("getting-started"),
    link: "Getting started",
  },
  {
    number: "03",
    title: "Style it, then publish",
    body: "Start from a theme or set every token yourself. Nothing reaches your live page until you press Publish, and on Pro you can connect a domain you already own.",
    href: guideHref("designing-your-page"),
    link: "Designing your page",
  },
] as const;

export default function HomePage() {
  return (
    <MarketingShell current="home">
      <Hero />

      <Section id="how-it-works" tone="page" labelledBy="how-title">
        <SectionIntro
          eyebrow="How it works"
          titleId="how-title"
          title="From a name to a published page in three steps."
          lead="No templates to fight and no code. You choose the blocks, the tokens decide the look, and you publish when it’s right."
        />
        <ol className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3">
          {STEPS.map((step) => (
            <li
              key={step.number}
              className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]"
            >
              <span className="font-mono text-xs tracking-[0.08em] text-brass-text">
                {step.number}
              </span>
              <h3 className="text-lg font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="text-[15px] leading-[1.6] text-text-2">{step.body}</p>
              <ArrowLink href={step.href} className="mt-auto self-start">
                {step.link}
              </ArrowLink>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="demos" labelledBy="demos-title">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionIntro
            eyebrow="Same blocks, three brands"
            titleId="demos-title"
            title="Your page should look like your brand."
            lead="A pottery studio, a coffee roaster and a photographer, built from the same nine blocks. Only the tokens change."
          />
          <ButtonLink href="/design-control" variant="secondary">
            See how themes work
          </ButtonLink>
        </div>
        <div className="mt-10">
          <DemoGallery />
        </div>
      </Section>

      <Section id="design" tone="page" labelledBy="design-title">
        <ThemeTokens />
      </Section>

      <Section id="blocks" labelledBy="blocks-title">
        <SectionIntro
          eyebrow="Free on every plan"
          titleId="blocks-title"
          title="Nine blocks. Any order. Every plan."
          lead="Every plan gets every block and the whole theme system. You pay to connect your own domain or for more pages — never to make your page look good."
        />
        <ul className="mt-10 grid gap-3 min-[640px]:grid-cols-2 min-[1024px]:grid-cols-3">
          {BLOCK_CATALOG.map((block) => (
            <li
              key={block.id}
              className="flex gap-4 rounded-md border border-line bg-surface p-[18px]"
            >
              <IconTile>{block.icon}</IconTile>
              <div className="min-w-0">
                <h3 className="text-base font-semibold">{block.name}</h3>
                <p className="mt-1 text-sm leading-[1.55] text-text-2">{block.short}</p>
              </div>
            </li>
          ))}
        </ul>
        <ArrowLink href="/features" className="mt-6">
          Every feature, in detail
        </ArrowLink>
      </Section>

      <Section id="domains-analytics" tone="page" labelledBy="da-title">
        <h2 id="da-title" className="sr-only">
          Custom domains and analytics
        </h2>
        <DomainAnalytics />
      </Section>

      <Section id="pricing" labelledBy="pricing-title">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionIntro
            eyebrow="Pricing"
            titleId="pricing-title"
            title="Design is never the paywall."
            lead="No commerce fees on any plan. Cancel anytime from your billing portal."
          />
          <ButtonLink href="/pricing" variant="secondary">
            Compare plans
          </ButtonLink>
        </div>
        <div className="mt-10">
          <PlanCards />
        </div>
      </Section>

      <Section id="faq" tone="page" labelledBy="faq-title">
        <div className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
          <div className="flex-[1_1_300px]">
            <h2 id="faq-title" className={H2}>
              Questions
            </h2>
            <p className="mt-4 text-[15px] leading-[1.6] text-text-2">
              The short answers. The guides go further.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ButtonLink href="/faq" variant="secondary">
                All questions
              </ButtonLink>
              <ButtonLink href="/learn" variant="secondary">
                Guides
              </ButtonLink>
            </div>
          </div>
          <div className="min-w-0 flex-[2_1_560px]">
            <FaqList items={HOME_FAQ} openFirst />
          </div>
        </div>
      </Section>

      <CtaBand />
    </MarketingShell>
  );
}
