import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planForPriceId, priceIdFor, type PriceIds } from "@/lib/billing/price-map";
import {
  BILLING_MESSAGES,
  PLAN_PRICES,
  billingMessage,
  formatBandPrice,
  formatCardPrice,
  formatFreePrice,
  formatLandingPrice,
  formatPerMonth,
  formatPrice,
  lowestPaidPerMonth,
  monthlyEquivalent,
  isBillablePlan,
  isBillingInterval,
  isDowngradeTarget,
  isPortalIntent,
} from "@/lib/billing/prices";

const PRICES: PriceIds = {
  proMonthly: "price_pro_m",
  proYearly: "price_pro_y",
  studioMonthly: "price_studio_m",
  studioYearly: "price_studio_y",
};

describe("M4-04 / M4-06 the four price ids", () => {
  const TABLE = [
    ["pro", "month", "price_pro_m"],
    ["pro", "year", "price_pro_y"],
    ["studio", "month", "price_studio_m"],
    ["studio", "year", "price_studio_y"],
  ] as const;

  for (const [plan, interval, id] of TABLE) {
    it(`${plan} ${interval}ly is ${id}, both ways`, () => {
      expect(priceIdFor(PRICES, plan, interval)).toBe(id);
      expect(planForPriceId(PRICES, id)).toEqual({ plan, interval });
    });
  }

  it("an unknown, empty or missing price id maps to nothing", () => {
    expect(planForPriceId(PRICES, "price_x")).toBeNull();
    expect(planForPriceId(PRICES, "")).toBeNull();
    expect(planForPriceId(PRICES, null)).toBeNull();
    expect(planForPriceId(PRICES, undefined)).toBeNull();
  });
});

describe("M4-06 the request vocabulary is closed", () => {
  it("only pro and studio are billable plans, only month and year are intervals", () => {
    expect(["pro", "studio"].every(isBillablePlan)).toBe(true);
    for (const bad of ["free", "enterprise", "price_x", "", "PRO", null, undefined, 5]) {
      expect(isBillablePlan(bad), String(bad)).toBe(false);
    }
    expect(["month", "year"].every(isBillingInterval)).toBe(true);
    for (const bad of ["week", "monthly", "", null, undefined]) {
      expect(isBillingInterval(bad), String(bad)).toBe(false);
    }
  });

  it("only the four portal intents (and free or pro as a downgrade target) are accepted", () => {
    for (const intent of ["manage", "switch_yearly", "upgrade_studio", "downgrade"]) {
      expect(isPortalIntent(intent)).toBe(true);
    }
    for (const bad of ["cancel", "checkout", "", "Manage", null, undefined]) {
      expect(isPortalIntent(bad), String(bad)).toBe(false);
    }
    expect(isDowngradeTarget("free")).toBe(true);
    expect(isDowngradeTarget("pro")).toBe(true);
    expect(isDowngradeTarget("studio")).toBe(false);
  });
});

describe("M4-06 the display prices (decided 2026-10-02, docs/PLAN.md)", () => {
  it("Pro is $9 a month or $60 a year; Studio is $20 a month or $180 a year", () => {
    expect(PLAN_PRICES).toEqual({
      pro: { month: { amount: 9 }, year: { amount: 60 } },
      studio: { month: { amount: 20 }, year: { amount: 180 } },
    });
    expect(formatPrice("pro", "month")).toBe("$9/mo");
    expect(formatPrice("pro", "year")).toBe("$60/yr");
    expect(formatPrice("studio", "month")).toBe("$20/mo");
    expect(formatPrice("studio", "year")).toBe("$180/yr");
  });

  it("billed yearly comes to $5 a month for Pro and $15 a month for Studio", () => {
    expect(monthlyEquivalent("pro", "year")).toBe(5);
    expect(monthlyEquivalent("studio", "year")).toBe(15);
    expect(monthlyEquivalent("pro", "month")).toBe(9);
    expect(formatPerMonth("pro", "year")).toBe("$5/mo");
    expect(formatCardPrice("pro", "month")).toBe("$9/mo");
    expect(formatCardPrice("pro", "year")).toBe("$5/mo, billed yearly");
    expect(formatCardPrice("studio", "month")).toBe("$20/mo");
    expect(formatCardPrice("studio", "year")).toBe("$15/mo, billed yearly");
    expect(formatCardPrice("free", "year")).toBe(formatFreePrice());
    expect(formatFreePrice()).toBe("$0");
  });

  it("the band, the landing page and the hero line are formatted from the same table", () => {
    expect(formatBandPrice("pro", "month")).toBe("$9 / month · billed monthly");
    expect(formatBandPrice("studio", "year")).toBe("$180 / year · billed yearly");
    expect(formatLandingPrice("pro")).toEqual({
      price: "$9",
      per: "/ month · or $60 a year ($5/mo billed yearly)",
    });
    expect(formatLandingPrice("studio")).toEqual({
      price: "$20",
      per: "/ month · or $180 a year ($15/mo billed yearly)",
    });
    expect(lowestPaidPerMonth()).toBe("$5/mo");
  });

  it("every plan has a yearly price that is cheaper per month than its monthly price", () => {
    for (const plan of ["pro", "studio"] as const) {
      expect(monthlyEquivalent(plan, "year")).toBeLessThan(monthlyEquivalent(plan, "month"));
    }
  });

  it("billingMessage knows only the codes the endpoints send", () => {
    for (const code of Object.keys(BILLING_MESSAGES)) expect(billingMessage(code)).toBeTruthy();
    expect(billingMessage("no_customer")).toBe("Nothing to manage yet.");
    expect(billingMessage("constructor")).toBeNull();
    expect(billingMessage("<script>")).toBeNull();
    expect(billingMessage(null)).toBeNull();
  });
});

describe("one price table: no component spells a price amount", () => {
  const root = resolve(process.cwd(), "src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(name) && !name.endsWith(".types.ts") ? [path] : [];
    });
  const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;

  it("src/ writes a dollar amount only in src/lib/billing/prices.ts", () => {
    const offenders = walk(root)
      .filter((path) => relative(root, path) !== join("lib", "billing", "prices.ts"))
      .filter((path) => /\$\d/.test(readFileSync(path, "utf8").replace(COMMENTS, "")))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
