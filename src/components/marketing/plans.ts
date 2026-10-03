import { PLAN_LIMITS } from "@/lib/limits";
import { versionHistoryCell, versionHistoryItem } from "@/lib/versions/messages";
import {
  PRICES,
  monthlyText,
  perMonthBilledYearlyText,
  perMonthWhenYearly,
  usd,
  yearlySavings,
  yearlyText,
  type BillingInterval,
} from "@/lib/marketing/prices";

/**
 * Plans as PLAN.md's monetization table describes them, limited to what ships in v1: scheduled
 * links, team access and CSV export are later, so they are not listed. Every dollar amount comes
 * from src/lib/marketing/prices.ts.
 */

export interface PlanPrice {
  /** The big figure. */
  amount: string;
  /** Right after it: "/ month". */
  per: string;
  /** Second price line, under the main one. */
  note: string;
}

export interface Plan {
  id: "free" | "pro" | "studio";
  name: string;
  /** What the card shows for each billing period; Free is the same object for both. */
  price: Record<BillingInterval, PlanPrice>;
  blurb: string;
  cta: string;
  featured?: boolean;
  lead?: string;
  items: string[];
  /** Lines the plan does not include, shown with a dash. */
  dash?: readonly string[];
}

const FREE_PRICE: PlanPrice = { amount: usd(0), per: "forever", note: "No card required" };

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    price: { monthly: FREE_PRICE, yearly: FREE_PRICE },
    blurb: "One page that looks the way you want.",
    cta: "Start free",
    items: [
      "1 page",
      "Every block, theme and design option",
      "3 saved themes",
      "yourname.hydlnk.com",
      "Per-link clicks, last 30 days",
      "10 MB of uploads",
    ],
    dash: ["Version history", "Small “Made with HYDLNK” badge"],
  },
  {
    id: "pro",
    name: "Pro",
    price: {
      monthly: { amount: usd(PRICES.pro.monthly), per: "/ month", note: "Billed monthly" },
      yearly: {
        amount: usd(perMonthWhenYearly("pro")),
        per: "/ month, billed yearly",
        note: `${yearlyText("pro")}, save ${usd(yearlySavings("pro"))}`,
      },
    },
    blurb: "For creators and small brands on their own domain.",
    cta: "Go Pro",
    featured: true,
    lead: "Everything in Free, plus",
    items: [
      "1 custom domain you own, with automatic SSL",
      "3 pages",
      "No badge",
      "Unlimited saved themes",
      "1 year of analytics with referrers, devices and countries",
      "100 MB of uploads",
      versionHistoryItem(PLAN_LIMITS.pro.versionsKept),
    ],
  },
  {
    id: "studio",
    name: "Studio",
    price: {
      monthly: { amount: usd(PRICES.studio.monthly), per: "/ month", note: "Billed monthly" },
      yearly: {
        amount: usd(perMonthWhenYearly("studio")),
        per: "/ month, billed yearly",
        note: `${yearlyText("studio")}, save ${usd(yearlySavings("studio"))}`,
      },
    },
    blurb: "For agencies and teams running pages for others.",
    cta: "Start Studio",
    lead: "Everything in Pro, plus",
    items: [
      "15 pages and 15 custom domains you own",
      "Themes shared across pages",
      "1 GB of uploads",
    ],
  },
];

/** The comparison table on /pricing: one row per line of PLAN.md's table that ships in v1. */
export const COMPARISON: readonly { label: string; values: [string, string, string] }[] = [
  {
    label: "Price, billed monthly",
    values: [usd(0), monthlyText("pro"), monthlyText("studio")],
  },
  {
    label: "Price, billed yearly",
    values: [
      usd(0),
      `${yearlyText("pro")} (${perMonthBilledYearlyText("pro")})`,
      `${yearlyText("studio")} (${perMonthBilledYearlyText("studio")})`,
    ],
  },
  { label: "Pages", values: ["1", "3", "15"] },
  { label: "Blocks, themes and design options", values: ["All", "All", "All"] },
  { label: "Saved themes", values: ["3", "Unlimited", "Unlimited, shared across pages"] },
  {
    label: "Address",
    values: ["yourname.hydlnk.com", "+ 1 custom domain you own", "+ 15 custom domains you own"],
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
  {
    label: "Version history",
    values: [
      versionHistoryCell(PLAN_LIMITS.free.versionsKept),
      versionHistoryCell(PLAN_LIMITS.pro.versionsKept),
      versionHistoryCell(PLAN_LIMITS.studio.versionsKept),
    ],
  },
  { label: "Cut of your sales", values: ["None", "None", "None"] },
];
