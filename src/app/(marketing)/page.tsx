import type { Metadata } from "next";
import { AudienceStrip } from "@/components/marketing/audiences/audience-strip";
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
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { marketingMetadata } from "@/components/marketing/metadata";
import { TryBuilder } from "@/components/marketing/try";
import { monthlyText, perMonthBilledYearlyText } from "@/lib/marketing/prices";

export const metadata: Metadata = marketingMetadata({
  path: "/",
  title: { absolute: "HYDLNK — Link in bio, with real design control" },
  description: `Pick a theme, add blocks and make your link page look like your brand, not ours. Free forever, and you can use your own domain on Pro, ${monthlyText("pro")} or ${perMonthBilledYearlyText("pro")}.`,
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
    body: "Start from a theme, then change any color, font or shape. Nothing goes live until you press Publish, and on Pro you can use a domain you already own.",
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
          lead="No code and no templates to fight. Pick your blocks, pick a look, and publish when you like it."
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
            eyebrow="Same blocks, three looks"
            titleId="demos-title"
            title="Your page should look like your brand."
            lead="A pottery studio, a coffee roaster and a photographer, all built from the same blocks. Only the colors, fonts and photos are different."
          />
          <ButtonLink href="/design-control" variant="secondary">
            See how themes work
          </ButtonLink>
        </div>
        <div className="mt-10">
          <DemoGallery />
        </div>
      </Section>

      {/* content-visibility: the browser skips drawing this section, and fetching the fonts its
          sample page uses, until it is near the screen. */}
      <Section
        id="try"
        tone="page"
        labelledBy="try-title"
        className="[contain-intrinsic-size:auto_1100px] [content-visibility:auto] min-[900px]:[contain-intrinsic-size:auto_1200px]"
      >
        <SectionIntro
          eyebrow="Try it now"
          titleId="try-title"
          title="Make this page yours. No sign-up."
          lead="Tap a theme, change a color, add a few blocks. Nothing is saved, and every theme and block is free on every plan."
        />
        <div className="mt-10">
          <TryBuilder />
        </div>
        <ArrowLink href="/features" className="mt-8">
          Every feature, in detail
        </ArrowLink>
      </Section>

      <AudienceStrip tone="white" />

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
            lead="We never take a cut of your sales, on any plan. Cancel anytime from your billing portal."
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
