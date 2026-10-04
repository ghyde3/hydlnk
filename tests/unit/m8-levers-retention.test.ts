import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RAW_EVENT_RETENTION_DAYS } from "@/lib/analytics/retention";

/**
 * M8-12: raw events are kept 60 days. One constant, `RAW_EVENT_RETENTION_DAYS`, is what the copy
 * says; the SQL that does the deleting is the newest migration that defines `purge_old_events`.
 * This file fails when the two drift apart, when a page stops using the constant, and when a
 * sentence in src/, docs/ or supabase/ says raw events, views or clicks are kept 90 days.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const ROOT = process.cwd();

function walk(path: string, out: string[] = []): string[] {
  const full = resolve(ROOT, path);
  const stat = statSync(full);
  if (stat.isDirectory()) {
    for (const name of readdirSync(full)) {
      if (name === "node_modules" || name === ".next") continue;
      walk(join(path, name), out);
    }
  } else {
    out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

/** The newest migration that creates or replaces `public.purge_old_events`, and the day count in its cutoff. */
function newestPurgeDefinition(): { file: string; days: number } {
  const files = readdirSync(resolve(ROOT, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const defining = files.filter((name) =>
    /create\s+(?:or\s+replace\s+)?function\s+public\.purge_old_events\s*\(/i.test(
      read(`supabase/migrations/${name}`),
    ),
  );
  const file = defining.at(-1);
  if (!file) throw new Error("no migration defines public.purge_old_events");
  const sql = read(`supabase/migrations/${file}`);
  const match =
    /v_cutoff\s+timestamptz\s*:=\s*\(\(now\(\)\s+at\s+time\s+zone\s+'utc'\)::date\s*-\s*(\d+)\)/i.exec(
      sql,
    );
  if (!match) throw new Error(`${file}: the cutoff of purge_old_events was not found`);
  return { file, days: Number(match[1]) };
}

describe("M8-12 the retention constant and the SQL agree", () => {
  it("RAW_EVENT_RETENTION_DAYS is 60", () => {
    expect(RAW_EVENT_RETENTION_DAYS).toBe(60);
  });

  it("the newest migration that defines purge_old_events deletes after exactly that many days", () => {
    const { file, days } = newestPurgeDefinition();
    expect(file).toBe("20261008000001_events_60_days.sql");
    expect(days).toBe(RAW_EVENT_RETENTION_DAYS);
  });

  it("the migration keeps the function's contract: definer, empty search_path, service_role only, rollup first", () => {
    const sql = read("supabase/migrations/20261008000001_events_60_days.sql");
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(
      /revoke all on function public\.purge_old_events\(\) from public, anon, authenticated;/i,
    );
    expect(sql).toMatch(/grant execute on function public\.purge_old_events\(\) to service_role;/i);
    expect(sql).toMatch(/perform public\.rollup_daily_stats\(v_day\)/i);
    // The cron job is not touched by this migration: its schedule stays with the analytics one.
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(read("supabase/migrations/20261004000002_analytics.sql")).toMatch(
      /cron\.schedule\('purge-old-events', '30 0 \* \* \*', 'select public\.purge_old_events\(\)'\)/,
    );
    expect(sql).toMatch(/comment on function public\.purge_old_events\(\) is\s+'[^']*60 UTC days/i);
  });
});

describe("M8-12 the copy renders the constant", () => {
  it.each([
    "src/app/(marketing)/privacy/page.tsx",
    "src/app/(marketing)/link-analytics/page.tsx",
    "src/components/marketing/guides/understanding-analytics.tsx",
  ])("%s imports RAW_EVENT_RETENTION_DAYS and carries no literal day count of its own", (file) => {
    const source = read(file);
    expect(source).toContain('from "@/lib/analytics/retention"');
    expect(source).toMatch(/RAW_EVENT_RETENTION_DAYS/);
    expect(source).not.toMatch(/\b(?:60|90) days,? then\b/);
    expect(source).not.toMatch(/kept for (?:60|90) days/);
  });

  it("the privacy page says 60 days twice: the Retention sentence and the retention list", async () => {
    const { default: PrivacyPage } = await import("@/app/(marketing)/privacy/page");
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toMatch(
      /These individual events are kept for 60 days, then combined into daily totals/,
    );
    expect(text).toMatch(/Individual visitor events\s*:\s*60 days, then only daily totals remain/);
    expect(text).not.toMatch(/\b90 days\b/);
  });

  it("the Link analytics page FAQ and the guide say 60 days", async () => {
    const { default: LinkAnalytics } = await import("@/app/(marketing)/link-analytics/page");
    const page = renderToStaticMarkup(createElement(LinkAnalytics))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(page).toContain(
      "Individual views and clicks are kept for 60 days, then combined into daily totals.",
    );

    const { understandingAnalytics } =
      await import("@/components/marketing/guides/understanding-analytics");
    const guide = renderToStaticMarkup(
      createElement("div", null, understandingAnalytics.content),
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(guide).toMatch(/clicks are kept for 60 days and then combined into daily totals/);
  });
});

/**
 * No sentence says raw events, views or clicks are kept 90 days. The 'Last 90 days' range label, the
 * 90d button and prose about the ranges stay, so the patterns are about retention phrasing only:
 *
 *   - "kept / keep / retain(ed) / stored / purge(d)" within the same sentence of "90 days";
 *   - "90 days" followed in the same sentence by raw / retention / purge;
 *   - "90-day retention" and "90-day purge".
 *
 * Immutable history is out of scope: migrations older than the newest purge definition (they were
 * applied as they are, and the new migration supersedes them), and docs/features.json (a committed
 * feature is never reworded; its superseded literals are recorded in PROGRESS.md).
 */
const RETENTION_90: RegExp[] = [
  /\b(?:kept|keep|keeps|keeping|retain\w*|retention|stored|storing|purge[sd]?|purging)\b[^\n.]{0,80}\b90[- ]?days?\b/i,
  /\b90[- ]?days?\b[^\n.]{0,60}\b(?:raw|retention|purge[sd]?|purging)\b/i,
  /\b90[- ]day\s+(?:retention|purge)\b/i,
];

const TEXT_FILE = /\.(?:tsx?|md|mdx|sql|json|mjs)$/;

function scanTargets(): string[] {
  const { file: newest } = newestPurgeDefinition();
  return ["src", "docs", "supabase"]
    .flatMap((dir) => walk(dir))
    .filter((path) => TEXT_FILE.test(path))
    .filter((path) => path !== "docs/features.json")
    .filter((path) => {
      const name = relative("supabase/migrations", path);
      // A migration older than the newest purge definition is history.
      if (!name.startsWith("..")) return name >= newest;
      return true;
    })
    .filter((path) => !path.endsWith("database.types.ts"));
}

describe("M8-12 nothing says raw events are kept 90 days", () => {
  it("scans src/, docs/ and supabase/ (history excluded) and finds no such sentence", () => {
    const hits: string[] = [];
    for (const file of scanTargets()) {
      read(file)
        .split("\n")
        .forEach((line, index) => {
          if (RETENTION_90.some((pattern) => pattern.test(line))) {
            hits.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  it("the patterns do catch the sentences they are for, and let the ranges through", () => {
    for (const bad of [
      "Individual views and clicks are kept for 90 days, then combined into daily totals.",
      "Keep 90 days raw; pg_cron rolls them",
      "Raw events are kept for 90 days",
      "the 90-day purge",
      "the 90 day retention",
      "events older than 90 days are purged",
      "90 days of raw events",
    ]) {
      expect(
        RETENTION_90.some((pattern) => pattern.test(bad)),
        bad,
      ).toBe(true);
    }
    for (const fine of [
      "Last 90 days",
      "7d, 30d, 90d and 1y",
      "7, 30 and 90 days draw one bar per day",
      "a Free account asked for 90 days or a year",
      "Everything in Free over 7 days, 30 days, 90 days or a year, plus referrers",
      "the 7, 30, 90 day and 1-year ranges read daily_stats",
    ]) {
      expect(
        RETENTION_90.some((pattern) => pattern.test(fine)),
        fine,
      ).toBe(false);
    }
  });
});
