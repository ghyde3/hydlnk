import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ_GROUPS } from "@/components/marketing/faq-data";

/** M12-09: the features page and the FAQ describe sites with pages, the new blocks and the templates. */

const answers = FAQ_GROUPS.flatMap((group) => group.items);
const features = readFileSync(
  resolve(process.cwd(), "src/app/(marketing)/features/page.tsx"),
  "utf8",
);

describe("M12-09 marketing copy", () => {
  it("the FAQ answers pages, the price list and hours blocks, and the three templates", () => {
    const text = (pattern: RegExp) =>
      answers.find((item) => pattern.test(item.question))?.answer ?? "";
    expect(text(/more than one page/i)).toMatch(/Home/);
    expect(text(/price list/i)).toMatch(/opening hours|hours block/i);
    const templates = text(/templates/i);
    for (const name of ["Garage sale", "Small business", "Musician"])
      expect(templates).toContain(name);
  });

  it("the features page has a sites-with-pages section that reads its page counts from the limits table", () => {
    expect(features).toContain('id="pages"');
    expect(features).toContain('pagesPerSiteText("free")');
    expect(features).toContain('pagesPerSiteText("pro")');
    expect(features).toContain('pagesPerSiteText("studio")');
    for (const name of [
      "Garage sale",
      "Small business",
      "Musician",
      "Items and prices",
      "Opening hours",
    ]) {
      expect(features).toContain(name);
    }
  });

  it("no new copy says Studio has 500 pages or quotes a price", () => {
    const all = JSON.stringify(answers) + features;
    expect(all).not.toMatch(/\b500 pages\b/);
  });
});
