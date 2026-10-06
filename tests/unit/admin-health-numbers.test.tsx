import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HealthList } from "@/components/admin/health-list";
import { mapDomainHelp, registrarGuideLinks, formatAge } from "@/lib/admin/domains-help";
import {
  DEFAULT_LATE_AFTER_SECONDS,
  classifyJob,
  healthTile,
  lateAfterSeconds,
  summarizeHealth,
  type CronJobRow,
} from "@/lib/admin/health";
import { mapOverviewNumbers, mapSignups, signupsChart } from "@/lib/admin/numbers";

const NOW = new Date("2026-10-06T12:00:00Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

function job(overrides: Partial<CronJobRow>): CronJobRow {
  return {
    jobid: 1,
    jobname: "verify-pending-domains",
    schedule: "*/5 * * * *",
    active: true,
    last_run_at: ago(120),
    last_end_at: ago(119),
    duration_ms: 850,
    last_status: "succeeded",
    last_message: "1 row",
    runs_24h: 288,
    failed_24h: 0,
    ...overrides,
  };
}

describe("M13-06 the late rule", () => {
  it("uses the table in code, with a nightly default", () => {
    expect(lateAfterSeconds("verify-pending-domains")).toBe(15 * 60);
    expect(lateAfterSeconds("purge-oauth-cimd-unused")).toBe(3 * 3600);
    expect(lateAfterSeconds("some-new-job")).toBe(DEFAULT_LATE_AFTER_SECONDS);
  });

  it("is ok within the gap and late just past it", () => {
    expect(classifyJob(job({ last_run_at: ago(15 * 60) }), NOW).state).toBe("ok");
    expect(classifyJob(job({ last_run_at: ago(15 * 60 + 1) }), NOW).state).toBe("late");
    // The same age is fine for a nightly job.
    expect(
      classifyJob(job({ jobname: "purge-old-events", last_run_at: ago(20 * 3600) }), NOW).state,
    ).toBe("ok");
    expect(
      classifyJob(job({ jobname: "purge-old-events", last_run_at: ago(27 * 3600) }), NOW).state,
    ).toBe("late");
  });

  it("a failed newest run is failed, even when recent; failure wins over late", () => {
    expect(classifyJob(job({ last_status: "failed" }), NOW).state).toBe("failed");
    expect(classifyJob(job({ last_status: "failed", last_run_at: ago(9999) }), NOW).state).toBe(
      "failed",
    );
  });

  it("a job that never ran is late; a paused job is neither", () => {
    const never = classifyJob(
      job({ last_run_at: null, last_status: null, duration_ms: null }),
      NOW,
    );
    expect(never).toMatchObject({ state: "late", outcome: "Never ran", sinceSeconds: null });
    expect(
      classifyJob(job({ active: false, last_run_at: null, last_status: null }), NOW).state,
    ).toBe("paused");
  });

  it("maps duration (bigint strings too) and the outcome words", () => {
    expect(classifyJob(job({ duration_ms: "1200" }), NOW).durationMs).toBe(1200);
    expect(classifyJob(job({ last_status: "running" }), NOW).outcome).toBe("Running");
    expect(classifyJob(job({}), NOW).outcome).toBe("Succeeded");
  });

  it("the summary is unhealthy when any job is failed or late", () => {
    const ok = summarizeHealth(
      [job({}), job({ jobid: 2, jobname: "purge-old-events", last_run_at: ago(3600) })],
      NOW,
    );
    expect(ok).toMatchObject({ healthy: true, failed: 0, late: 0 });
    const bad = summarizeHealth(
      [
        job({}),
        job({ jobid: 2, last_status: "failed" }),
        job({ jobid: 3, last_run_at: ago(99999) }),
      ],
      NOW,
    );
    expect(bad).toMatchObject({ healthy: false, failed: 1, late: 1 });
    expect(summarizeHealth([], NOW).healthy).toBe(true);
  });
});

describe("M13-06 the Overview health tile and the health list", () => {
  it("no job history is neutral, never green: no jobs, or jobs that never ran", () => {
    expect(summarizeHealth([], NOW).noHistory).toBe(true);
    expect(healthTile(summarizeHealth([], NOW))).toEqual({
      state: "none",
      text: "No job history yet",
    });
    const never = summarizeHealth([job({ last_run_at: null, last_status: null })], NOW);
    expect(never.noHistory).toBe(true);
    expect(healthTile(never).state).toBe("none");
  });

  it("green only when jobs have run and are on time; unreadable is its own state", () => {
    expect(healthTile(summarizeHealth([job({})], NOW))).toEqual({
      state: "ok",
      text: "All jobs on time",
    });
    expect(healthTile(null).state).toBe("unknown");
  });

  it("a failed job run makes the tile red and the health page's row says Failed", () => {
    const summary = summarizeHealth(
      [
        job({}),
        job({ jobid: 2, jobname: "purge-old-events", last_status: "failed", last_message: "boom" }),
      ],
      NOW,
    );
    expect(healthTile(summary)).toEqual({ state: "bad", text: "1 failed, 0 late" });
    const html = renderToStaticMarkup(<HealthList jobs={summary.jobs} />);
    expect(html).toMatch(/data-job="purge-old-events"[^>]*data-state="failed"/);
    expect(html).toContain("Failed");
    expect(html).toMatch(/data-job="verify-pending-domains"[^>]*data-state="ok"/);
  });
});

describe("M13-03 the numbers mapping", () => {
  it("maps the database row, bigints as strings included, and clamps garbage to zero", () => {
    const n = mapOverviewNumbers({
      accounts_total: "12",
      accounts_free: 8,
      accounts_pro: 3,
      accounts_studio: 1,
      paying_pro: 2,
      paying_studio: 0,
      paying_total: 2,
      gifted_active: 1,
      live_sites: 5,
      sub_pages: 9,
      live_sub_pages: 4,
      live_custom_domains: 2,
      views_7d: "1500",
    });
    expect(n).toMatchObject({
      accountsTotal: 12,
      accountsPro: 3,
      // Paying is paid_plan only: Pro shows 3 accounts but 2 pay, because one is a gift.
      payingTotal: 2,
      giftedActive: 1,
      liveSubPages: 4,
      views7d: 1500,
    });
    expect(mapOverviewNumbers(null)).toMatchObject({ accountsTotal: 0, views7d: 0 });
    expect(mapOverviewNumbers({ views_7d: -4, live_sites: "x" })).toMatchObject({
      views7d: 0,
      liveSites: 0,
    });
  });

  it("the chart has one bar per day scaled to the busiest, flat when empty", () => {
    const days = mapSignups([
      { day: "2026-10-04", signups: 0 },
      { day: "2026-10-05", signups: "2" },
      { day: "2026-10-06", signups: 4 },
    ]);
    const chart = signupsChart(days, 300, 60);
    expect(chart).toMatchObject({ total: 6, peak: 4 });
    expect(chart.bars.map((b) => b.height)).toEqual([1, 30, 60]);
    expect(chart.bars.every((b) => b.y + b.height === 60)).toBe(true);
    const flat = signupsChart(mapSignups([{ day: "2026-10-06", signups: 0 }]));
    expect(flat.peak).toBe(1);
    expect(flat.bars[0]!.height).toBe(1);
    expect(signupsChart([]).bars).toEqual([]);
  });
});

describe("M13-04 the domains list", () => {
  it("maps rows, with the reason and the last check's result in words", () => {
    const rows = mapDomainHelp([
      {
        domain_id: "d1",
        hostname: "a.example",
        status: "pending",
        reason: "unverified",
        page_id: "p",
        handle: "nico",
        owner_id: "o",
        owner_email: "n@x.test",
        created_at: "2026-10-03T00:00:00Z",
        age_seconds: "259200",
        last_checked_at: null,
      },
      {
        domain_id: "d2",
        hostname: "b.example",
        status: "error",
        reason: "failed",
        page_id: "p",
        handle: "nico",
        owner_id: "o",
        owner_email: null,
        created_at: "2026-10-06T10:00:00Z",
        age_seconds: 7200,
        last_checked_at: "2026-10-06T11:55:00Z",
      },
    ]);
    expect(rows[0]).toMatchObject({
      reason: "unverified",
      ageSeconds: 259200,
      result: "Never checked.",
    });
    expect(rows[1]).toMatchObject({
      reason: "failed",
      result: "The last check failed.",
      ownerEmail: null,
    });
    expect(mapDomainHelp(null)).toEqual([]);
  });

  it("ages read coarsely", () => {
    expect(formatAge(600)).toBe("10 min");
    expect(formatAge(7200)).toBe("2 hours");
    expect(formatAge(3 * 86400)).toBe("3 days");
  });

  it("the registrar guides are the four registrars and the general guide on the marketing origin", () => {
    expect(registrarGuideLinks("https://hydlnk.com").map((g) => g.url)).toEqual([
      "https://hydlnk.com/learn/connecting-a-domain",
      "https://hydlnk.com/learn/connect-a-domain-godaddy",
      "https://hydlnk.com/learn/connect-a-domain-namecheap",
      "https://hydlnk.com/learn/connect-a-domain-squarespace",
      "https://hydlnk.com/learn/connect-a-domain-cloudflare",
    ]);
  });
});
