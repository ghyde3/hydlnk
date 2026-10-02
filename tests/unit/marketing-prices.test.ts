import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ_GROUPS } from "@/components/marketing/faq-data";
import { COMPARISON, PLANS } from "@/components/marketing/plans";
import {
  MAX_YEARLY_SAVINGS_PERCENT,
  PRICES,
  monthlyText,
  perMonthBilledYearlyText,
  perMonthWhenYearly,
  priceSentence,
  usd,
  yearlySavings,
  yearlySavingsPercent,
  yearlyText,
} from "@/lib/marketing/prices";

/** The real prices (Gary, 2026-10-02). Changing a number here is a pricing decision. */
describe("marketing prices", () => {
  it("are Pro $9 a month or $60 a year, and Studio $20 a month or $180 a year", () => {
    expect(PRICES).toEqual({
      pro: { monthly: 9, yearly: 60 },
      studio: { monthly: 20, yearly: 180 },
    });
  });

  it("show a yearly price as a whole-dollar monthly figure that is always billed yearly", () => {
    expect(perMonthWhenYearly("pro")).toBe(5);
    expect(perMonthWhenYearly("studio")).toBe(15);
    expect(perMonthBilledYearlyText("pro")).toBe("$5/mo, billed yearly");
    expect(perMonthBilledYearlyText("studio")).toBe("$15/mo, billed yearly");
    for (const plan of ["pro", "studio"] as const) {
      expect(Number.isInteger(PRICES[plan].yearly / 12)).toBe(true);
    }
  });

  it("derive the saving from the numbers", () => {
    expect(yearlySavings("pro")).toBe(48);
    expect(yearlySavings("studio")).toBe(60);
    expect(yearlySavingsPercent("pro")).toBe(44);
    expect(yearlySavingsPercent("studio")).toBe(25);
    expect(MAX_YEARLY_SAVINGS_PERCENT).toBe(44);
  });

  it("format as the copy uses them", () => {
    expect(usd(0)).toBe("$0");
    expect(usd(4.1666)).toBe("$4.17");
    expect(monthlyText("pro")).toBe("$9 a month");
    expect(yearlyText("studio")).toBe("$180 a year");
    expect(priceSentence("pro")).toBe("$9 a month, or $60 a year ($5/mo, billed yearly)");
    expect(priceSentence("studio")).toBe("$20 a month, or $180 a year ($15/mo, billed yearly)");
  });
});

describe("plan cards and comparison read the same numbers", () => {
  const plan = (id: string) => PLANS.find((candidate) => candidate.id === id)!;

  it("Free costs $0 in both billing views", () => {
    expect(plan("free").price.monthly).toBe(plan("free").price.yearly);
    expect(plan("free").price.monthly.amount).toBe("$0");
  });

  it("Pro and Studio show the monthly price, and the yearly one as $/mo billed yearly", () => {
    expect(plan("pro").price.monthly).toMatchObject({ amount: "$9", note: "Billed monthly" });
    expect(plan("pro").price.yearly).toMatchObject({
      amount: "$5",
      per: "/ month, billed yearly",
      note: "$60 a year, save $48",
    });
    expect(plan("studio").price.monthly).toMatchObject({ amount: "$20", note: "Billed monthly" });
    expect(plan("studio").price.yearly).toMatchObject({
      amount: "$15",
      per: "/ month, billed yearly",
      note: "$180 a year, save $60",
    });
  });

  it("the comparison table lists both billing periods", () => {
    const row = (label: string) => COMPARISON.find((candidate) => candidate.label === label)!;
    expect(row("Price, billed monthly").values).toEqual(["$0", "$9 a month", "$20 a month"]);
    expect(row("Price, billed yearly").values).toEqual([
      "$0",
      "$60 a year ($5/mo, billed yearly)",
      "$180 a year ($15/mo, billed yearly)",
    ]);
  });

  it("the FAQ answer (which feeds the FAQPage structured data) quotes the same prices", () => {
    const answers = FAQ_GROUPS.flatMap((group) => group.items).map((item) => item.answer);
    const priceAnswer = answers.find((answer) => answer.includes(priceSentence("pro")));
    expect(priceAnswer).toContain(priceSentence("studio"));
  });
});

/**
 * One module owns the numbers: no marketing source file may write a dollar amount itself (a stale
 * "$5" in a sentence is how the old prices would survive a change here). Tests are not scanned, so
 * they can still assert on the rendered text.
 */
describe("no hard-coded dollar amounts in the marketing site", () => {
  const ROOTS = ["src/app/(marketing)", "src/components/marketing", "src/lib/marketing"];
  const SKIP = "src/lib/marketing/prices.ts";

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("only src/lib/marketing/prices.ts has them", () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap((root) => sources(root))) {
      if (relative(process.cwd(), file) === SKIP) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/\$\d/.test(line) || /~\s?\$/.test(line)) {
            offenders.push(`${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
