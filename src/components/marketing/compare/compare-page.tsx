import { PLAN_LIMITS } from "@/lib/limits";
import { priceSentence, usd, yearlyText } from "@/lib/marketing/prices";
import { CtaBand } from "../cta-band";
import { marketingMetadata } from "../metadata";
import { PageHero } from "../page-hero";
import { ArrowLink, Section, SectionIntro } from "../primitives";
import { MarketingShell } from "../shell";
import { guideHref } from "../site-map";
import { claimFor, type Competitor } from "./data";
import { InfoCard, SourcesSection, StackedTable } from "./parts";

export function compareMetadata(competitor: Competitor) {
  return marketingMetadata({
    path: `/vs/${competitor.slug}`,
    title: competitor.title,
    description: competitor.description,
    image: "home",
  });
}

/** HYDLNK's side of the table, read from the app's own price table and plan limits. */
function hydlnkCells() {
  return {
    price: `Free is ${usd(0)}. Pro is ${priceSentence("pro")}. Studio is ${priceSentence("studio")}.`,
    domain: `Pro includes ${PLAN_LIMITS.pro.customDomains} custom domain you own, with automatic SSL. Studio includes ${PLAN_LIMITS.studio.customDomains}.`,
    badge: "Free shows a small “Made with HYDLNK” badge. Pro and Studio remove it.",
    design: "Every block, theme and design option is open on every plan, Free included.",
    fees: "HYDLNK takes no cut of your sales on any plan.",
  };
}

/** The page behind /vs/<slug>: one template, so another competitor is another entry in data.ts. */
export function ComparePage({ competitor }: { competitor: Competitor }) {
  const hydlnk = hydlnkCells();
  const rows = [
    { label: "Price", topic: "price", mine: hydlnk.price },
    { label: "Custom domain", topic: "domain", mine: hydlnk.domain },
    { label: "Removing the logo", topic: "badge", mine: hydlnk.badge },
    { label: "Design control", topic: "design", mine: hydlnk.design },
    { label: "Fees on sales", topic: "fees", mine: hydlnk.fees },
  ] as const;
  const used = [
    ...rows.map((row) => claimFor(competitor, row.topic)),
    ...competitor.strengths,
  ];

  return (
    <MarketingShell>
      <PageHero
        eyebrow="Compare"
        title={competitor.h1}
        lead={competitor.lead}
        secondary={{ href: "/pricing", label: "See HYDLNK pricing" }}
      />

      <Section id="table" tone="page" labelledBy="table-title">
        <SectionIntro
          titleId="table-title"
          title="Five things, side by side"
          lead={`Prices are as they were at the time of writing. HYDLNK’s column is read from our own plan table, so it matches the pricing page.`}
        />
        <StackedTable
          caption={`HYDLNK and ${competitor.name} compared`}
          columns={["HYDLNK", competitor.name]}
          rows={rows.map((row) => ({
            label: row.label,
            cells: [row.mine, claimFor(competitor, row.topic).text],
          }))}
        />
      </Section>

      <Section id="where" labelledBy="where-title">
        <SectionIntro
          titleId="where-title"
          title="Where each one is the better fit"
          lead={`A comparison page that only praises its own product isn’t much use. Here is where ${competitor.name} is ahead, and what HYDLNK is for.`}
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          <InfoCard title={`Where ${competitor.name} is ahead`}>
            <ul className="grid gap-3">
              {competitor.strengths.map((item) => (
                <li key={item.text}>{item.text}</li>
              ))}
            </ul>
          </InfoCard>
          <InfoCard title="What HYDLNK is for">
            <ul className="grid gap-3">
              <li>
                Design control: every block and every theme option works the same on Free as on
                Pro, so a free page can look finished.
              </li>
              <li>
                A page that sits on your own domain at {yearlyText("pro")}, with no
                cut of your sales.
              </li>
              <li>
                Analytics you can take with you: CSV export on every plan, with{" "}
                {PLAN_LIMITS.free.analyticsHistoryDays} days of history on Free and a year on Pro.
              </li>
            </ul>
          </InfoCard>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6">
          <ArrowLink href="/design-control">How design control works</ArrowLink>
          <ArrowLink href="/custom-domains">Custom domains on HYDLNK</ArrowLink>
          <ArrowLink href="/link-in-bio/instagram">Link in bio for Instagram</ArrowLink>
          <ArrowLink href={guideHref("plans-and-billing")}>Plans and billing</ArrowLink>
        </div>
      </Section>

      <SourcesSection claims={used} trademarks={competitor.trademarkLine} />

      <CtaBand
        title="Try it before you decide."
        note="Free forever. Your page is live at you.hydlnk.com the moment you publish."
      />
    </MarketingShell>
  );
}
