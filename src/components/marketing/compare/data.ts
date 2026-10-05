import { usd } from "@/lib/marketing/prices";

/**
 * Everything the comparison and search pages say about a competitor or about Shopify. Each
 * statement is a Claim: its text, the sources it rests on and the day it was checked. A page can
 * only show a claim from this file, and tests/unit/marketing-compare.test.ts fails when one has no
 * source URL or no date. Prices are written with usd() so no dollar amount is typed into source
 * (the rule in marketing-prices.test.ts). Prices and plan terms change: pages say "at the time of
 * writing" next to them.
 */

export const CHECKED_ON = "2026-10-05";
/** What visitors read; the ISO date above is for the record. */
export const CHECKED_LABEL = "Checked October 2026";

export interface Source {
  url: string;
  label: string;
}

export const SOURCES = {
  linktreePricing: { url: "https://linktr.ee/s/pricing", label: "Linktree pricing" },
  linktreeDomain: {
    url: "https://linktr.ee/help/en/articles/6571689-can-i-change-the-linktree-url-to-a-custom-domain",
    label: "Linktree help: Can I change the Linktree URL to a custom domain?",
  },
  linktreeFees: {
    url: "https://linktr.ee/help/en/articles/11410206-understanding-transaction-and-processing-fees-on-linktree",
    label: "Linktree help: Understanding transaction and processing fees",
  },
  linktreeShopify: {
    url: "https://linktr.ee/help/en/articles/5651979-how-do-i-display-my-shopify-products-on-my-linktree",
    label: "Linktree help: How do I display my Shopify products on my Linktree?",
  },
  beaconsPricing: { url: "https://beacons.ai/i/pricing", label: "Beacons pricing" },
  beaconsDomain: {
    url: "https://help.beacons.ai/en/articles/4696257",
    label: "Beacons help: Custom domains",
  },
  beaconsDesign: {
    url: "https://help.beacons.ai/en/articles/4697153",
    label: "Beacons help: Customizing your page",
  },
  shopifyLinkpop: { url: "https://apps.shopify.com/linkpop", label: "Linkpop in the Shopify App Store" },
} as const satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;

export type Topic =
  | "price"
  | "domain"
  | "badge"
  | "design"
  | "fees"
  | "analytics"
  | "shopify"
  | "app";

export interface Claim {
  topic: Topic;
  /** One sentence, as shown on the page. */
  text: string;
  sources: readonly SourceId[];
  /** ISO date the source was last read. */
  checked: string;
}

function claim(topic: Topic, text: string, sources: readonly SourceId[]): Claim {
  return { topic, text, sources, checked: CHECKED_ON };
}

export interface Competitor {
  slug: string;
  name: string;
  /** Under the page: whose mark the name is, and that HYDLNK is unaffiliated. */
  trademarkLine: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  /** Every claim about them, by topic. */
  claims: readonly Claim[];
  /** Where they are ahead, as claims, for the honest section. */
  strengths: readonly Claim[];
}

/** Linktree's paid plans, monthly and billed yearly, in whole dollars as the pricing page shows them. */
const LINKTREE_PLANS = [
  { name: "Starter", yearly: 6, monthly: 8 },
  { name: "Pro", yearly: 12, monthly: 15 },
  { name: "Premium", yearly: 30, monthly: 35 },
] as const;

const BEACONS_PLANS = [
  { name: "Creator", monthly: 10, yearly: 100 },
  { name: "Creator Plus", monthly: 30, yearly: 300 },
  { name: "Creator Max", monthly: 100, yearly: 900 },
] as const;

const linktreeDomain = claim(
  "domain",
  "Linktree does not offer custom domains. Pages live at linktr.ee/username, and Linktree suggests a Redirect link instead.",
  ["linktreeDomain"],
);

const linktreeBadge = claim(
  "badge",
  "Hiding the Linktree logo, on the page and on its QR code, is the “Hide Linktree Footer” setting on Pro and Premium. Free and Starter pages keep it.",
  ["linktreePricing"],
);

/** Which Linktree plans keep the Linktree logo on the page, as the pricing page lists them. */
export const LINKTREE_LOGO_BY_PLAN = [
  { plan: "Free", hidden: false },
  { plan: "Starter", hidden: false },
  { plan: "Pro", hidden: true },
  { plan: "Premium", hidden: true },
] as const;

const linktreePrice = claim(
  "price",
  `Free is ${usd(0)}. ${LINKTREE_PLANS.map(
    (plan) => `${plan.name} is ${usd(plan.yearly)} a month billed yearly or ${usd(plan.monthly)} billed monthly`,
  ).join("; ")}.`,
  ["linktreePricing"],
);

const linktreeFees = claim(
  "fees",
  "Linktree takes a cut of sales of courses and digital products: 12% on Free, 9% on Starter, 9% on Pro and 0% on Premium, plus Stripe processing.",
  ["linktreePricing", "linktreeFees"],
);

const beaconsDomain = claim(
  "domain",
  "Beacons supports custom domains natively, from Creator up: connect one you own or buy one through Beacons.",
  ["beaconsPricing", "beaconsDomain"],
);

export const COMPETITORS: readonly Competitor[] = [
  {
    slug: "linktree",
    name: "Linktree",
    trademarkLine:
      "Linktree is a trademark of its owner. HYDLNK is not affiliated with Linktree.",
    title: "HYDLNK vs Linktree",
    description:
      "HYDLNK and Linktree side by side on price, custom domains, removing the logo, design control and fees on sales, with a source and a date for every Linktree claim.",
    h1: "HYDLNK vs Linktree",
    lead: "Both make a link in bio page. They differ on where the page lives, when the logo can come off and how much of the page you can design. Every Linktree detail below links to where we read it.",
    claims: [
      linktreePrice,
      linktreeDomain,
      linktreeBadge,
      claim(
        "design",
        "Linktree gives every plan themes with color, font and button tweaks. Advanced themes, button and font styles, header layouts and image or video backgrounds are on Pro and Premium.",
        ["linktreePricing"],
      ),
      linktreeFees,
      claim(
        "analytics",
        "Linktree keeps analytics history for 28 days on Free, 90 on Starter, 365 on Pro and all time on Premium. CSV export is on Premium only.",
        ["linktreePricing"],
      ),
      claim(
        "shopify",
        "Linktree connects to a Shopify store and shows up to 6 products, on all plans.",
        ["linktreeShopify"],
      ),
    ],
    strengths: [
      claim(
        "shopify",
        "Linktree connects to a Shopify store and shows up to 6 products on your page, on all plans. HYDLNK has no Shopify connection; you add your products as links.",
        ["linktreeShopify"],
      ),
      claim(
        "analytics",
        "Linktree Premium keeps analytics for all time. HYDLNK keeps up to a year.",
        ["linktreePricing"],
      ),
    ],
  },
  {
    slug: "beacons",
    name: "Beacons",
    trademarkLine: "Beacons is a trademark of its owner. HYDLNK is not affiliated with Beacons.",
    title: "HYDLNK vs Beacons",
    description:
      "HYDLNK and Beacons side by side on price, custom domains, removing branding, design control and fees on sales, with a source and a date for every Beacons claim.",
    h1: "HYDLNK vs Beacons",
    lead: "Both let you connect your own domain and both give you real control over how the page looks. The differences are in price, branding and fees. Every Beacons detail below links to where we read it.",
    claims: [
      claim(
        "price",
        `Free is ${usd(0)}. ${BEACONS_PLANS.map(
          (plan) => `${plan.name} is ${usd(plan.monthly)} a month or ${usd(plan.yearly)} a year`,
        ).join("; ")}.`,
        ["beaconsPricing"],
      ),
      beaconsDomain,
      claim(
        "badge",
        "Beacons branding can be removed on Creator Plus and Creator Max only.",
        ["beaconsPricing"],
      ),
      claim(
        "design",
        "Beacons gives every plan colors, fonts, styles, layouts and image or video backgrounds.",
        ["beaconsDesign"],
      ),
      claim(
        "fees",
        "Beacons takes 9% of sales on Free and Creator, and 0% on Creator Plus and Creator Max.",
        ["beaconsPricing"],
      ),
      claim("shopify", "Beacons has a Shopify integration on all plans.", ["beaconsPricing"]),
    ],
    strengths: [
      claim(
        "domain",
        "Beacons can sell you a domain and connect it for you. HYDLNK connects a domain you already own and does not sell domains.",
        ["beaconsPricing", "beaconsDomain"],
      ),
      claim(
        "shopify",
        "Beacons has a Shopify integration on all plans. HYDLNK has none; you add your products as links.",
        ["beaconsPricing"],
      ),
    ],
  },
];

export function competitorBySlug(slug: string): Competitor | undefined {
  return COMPETITORS.find((competitor) => competitor.slug === slug);
}

export function claimFor(competitor: Competitor, topic: Topic): Claim {
  const found = competitor.claims.find((item) => item.topic === topic);
  if (!found) throw new Error(`${competitor.name} has no ${topic} claim`);
  return found;
}

/** Claims used by the three search pages, so the same wording and sources serve them all. */
export const LINKTREE = COMPETITORS[0]!;

export const SEARCH_CLAIMS = {
  linktreeDomain,
  linktreeBadge,
  linktreePrice,
  linktreeFees,
  linktreeLogoByPlan: claim(
    "badge",
    `Linktree logo by plan: ${LINKTREE_LOGO_BY_PLAN.map((item) => `${item.plan} ${item.hidden ? "can hide it" : "shows it"}`).join(", ")}.`,
    ["linktreePricing"],
  ),
  linktreeRedirect: claim(
    "domain",
    "A Linktree Redirect link sends visitors from an address you own to your Linktree page, which stays on linktr.ee.",
    ["linktreeDomain"],
  ),
  linktreeProPrice: claim(
    "price",
    `Linktree Pro is ${usd(LINKTREE_PLANS[1].yearly)} a month billed yearly or ${usd(LINKTREE_PLANS[1].monthly)} billed monthly. Premium is ${usd(LINKTREE_PLANS[2].yearly)} billed yearly or ${usd(LINKTREE_PLANS[2].monthly)} billed monthly.`,
    ["linktreePricing"],
  ),
  linktreeShopify: LINKTREE.claims.find((item) => item.topic === "shopify")!,
  beaconsShopify: COMPETITORS[1]!.claims.find((item) => item.topic === "shopify")!,
  linkpop: claim(
    "app",
    "Shopify’s own link in bio app, Linkpop, is no longer available. Its App Store listing says it is not currently available.",
    ["shopifyLinkpop"],
  ),
} as const satisfies Record<string, Claim>;

/** Every claim in this file, for the test that checks sources and dates. */
export function allClaims(): Claim[] {
  return [
    ...COMPETITORS.flatMap((competitor) => [...competitor.claims, ...competitor.strengths]),
    ...Object.values(SEARCH_CLAIMS),
  ];
}
