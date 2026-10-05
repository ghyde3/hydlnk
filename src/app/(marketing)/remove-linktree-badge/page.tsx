import type { Metadata } from "next";
import { LINKTREE_LOGO_BY_PLAN, SEARCH_CLAIMS } from "@/components/marketing/compare/data";
import { InfoCard, SourcesSection } from "@/components/marketing/compare/parts";
import { CtaBand } from "@/components/marketing/cta-band";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { ArrowLink, Section, SectionIntro } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { priceSentence } from "@/lib/marketing/prices";

export const metadata: Metadata = marketingMetadata({
  path: "/remove-linktree-badge",
  title: "Remove the Linktree logo from your page",
  description:
    "Which Linktree plans hide the Linktree logo, what it costs at the time of writing, and how HYDLNK handles its own small badge: shown on Free, removed on Pro.",
  image: "pricing",
});

export default function RemoveLinktreeBadgePage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Branding"
        title="How to remove the Linktree logo from your page"
        lead="Linktree hides its logo on paid plans only. Here is which ones, what they cost at the time of writing, and how HYDLNK treats its own badge."
        secondary={{ href: "/pricing", label: "See HYDLNK pricing" }}
      />

      <Section id="linktree" tone="page" labelledBy="linktree-title">
        <SectionIntro
          titleId="linktree-title"
          eyebrow="Linktree"
          title="Pro or Premium"
          lead={SEARCH_CLAIMS.linktreeBadge.text}
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          <InfoCard title="Which plans hide the logo">
            <ul className="grid gap-2">
              {LINKTREE_LOGO_BY_PLAN.map((item) => (
                <li key={item.plan}>
                  {item.plan}: {item.hidden ? "logo can be hidden" : "logo shown"}
                </li>
              ))}
            </ul>
          </InfoCard>
          <InfoCard title="What those plans cost">
            {SEARCH_CLAIMS.linktreeProPrice.text} Prices are as they were at the time of writing.
          </InfoCard>
        </div>
      </Section>

      <Section id="hydlnk" labelledBy="hydlnk-title">
        <SectionIntro
          titleId="hydlnk-title"
          eyebrow="HYDLNK"
          title="A small badge on Free, none on Pro"
          lead="We are plain about it: HYDLNK Free shows a small “Made with HYDLNK” badge at the bottom of your page. Pro and Studio remove it."
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-3">
          <InfoCard title="Free">
            Small “Made with HYDLNK” badge. Every block and theme option is still open.
          </InfoCard>
          <InfoCard title="Pro">{`No badge. Pro is ${priceSentence("pro")}.`}</InfoCard>
          <InfoCard title="Studio">No badge, with more sites and domains.</InfoCard>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6">
          <ArrowLink href="/design-control">What you can design on every plan</ArrowLink>
          <ArrowLink href="/pricing">What each plan includes</ArrowLink>
          <ArrowLink href="/vs/linktree">HYDLNK vs Linktree</ArrowLink>
        </div>
      </Section>

      <SourcesSection
        claims={[
          SEARCH_CLAIMS.linktreeBadge,
          SEARCH_CLAIMS.linktreeLogoByPlan,
          SEARCH_CLAIMS.linktreeProPrice,
        ]}
        trademarks="Linktree is a trademark of its owner. HYDLNK is not affiliated with Linktree."
      />

      <CtaBand
        title="Claim your name, badge or no badge."
        note="Free forever. Remove the badge when you move to Pro."
      />
    </MarketingShell>
  );
}
