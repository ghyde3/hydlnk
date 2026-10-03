import type { Metadata } from "next";
import Link from "next/link";
import {
  CREATOR_AUDIENCES,
  HUB_FAQ,
  PLATFORM_AUDIENCES,
  audienceHref,
  type Audience,
} from "@/components/marketing/audiences/data";
import { faqPageJsonLd, jsonLdScript } from "@/components/marketing/audiences/json-ld";
import { ClaimForm } from "@/components/marketing/claim-form";
import { CtaBand } from "@/components/marketing/cta-band";
import { FaqList } from "@/components/marketing/faq";
import { marketingMetadata } from "@/components/marketing/metadata";
import {
  ArrowLink,
  Container,
  H1,
  H2,
  LEAD,
  Section,
  SectionIntro,
} from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { clientEnv } from "@/lib/env/client";

export const metadata: Metadata = marketingMetadata({
  path: audienceHref(),
  title: "Link in bio pages",
  description:
    "What a link in bio page is, and how to set one up for TikTok, Instagram, YouTube, Twitch, X, music, podcasts, art, shops and coaching. Free to start.",
  image: "home",
});

const STEPS = [
  {
    title: "Make your page",
    body: "Claim a handle and add blocks for the things you want people to find: links, videos, music, photos and a few words about you.",
  },
  {
    title: "Paste its address in your profile",
    body: "Every app has a link or website field. Your page’s address goes there, and it works the same way on every app.",
  },
  {
    title: "Change it whenever you like",
    body: "Edit the page and press Publish. Everywhere your address appears now shows the new version.",
  },
] as const;

function AudienceCards({ items }: { items: readonly Audience[] }) {
  return (
    <ul className="grid gap-3 min-[760px]:grid-cols-2 min-[1080px]:grid-cols-3">
      {items.map((audience) => (
        <li key={audience.slug}>
          <Link
            href={audienceHref(audience.slug)}
            className="group flex h-full flex-col gap-2 rounded-md border border-line bg-surface p-[22px] hover:border-ink"
          >
            <span className="text-lg font-semibold tracking-[-0.01em] group-hover:underline group-hover:underline-offset-4">
              {audience.h1}
            </span>
            <span className="text-[15px] leading-[1.6] text-text-2">{audience.blurb}</span>
            <span className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-1 text-sm font-semibold">
              {audience.kind === "platform" ? "See the steps" : "See how to set it up"}{" "}
              <span aria-hidden="true">→</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function LinkInBioHubPage() {
  return (
    <MarketingShell>
      <section
        aria-labelledby="page-title"
        className="border-b border-line bg-surface pt-[clamp(40px,8vw,80px)] pb-[clamp(40px,8vw,80px)]"
      >
        <Container className="grid items-center gap-x-16 gap-y-8 min-[1080px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <h1 id="page-title" className={`max-w-[880px] ${H1}`}>
              Link in bio pages for every kind of creator
            </h1>
            <p className={`mt-5 max-w-[640px] ${LEAD}`}>
              A link in bio is one web address that holds everything you want to share. Pick your
              app or your kind of work to see how to set yours up.
            </p>
          </div>
          <div className="min-w-0">
            <ClaimForm id="hub-hero-handle" rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} />
          </div>
        </Container>
      </section>

      <Section id="platforms" tone="page" labelledBy="platforms-title">
        <SectionIntro
          eyebrow="By app"
          titleId="platforms-title"
          title="Add your link to the app you post on"
          lead="Where the link goes in each app, and a page set up for the people who arrive from it."
        />
        <div className="mt-10">
          <AudienceCards items={PLATFORM_AUDIENCES} />
        </div>
      </Section>

      <Section id="creators" labelledBy="creators-title">
        <SectionIntro
          eyebrow="By what you do"
          titleId="creators-title"
          title="Or start from the kind of work you do"
          lead="Which blocks to use, in what order, for the people who come to you."
        />
        <div className="mt-10">
          <AudienceCards items={CREATOR_AUDIENCES} />
        </div>
      </Section>

      <Section id="how-it-works" tone="page" labelledBy="how-title">
        <SectionIntro eyebrow="How it works" titleId="how-title" title="One link, three steps" />
        <ol className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-3 rounded-md border border-line bg-surface p-[22px]"
            >
              <span
                aria-hidden="true"
                className="font-mono text-xs tracking-[0.08em] text-brass-text"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-lg font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="text-[15px] leading-[1.6] text-text-2">{step.body}</p>
            </li>
          ))}
        </ol>
        <ArrowLink href={guideHref("getting-started")} className="mt-6">
          Getting started, in full
        </ArrowLink>
      </Section>

      <Section id="faq" labelledBy="faq-title">
        <div className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
          <div className="flex-[1_1_300px]">
            <h2 id="faq-title" className={H2}>
              Questions
            </h2>
          </div>
          <div className="min-w-0 flex-[2_1_560px]">
            <FaqList items={HUB_FAQ} openFirst />
          </div>
        </div>
      </Section>

      <CtaBand />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqPageJsonLd(HUB_FAQ)) }}
      />
    </MarketingShell>
  );
}
