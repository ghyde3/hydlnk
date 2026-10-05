import type { Metadata } from "next";
import { SEARCH_CLAIMS } from "@/components/marketing/compare/data";
import { InfoCard, SourcesSection } from "@/components/marketing/compare/parts";
import { CtaBand } from "@/components/marketing/cta-band";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { ArrowLink, BODY, Section, SectionIntro } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { guideHref } from "@/components/marketing/site-map";
import { PLAN_LIMITS } from "@/lib/limits";
import { priceSentence } from "@/lib/marketing/prices";

export const metadata: Metadata = marketingMetadata({
  path: "/linktree-custom-domain",
  title: "Linktree custom domain: what it offers and the alternative",
  description:
    "Can you use your own domain with Linktree? What Linktree says about custom domains, and how to put a link in bio page on a domain you own with HYDLNK.",
  image: "domains",
});

const STEPS = [
  "Add the domain you want in the editor, such as links.yourbrand.com.",
  "Copy the one DNS record the editor shows and add it where your domain’s DNS is managed.",
  "HYDLNK finds the record, marks the domain Verified and issues SSL for you.",
];

export default function LinktreeCustomDomainPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Custom domains"
        title="Can you use a custom domain with Linktree?"
        lead="Short answer: Linktree says no. Here is what it offers instead, and how a link in bio page on your own domain works on HYDLNK."
        secondary={{ href: "/custom-domains", label: "How custom domains work" }}
      />

      <Section id="linktree" tone="page" labelledBy="linktree-title">
        <SectionIntro
          titleId="linktree-title"
          eyebrow="What Linktree says"
          title="Your Linktree page stays on Linktree’s address"
        />
        <p className={`mt-6 max-w-[720px] ${BODY}`}>{SEARCH_CLAIMS.linktreeDomain.text}</p>
        <p className={`mt-4 max-w-[720px] ${BODY}`}>
          A redirect link sends visitors from an address you own to your Linktree page, but the
          page they land on is still on linktr.ee. If the address people see and share should be
          your own, you need a service that serves the page from your domain.
        </p>
      </Section>

      <Section id="hydlnk" labelledBy="hydlnk-title">
        <SectionIntro
          titleId="hydlnk-title"
          eyebrow="On HYDLNK"
          title="Your page, served from a domain you own"
          lead={`Every page has a free address at you.hydlnk.com. On Pro you can serve it from a domain you already own as well. Pro includes ${PLAN_LIMITS.pro.customDomains} custom domain and Studio ${PLAN_LIMITS.studio.customDomains}. Pro is ${priceSentence("pro")}.`}
        />
        <ol className="mt-10 grid gap-3 min-[760px]:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="rounded-md border border-line bg-surface p-[22px]">
              <span className="font-mono text-sm">{index + 1}</span>
              <p className={`mt-2 ${BODY}`}>{step}</p>
            </li>
          ))}
        </ol>
        <div className="mt-3 grid gap-3 min-[760px]:grid-cols-2">
          <InfoCard title="What you need">
            A domain you already own, from any registrar. HYDLNK does not sell or register
            domains.
          </InfoCard>
          <InfoCard title="What stays the same">
            Your hydlnk.com address keeps working, and click tracking stays on your own domain too.
          </InfoCard>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6">
          <ArrowLink href="/custom-domains">Custom domains on HYDLNK</ArrowLink>
          <ArrowLink href={guideHref("connecting-a-domain")}>Connecting a domain, step by step</ArrowLink>
          <ArrowLink href="/vs/linktree">HYDLNK vs Linktree</ArrowLink>
        </div>
      </Section>

      <SourcesSection
        claims={[SEARCH_CLAIMS.linktreeDomain]}
        trademarks="Linktree is a trademark of its owner. HYDLNK is not affiliated with Linktree."
      />

      <CtaBand
        title="Claim your name now. Bring your domain when you are ready."
        note="Free forever. Connect a domain you own on Pro."
      />
    </MarketingShell>
  );
}
