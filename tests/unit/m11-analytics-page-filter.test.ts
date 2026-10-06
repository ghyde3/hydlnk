import { describe, expect, it, vi } from "vitest";
import {
  rollupRawEvents,
  type DailyRow,
  type DimRow,
  type RawEvent,
} from "@/lib/analytics/dashboard/aggregate";
import {
  HOME_SUB_PAGE_ID,
  buildPageOptions,
  parsePageFilter,
} from "@/lib/analytics/dashboard/page-filter";
import { dailyCsv, exportHref, linksCsv } from "@/lib/analytics/export";
import { loadExport, loadStats, type PageFilter, type StatsSource } from "@/lib/analytics/stats";

/**
 * M11-09: the Analytics page filter. `parsePageFilter` and `buildPageOptions` decide what the select
 * offers; `loadStats` and `loadExport` pass the filter to every read of the source (rollup rows,
 * breakdowns and raw events) and name the links of every page; the CSV files carry a page column.
 */

const NOW = new Date("2026-09-30T12:00:00Z");
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const PAGE = "00000000-0000-4000-8000-0000000000b9";
const ITEMS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIRS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("M11-09 parsePageFilter", () => {
  it("takes all, home and a UUID; anything else is all", () => {
    expect(parsePageFilter("all")).toBe("all");
    expect(parsePageFilter("home")).toBe("home");
    expect(parsePageFilter(ITEMS)).toBe(ITEMS);
    expect(parsePageFilter(ITEMS.toUpperCase())).toBe(ITEMS);
    for (const bad of [
      undefined,
      null,
      "",
      "Home",
      "items",
      "x".repeat(40),
      "1; drop table",
      "../",
    ]) {
      expect(parsePageFilter(bad as never), String(bad)).toBe("all");
    }
    expect(parsePageFilter(["home", "all"])).toBe("home");
  });

  it("reads the nil UUID (Home's rollup key) as home", () => {
    expect(parsePageFilter(HOME_SUB_PAGE_ID)).toBe("home");
  });
});

describe("M11-09 buildPageOptions", () => {
  const subs = [
    { id: ITEMS, title: "Items for sale" },
    { id: DIRS, title: "Directions" },
  ];

  it("lists All pages, Home and each page by its title", () => {
    expect(buildPageOptions(subs, [], "all")).toEqual([
      { value: "all", label: "All pages" },
      { value: "home", label: "Home" },
      { value: ITEMS, label: "Items for sale" },
      { value: DIRS, label: "Directions" },
    ]);
  });

  it("adds Deleted page for history of an id that is no longer a page, once per id", () => {
    const options = buildPageOptions(subs, [ITEMS, GONE, GONE, HOME_SUB_PAGE_ID], "all");
    expect(options.map((o) => o.label)).toEqual([
      "All pages",
      "Home",
      "Items for sale",
      "Directions",
      "Deleted page",
    ]);
    expect(options.at(-1)?.value).toBe(GONE);
  });

  it("numbers several deleted pages apart, and keeps a selected unknown id in the list", () => {
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const labels = buildPageOptions([], [GONE, other], "all").map((o) => o.label);
    expect(labels.slice(2)).toEqual(["Deleted page", "Deleted page 2"]);
    const selected = buildPageOptions([], [], other);
    expect(selected.at(-1)).toEqual({ value: other, label: "Deleted page" });
  });
});

describe("M11-09 rollupRawEvents counts uniques per page, like the nightly rollup", () => {
  const event = (over: Partial<RawEvent>): RawEvent => ({
    ts: "2026-09-30T08:00:00Z",
    block_id: "",
    type: "view",
    referrer: null,
    device: "mobile",
    country: "US",
    visitor_hash: "h1",
    ...over,
  });

  it("a visitor on two pages is one unique on each page, and the pages sum", () => {
    const { daily } = rollupRawEvents([
      event({ visitor_hash: "h1" }),
      event({ visitor_hash: "h1", sub_page_id: ITEMS }),
      event({ visitor_hash: "h2", sub_page_id: ITEMS }),
    ]);
    const pageLevel = daily.find((row) => row.block_id === "");
    expect(pageLevel).toMatchObject({ views: 3, uniques: 3 });
  });

  it("without a page key it is the same as before: one row per day and block", () => {
    const { daily } = rollupRawEvents([
      event({ visitor_hash: "h1" }),
      event({ visitor_hash: "h1" }),
      event({ type: "click", block_id: "link-1", visitor_hash: "h1" }),
    ]);
    expect(daily).toEqual([
      { day: "2026-09-30", block_id: "", views: 2, clicks: 1, uniques: 1 },
      { day: "2026-09-30", block_id: "link-1", views: 0, clicks: 1, uniques: 1 },
    ]);
  });
});

// loadStats and loadExport ---------------------------------------------------------------------

const PUBLISHED_HOME = {
  blocks: [
    { id: "home-link-0001", type: "link", label: "Book a session", url: "https://a.example/" },
  ],
};
const PUBLISHED_ITEMS = {
  path: "items",
  title: "Items for sale",
  blocks: [{ id: "item-link-0001", type: "link", label: "Armchair", url: "https://b.example/" }],
};

/** daily rows per page: Home 10 views / 2 clicks, items 4 views / 3 clicks, a deleted page 1 view. */
const ROLLUP: (DailyRow & { sub: string })[] = [
  { sub: HOME_SUB_PAGE_ID, day: "2026-09-27", block_id: "", views: 10, clicks: 2, uniques: 8 },
  {
    sub: HOME_SUB_PAGE_ID,
    day: "2026-09-27",
    block_id: "home-link-0001",
    views: 0,
    clicks: 2,
    uniques: 2,
  },
  { sub: ITEMS, day: "2026-09-27", block_id: "", views: 4, clicks: 3, uniques: 3 },
  { sub: ITEMS, day: "2026-09-27", block_id: "item-link-0001", views: 0, clicks: 3, uniques: 3 },
  { sub: GONE, day: "2026-09-27", block_id: "", views: 1, clicks: 0, uniques: 1 },
];

function makeSource() {
  const seen: { dailyStats: PageFilter[]; dailyDims: PageFilter[]; rawEvents: PageFilter[] } = {
    dailyStats: [],
    dailyDims: [],
    rawEvents: [],
  };
  const matches = (sub: string, filter: PageFilter) =>
    filter === "all" || (filter === "home" ? sub === HOME_SUB_PAGE_ID : sub === filter);
  const source: StatsSource = {
    async resolvePage(ownerId, pageId) {
      if (ownerId !== OWNER || pageId !== PAGE) return null;
      return {
        plan: "pro",
        published: PUBLISHED_HOME,
        subPages: [{ id: ITEMS, title: "Items for sale", published: PUBLISHED_ITEMS }],
      };
    },
    async hasActivity() {
      return true;
    },
    async dailyStats(_page, from, to, filter = "all") {
      seen.dailyStats.push(filter);
      return ROLLUP.filter((r) => r.day >= from && r.day <= to && matches(r.sub, filter)).map(
        ({ sub: _sub, ...row }) => row,
      );
    },
    async dailyDims(_page, _from, _to, filter = "all"): Promise<DimRow[]> {
      seen.dailyDims.push(filter);
      return [];
    },
    async rawEvents(_page, _from, filter = "all") {
      seen.rawEvents.push(filter);
      return [];
    },
    historicPageIds: vi.fn(async () => [ITEMS, GONE]),
  };
  return { source, seen };
}

const input = (page?: PageFilter) => ({
  ownerId: OWNER,
  pageId: PAGE,
  range: 30 as const,
  now: NOW,
  ...(page ? { page } : {}),
});

async function stats(page?: PageFilter) {
  const { source, seen } = makeSource();
  const result = await loadStats(input(page), source);
  if (!result.ok) throw new Error(`expected data, got ${result.error}`);
  return { data: result.data, seen };
}

describe("M11-09 loadStats with a page filter", () => {
  it("All pages sums every page and offers every page, plus a Deleted page", async () => {
    const { data, seen } = await stats();
    expect(data.pageFilter).toBe("all");
    expect(data.kpis.views).toBe(15);
    expect(data.kpis.clicks).toBe(5);
    expect(data.pages.map((p) => p.label)).toEqual([
      "All pages",
      "Home",
      "Items for sale",
      "Deleted page",
    ]);
    expect(seen.dailyStats).toEqual(["all"]);
  });

  it("Home reads Home's rows only, through every read", async () => {
    const { data, seen } = await stats("home");
    expect(data.pageFilter).toBe("home");
    expect(data.kpis.views).toBe(10);
    expect(data.kpis.clicks).toBe(2);
    expect(seen).toEqual({ dailyStats: ["home"], dailyDims: ["home"], rawEvents: ["home"] });
  });

  it("a sub-page reads that page's rows and names its links by their labels", async () => {
    const { data, seen } = await stats(ITEMS);
    expect(data.kpis.views).toBe(4);
    expect(data.kpis.clicks).toBe(3);
    expect(data.links.map((l) => l.label)).toEqual(["Armchair"]);
    expect(seen.rawEvents).toEqual([ITEMS]);
  });

  it("a deleted page keeps its history under the label Deleted page", async () => {
    const { data } = await stats(GONE);
    expect(data.kpis.views).toBe(1);
    expect(data.pages.find((p) => p.value === GONE)?.label).toBe("Deleted page");
  });

  it("a page with no rows shows real zeros, not the sample set", async () => {
    const { data } = await stats("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(data.sample).toBe(false);
    expect(data.kpis.views).toBe(0);
  });

  it("clicks on a sub-page's link are named, never Removed link", async () => {
    const { data } = await stats();
    expect(data.links.map((l) => l.label).sort()).toEqual(["Armchair", "Book a session"]);
  });
});

describe("M11-09 the CSV export and the page column", () => {
  it("names the filter in the daily file and the holding page in the links file", async () => {
    const { source } = makeSource();
    const result = await loadExport(input(ITEMS), source);
    if (!result.ok) throw new Error("export failed");
    expect(result.pageLabel).toBe("Items for sale");
    const daily = dailyCsv(result.days, result.pageLabel).split("\r\n");
    expect(daily[0]).toBe("﻿date,page,views,clicks,uniques");
    expect(daily[1]).toMatch(/^2026-09-01,Items for sale,/);

    const all = await loadExport(input(), source);
    if (!all.ok) throw new Error("export failed");
    expect(all.pageLabel).toBe("All pages");
    const links = linksCsv(all.links).split("\r\n");
    expect(links[0]).toBe("﻿link_id,link,page,clicks");
    expect(links).toContain("item-link-0001,Armchair,Items for sale,3");
    expect(links).toContain("home-link-0001,Book a session,Home,2");
  });

  it("the export link carries the filter, and says nothing for all pages", () => {
    expect(exportHref("daily", 30)).toBe("/analytics/export?kind=daily&range=30");
    expect(exportHref("daily", 30, ITEMS)).toBe(
      `/analytics/export?kind=daily&range=30&filter=${ITEMS}`,
    );
  });
});
