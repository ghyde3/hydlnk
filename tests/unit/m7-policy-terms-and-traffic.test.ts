import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toTrafficFlagRow, type RawTrafficFlag } from "@/lib/analytics/admin/view";

/**
 * M7-10 and M7-11: the Free-plan traffic rule is two complete UTC calendar months in a row, and the
 * Terms, the admin list and every place that describes the rule say so. These are source scans (the
 * rule itself is pgTAP 140-traffic-two-months, the screens are Playwright).
 */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...filesUnder(path, pattern));
    else if (pattern.test(name)) out.push(path);
  }
  return out;
}

/** Whitespace and comment markers folded to single spaces, so a sentence that wraps still matches. */
const flat = (text: string) =>
  text.replace(/\s*\n\s*(?:\*|--|\/\/)?\s*/g, " ").replace(/\s+/g, " ");

const TERMS = "src/app/(marketing)/terms/page.tsx";

/** The five paragraphs Gary approved for the Free plan traffic section (curly apostrophes as written). */
const PARAGRAPHS = [
  "Your page keeps serving when traffic spikes, on every plan. A post that takes off is the whole point of a link in bio, and we will never switch off your page for being popular.",
  "HYDLNK is a small company running on modest infrastructure, and the Free plan is generous by choice. We ask for the same good faith in return.",
  "If a Free page gets more than about 100,000 views a month for two months in a row, we’ll take a look. A view is one page load by a person. We don’t count bots, crawlers, link previews or our own checks. One big week never triggers a review.",
  "When we review a page, we check that it fits these terms. If it does and the traffic is here to stay, we’ll email you about a paid plan and give you at least 30 days to decide. Your page keeps serving the whole time.",
  "We may limit or suspend a page, sometimes without notice, if it’s used for automated or fake traffic, scraping, load testing, hosting files or media for other sites, or anything else that slows HYDLNK down for everyone. If you’re planning something big, write to us first. We’d rather help.",
];

function trafficSection(): string {
  const source = read(TERMS);
  const start = source.indexOf('<h2 id="traffic">');
  const end = source.indexOf('<h2 id="payments">');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("M7-11 the Terms say the two-month rule", () => {
  it("the Free plan traffic heading and anchor stay, followed by exactly the five approved paragraphs and nothing else", () => {
    const section = trafficSection();
    expect(section.startsWith('<h2 id="traffic">Free plan traffic</h2>')).toBe(true);
    const body = section.slice('<h2 id="traffic">Free plan traffic</h2>'.length);
    const paragraphs = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) =>
      m[1]!.replace(/\s+/g, " ").trim(),
    );
    expect(paragraphs).toEqual(PARAGRAPHS);
    // Nothing between or around the paragraphs: no list, link, bold or second heading.
    expect(body.replace(/<p>[\s\S]*?<\/p>/g, "").trim()).toBe("");
    for (const paragraph of paragraphs) expect(paragraph).not.toMatch(/[<>{}]/);
  });

  it("the contents link and the order of the sections are unchanged", () => {
    const source = read(TERMS);
    const toc = [...source.matchAll(/^\s*\["([a-z-]+)", "([^"]+)"\],?$/gm)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(toc.map(([id]) => id)).toEqual([
      "agreement",
      "eligibility",
      "accounts",
      "content",
      "acceptable-use",
      "reports",
      "copyright",
      "traffic",
      "payments",
      "domains",
      "service",
      "third-parties",
      "ending",
      "disclaimers",
      "liability",
      "indemnity",
      "law",
      "changes",
      "contact",
    ]);
    expect(toc.find(([id]) => id === "traffic")).toEqual(["traffic", "Free plan traffic"]);
    const headings = [...source.matchAll(/<h2 id="([a-z-]+)">/g)].map((m) => m[1]);
    expect(headings).toEqual(toc.map(([id]) => id));
  });

  it("the number 100,000 appears in the marketing site and the legal pages only in that paragraph", () => {
    const hits: string[] = [];
    for (const file of [
      ...filesUnder("src/app/(marketing)", /\.(ts|tsx)$/),
      ...filesUnder("src/components/marketing", /\.(ts|tsx)$/),
    ]) {
      const count = (read(file).match(/100,000|100000|100k/gi) ?? []).length;
      if (count > 0) hits.push(`${relative(ROOT, file)} x${count}`);
    }
    expect(hits).toEqual([`${TERMS} x1`]);
    expect(PARAGRAPHS[2]).toContain("100,000");
  });

  it("the FAQ answer about traffic spikes stays as it is, and is consistent with the Terms", () => {
    expect(read("src/components/marketing/faq-data.ts")).toContain(
      "It keeps working. Published pages are stored close to your visitors and built for traffic spikes, on every plan.",
    );
  });
});

describe("M7-10 the rule is written down the same way everywhere", () => {
  const RULE_FILES = [
    "src/lib/analytics/SCHEMA.md",
    "supabase/migrations/20261007000001_traffic_two_months.sql",
    "src/lib/analytics/admin/view.ts",
    "src/lib/analytics/admin/queries.ts",
    "src/lib/analytics/admin/review-flag-action.ts",
    "src/app/(editor)/app/admin/traffic/page.tsx",
  ];

  it.each(RULE_FILES)(
    "%s says two complete UTC calendar months and the strict threshold",
    (file) => {
      const text = flat(read(file));
      expect(text).toMatch(/two complete UTC calendar months/);
      expect(text).toMatch(/strictly|strict/i);
    },
  );

  it("no sentence about the high-traffic flag still sums 30 days", () => {
    // (The new migration's header names the old rule on purpose, to say what it replaces.)
    const files = [
      ...filesUnder("src/lib/analytics/admin", /\.(ts|tsx)$/),
      ...filesUnder("src/components/admin", /\.(ts|tsx)$/),
      ...filesUnder("src/app/(editor)/app/admin", /\.(ts|tsx)$/),
    ];
    const OLD = [
      /Views, 30 days/i,
      /views in the last 30 days/i,
      /\bin the last 30 days/i,
      /over the last 30 days/i,
      /30 UTC days/i,
      /30 days ending/i,
      /trailing 30/i,
      /sums? (?:the )?(?:page-level )?views over the (?:last )?30/i,
    ];
    for (const file of files) {
      const text = flat(read(file));
      for (const pattern of OLD) expect(text, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
    // SCHEMA.md also says "Free sees the last 30 UTC days" about the dashboard window, which is a
    // different rule: only the flag's own rows and section are held to the new wording.
    const schema = read("src/lib/analytics/SCHEMA.md");
    const section = schema.slice(schema.indexOf("## High-traffic flag"));
    const rows = schema
      .split("\n")
      .filter((line) => /flag_high_traffic_pages|admin_traffic_flags|traffic_flags/.test(line))
      .join("\n");
    for (const text of [flat(section), flat(rows)]) {
      for (const pattern of OLD) expect(text, `SCHEMA.md matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("the old migration is untouched: it still describes the rule it shipped with (history is not rewritten)", () => {
    expect(read("supabase/migrations/20261004000004_traffic_flags.sql")).toContain("30 UTC days");
  });

  it("the admin list shows both months, and a flag made by the old rule has a dash", () => {
    const table = read("src/components/admin/traffic-table.tsx");
    expect(table).toContain("Views, last month");
    expect(table).toContain("Views, month before");
    expect(table).toContain("data-views-previous");
    expect(read("src/app/(editor)/app/admin/traffic/page.tsx")).toContain(
      "Free pages with more than 100,000 views in each of the last two full months.",
    );
  });
});

describe("M7-10 TrafficFlagRow carries the earlier month", () => {
  const raw: RawTrafficFlag = {
    flag_id: "f",
    page_id: "p",
    handle: "mara",
    owner_id: "o",
    owner_email: "o@x.test",
    plan: "free",
    views: 100001,
    views_previous_month: 100002,
    window_start: "2026-08-01",
    window_end: "2026-09-30",
    flagged_at: "2026-10-01T00:50:00Z",
    reviewed_at: null,
  };

  it("maps views to the later month and views_previous_month to viewsPreviousMonth", () => {
    expect(toTrafficFlagRow(raw)).toMatchObject({ views: 100001, viewsPreviousMonth: 100002 });
    expect(toTrafficFlagRow({ ...raw, views: 5, views_previous_month: 0 })).toMatchObject({
      views: 5,
      viewsPreviousMonth: 0,
    });
  });

  it("is null for a flag made by the old rule (a null column, or none at all)", () => {
    expect(toTrafficFlagRow({ ...raw, views_previous_month: null }).viewsPreviousMonth).toBeNull();
    const old: RawTrafficFlag = { ...raw };
    delete old.views_previous_month;
    expect(toTrafficFlagRow(old).viewsPreviousMonth).toBeNull();
  });
});
