import type { Metadata } from "next";
import { AudienceStrip } from "@/components/marketing/audiences/audience-strip";
import { CtaBand } from "@/components/marketing/cta-band";
import { DomainAnalytics } from "@/components/marketing/domain-analytics";
import { FaqList } from "@/components/marketing/faq";
import { HOME_FAQ } from "@/components/marketing/faq-data";
import "@/components/marketing/home/home.css";
import { Hero } from "@/components/marketing/home/hero";
import { HowItWorks } from "@/components/marketing/home/how-it-works";
import { PeopleGallery } from "@/components/marketing/home/people";
import { PlanCards } from "@/components/marketing/pricing";
import {
  ButtonLink,
  H2,
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { marketingMetadata } from "@/components/marketing/metadata";
import { SeeItInAction } from "@/components/marketing/showcase/see-it";
import { monthlyText, perMonthBilledYearlyText } from "@/lib/marketing/prices";

export const metadata: Metadata = marketingMetadata({
  path: "/",
  title: { absolute: "HYDLNK — Link in bio, with real design control" },
  description: `Pick a theme, add blocks and make your link page look like your brand, not ours. Free forever, and you can use your own domain on Pro, ${monthlyText("pro")} or ${perMonthBilledYearlyText("pro")}.`,
  image: "home",
});

export default function HomePage() {
  return (
    <MarketingShell current="home">
      <Hero />

      <HowItWorks />

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
          <PeopleGallery />
        </div>
      </Section>

      {/* content-visibility: the browser skips drawing this section, and fetching the fonts its
          phones use, until it is near the screen. */}
      <Section
        id="see-it"
        tone="page"
        labelledBy="see-it-title"
        className="[contain-intrinsic-size:auto_900px] [content-visibility:auto]"
      >
        <SeeItInAction titleId="see-it-title" />
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
