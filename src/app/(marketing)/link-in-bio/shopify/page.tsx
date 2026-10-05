import type { Metadata } from "next";
import { SEARCH_CLAIMS } from "@/components/marketing/compare/data";
import { InfoCard, SourcesSection } from "@/components/marketing/compare/parts";
import { CtaBand } from "@/components/marketing/cta-band";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { ArrowLink, BODY, Section, SectionIntro } from "@/components/marketing/primitives";
import { MarketingShell } from "@/components/marketing/shell";
import { priceSentence } from "@/lib/marketing/prices";

export const metadata: Metadata = marketingMetadata({
  path: "/link-in-bio/shopify",
  title: "Link in bio for Shopify stores",
  description:
    "Link your Shopify store, products and collections from a link in bio page: link, card and grid blocks, discount codes and your own domain, with what Linktree and Beacons offer.",
  image: "home",
});

const BLOCKS = [
  {
    title: "Link block: your store",
    body: "A full-width button to your store’s home page, or to any page of it.",
  },
  {
    title: "Card blocks: the products you want seen",
    body: "A card has a picture, a title and a caption, and the whole card is the link. Use one per featured product, each pointing at its product page.",
  },
  {
    title: "Grid block: collections",
    body: "Two to six tiles side by side, each with a title, a subtitle and a link. Good for collections such as New, Sale and Gift cards.",
  },
  {
    title: "Discount code block: codes that get used",
    body: "A code visitors tap to copy, with an optional link to your store.",
  },
];

export default function LinkInBioShopifyPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Link in bio for"
        title="Link in bio for Shopify stores"
        lead="Send people from Instagram, TikTok or YouTube to your store, your products and your collections from one page you design yourself. HYDLNK has no Shopify integration, so you add what you want to show as blocks."
        secondary={{ href: "/link-in-bio/instagram", label: "Link in bio for Instagram" }}
      />

      <Section id="landscape" tone="page" labelledBy="landscape-title">
        <SectionIntro
          titleId="landscape-title"
          eyebrow="The options"
          title="What store owners have to pick from"
        />
        <div className="mt-10 grid gap-3 min-[760px]:grid-cols-3">
          <InfoCard title="Shopify’s own app">{SEARCH_CLAIMS.linkpop.text}</InfoCard>
          <InfoCard title="Linktree">{SEARCH_CLAIMS.linktreeShopify.text}</InfoCard>
          <InfoCard title="Beacons">{SEARCH_CLAIMS.beaconsShopify.text}</InfoCard>
        </div>
        <p className={`mt-6 max-w-[720px] ${BODY}`}>
          HYDLNK takes the other route. Nothing is pulled from your store automatically: you pick
          the links, products and collections to show, and you choose how they look. That means
          you control the order and the design, and it also means a product you remove from your
          store stays on your page until you remove it there too.
        </p>
      </Section>

      <Section id="how" labelledBy="how-title">
        <SectionIntro
          titleId="how-title"
          eyebrow="How to set it up"
          title="Four blocks cover a store"
        />
        <ul className="mt-10 grid gap-3 min-[760px]:grid-cols-2">
          {BLOCKS.map((block) => (
            <li key={block.title} className="rounded-md border border-line bg-surface p-[22px]">
              <h3 className="text-base font-semibold">{block.title}</h3>
              <p className={`mt-2 ${BODY}`}>{block.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-md border border-line bg-page p-[22px]">
          <h3 className="text-base font-semibold">Put it on your store’s own address</h3>
          <p className={`mt-2 max-w-[720px] ${BODY}`}>
            On Pro you can serve the page from a domain you own, such as links.yourstore.com, next
            to your store at yourstore.com. Pro is {priceSentence("pro")}. Every plan also gets a
            free you.hydlnk.com address.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6">
          <ArrowLink href="/link-in-bio/instagram">Link in bio for Instagram</ArrowLink>
          <ArrowLink href="/custom-domains">Custom domains on HYDLNK</ArrowLink>
          <ArrowLink href="/design-control">Design control</ArrowLink>
        </div>
      </Section>

      <SourcesSection
        claims={[SEARCH_CLAIMS.linkpop, SEARCH_CLAIMS.linktreeShopify, SEARCH_CLAIMS.beaconsShopify]}
        trademarks="Linktree, Beacons and Shopify are trademarks of their respective owners. HYDLNK is not affiliated with any of them."
      />

      <CtaBand
        title="Claim your name and link your store."
        note="Free forever. Add your store, products and collections as blocks."
      />
    </MarketingShell>
  );
}
