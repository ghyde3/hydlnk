import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ_GROUPS } from "@/components/marketing/faq-data";
import { COMPARISON, PLANS } from "@/components/marketing/plans";
import { PLAN_LIMITS, PLAN_IDS } from "@/lib/limits";
import {
  pagesPerSiteCell,
  pagesPerSiteItem,
  pagesPerSiteSentence,
  sitesPerPlanSentence,
  sitesText,
} from "@/lib/marketing/plan-limits";

/**
 * M11-11 (marketing half): pricing states sites per plan (1, 3, 15) and pages per site (Home and 2,
 * 10, Unlimited), and every number comes from the limits table: a change there changes the copy,
 * and the copy has no number of its own.
 */

describe("M11-11 the limit wording reads the limits table", () => {
  it("sites per plan are the table's `pages` (1, 3, 15) and show their unit", () => {
    expect(PLAN_IDS.map((plan) => sitesText(plan))).toEqual(["1 site", "3 sites", "15 sites"]);
    for (const plan of PLAN_IDS) expect(sitesText(plan)).toContain(String(PLAN_LIMITS[plan].pages));
  });

  it("pages per site are Home and 2, 10 and Unlimited, from `pagesPerSite`", () => {
    expect(PLAN_IDS.map((plan) => pagesPerSiteCell(plan))).toEqual([
      "Home and 2",
      "10",
      "Unlimited",
    ]);
    expect(pagesPerSiteCell("free")).toContain(String(PLAN_LIMITS.free.pagesPerSite - 1));
    expect(pagesPerSiteCell("pro")).toBe(String(PLAN_LIMITS.pro.pagesPerSite));
    // Studio's fair-use cap of 500 is never shown as a number.
    expect(PLAN_LIMITS.studio.pagesPerSite).toBeGreaterThan(100);
    expect(pagesPerSiteCell("studio")).toBe("Unlimited");
    expect(pagesPerSiteItem("studio")).not.toMatch(/\d/);
  });

  it("the sentences name every plan's number", () => {
    expect(sitesPerPlanSentence()).toBe(
      "Free includes 1 site, Pro includes 3 and Studio includes 15",
    );
    expect(pagesPerSiteSentence()).toBe(
      "Free sites have 3 pages, Home and 2 more. Pro sites have up to 10, and Studio sites have no practical limit",
    );
  });
});

describe("M11-11 the pricing comparison and the plan cards", () => {
  const row = (label: string) => COMPARISON.find((candidate) => candidate.label === label);

  it("has a Sites row and a Pages per site row, and no row called Pages", () => {
    expect(row("Sites")?.values).toEqual(["1", "3", "15"]);
    expect(row("Pages per site")?.values).toEqual(["Home and 2", "10", "Unlimited"]);
    expect(row("Pages")).toBeUndefined();
  });

  it("the cards list the sites and the pages per site of each plan", () => {
    const items = (id: string) => PLANS.find((plan) => plan.id === id)!.items;
    expect(items("free")).toEqual(expect.arrayContaining(["1 site", "Home and 2 more pages"]));
    expect(items("pro")).toEqual(expect.arrayContaining(["3 sites", "Up to 10 pages per site"]));
    expect(items("studio")).toEqual(
      expect.arrayContaining([
        "15 sites and 15 custom domains you own",
        "Unlimited pages per site",
      ]),
    );
  });

  it("no card or row still describes a page limit per plan", () => {
    const text = [
      ...PLANS.flatMap((plan) => [plan.blurb, ...plan.items, ...(plan.dash ?? [])]),
      ...COMPARISON.flatMap((r) => [r.label, ...r.values]),
    ].join("\n");
    expect(text).not.toMatch(/\b(1|3|15) pages\b|\bone page\b/i);
  });
});

describe("M11-11 the FAQ and the guide", () => {
  const answers = FAQ_GROUPS.flatMap((group) => group.items);

  it("answers how many sites and pages each plan includes, in the table's numbers", () => {
    const item = answers.find((candidate) => /how many sites and pages/i.test(candidate.question));
    expect(item?.answer).toContain(sitesPerPlanSentence());
    expect(item?.answer).toContain(pagesPerSiteSentence());
  });

  it("does not say a plan has a number of pages per account anywhere in the FAQ", () => {
    // The one answer that spells out the limits is the sites and pages one, checked above.
    const stale = answers.filter(
      (item) =>
        !/how many sites and pages/i.test(item.question) &&
        /\b(one|1|three|3|15) pages?\b.*\b(plan|Pro|Studio|Free)\b|Free includes one page/i.test(
          item.answer,
        ),
    );
    expect(stale.map((item) => item.question)).toEqual([]);
  });

  it("the plans guide reads the same table, not retyped numbers", () => {
    const source = readFileSync(
      resolve(__dirname, "../../src/components/marketing/guides/plans-and-billing.tsx"),
      "utf8",
    );
    expect(source).toContain("pagesPerSiteText");
    expect(source).not.toMatch(/<td>(1|3|15) pages?\b/);
  });
});
