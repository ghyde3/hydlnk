/**
 * Plans as PLAN.md's monetization table describes them, limited to what ships in v1: scheduled
 * links, team access and CSV export are later, so they are not listed. Prices are in US dollars.
 */

export interface Plan {
  id: "free" | "pro" | "studio";
  name: string;
  price: string;
  per: string;
  /** Second price line, under the main one. */
  note: string;
  blurb: string;
  cta: string;
  featured?: boolean;
  lead?: string;
  items: string[];
  dash?: string;
}

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    per: "forever",
    note: "No card required",
    blurb: "One page that looks properly designed.",
    cta: "Start free",
    items: [
      "1 page",
      "Every block and the full theme system",
      "3 saved themes",
      "yourname.hydlnk.com",
      "Per-link clicks, last 30 days",
      "10 MB of uploads",
    ],
    dash: "Small “Made with HYDLNK” badge",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$5",
    per: "/ month",
    note: "or $48 a year",
    blurb: "For creators and small brands on their own domain.",
    cta: "Go Pro",
    featured: true,
    lead: "Everything in Free, plus",
    items: [
      "1 custom domain with SSL",
      "3 pages",
      "No badge",
      "Unlimited saved themes",
      "1 year of analytics with referrers, devices and countries",
      "100 MB of uploads",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    price: "$15",
    per: "/ month",
    note: "Billed monthly",
    blurb: "For agencies and teams running pages for others.",
    cta: "Start Studio",
    lead: "Everything in Pro, plus",
    items: ["15 pages and 15 custom domains", "Themes shared across pages", "1 GB of uploads"],
  },
];

/** The comparison table on /pricing: one row per line of PLAN.md's table that ships in v1. */
export const COMPARISON: readonly { label: string; values: [string, string, string] }[] = [
  { label: "Price", values: ["$0", "$5 a month or $48 a year", "$15 a month"] },
  { label: "Pages", values: ["1", "3", "15"] },
  { label: "Blocks and design tokens", values: ["All", "All", "All"] },
  { label: "Saved themes", values: ["3", "Unlimited", "Unlimited, shared across pages"] },
  {
    label: "Address",
    values: ["yourname.hydlnk.com", "+ 1 custom domain", "15 custom domains"],
  },
  { label: "SSL for custom domains", values: ["—", "Automatic", "Automatic"] },
  { label: "Footer badge", values: ["“Made with HYDLNK”", "Removable", "Removable"] },
  { label: "Uploads", values: ["10 MB", "100 MB", "1 GB"] },
  {
    label: "Analytics",
    values: [
      "Per-link clicks, 30 days",
      "1 year, with referrers, countries and devices",
      "1 year, with referrers, countries and devices",
    ],
  },
  { label: "Commerce fees", values: ["None", "None", "None"] },
];
