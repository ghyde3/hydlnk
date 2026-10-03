import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OVER_LIMIT_NOTE,
  PLAN_IDS,
  PLAN_LIMITS,
  buildMeters,
  formatBytes,
  formatLimitBytes,
  formatUploadUsage,
  pageLimitMessage,
  planBlurb,
  toPlanId,
  uploadQuotaMessage,
} from "@/lib/limits";
import { PLAN_INFO } from "@/lib/pages/plans";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe("M4-02 the TypeScript limits table", () => {
  it("M4-02 exports pages, domains, upload bytes, saved themes, analytics history and breakdowns for free, pro and studio", () => {
    expect(PLAN_IDS).toEqual(["free", "pro", "studio"]);
    expect(PLAN_LIMITS.free).toEqual({
      pages: 1,
      customDomains: 0,
      uploadBytes: 10 * MIB,
      savedThemes: 3,
      analyticsHistoryDays: 30,
      analyticsBreakdowns: false,
      versionsKept: 0,
    });
    expect(PLAN_LIMITS.pro).toEqual({
      pages: 3,
      customDomains: 1,
      uploadBytes: 100 * MIB,
      savedThemes: null,
      analyticsHistoryDays: 365,
      analyticsBreakdowns: true,
      versionsKept: 25,
    });
    expect(PLAN_LIMITS.studio).toEqual({
      pages: 15,
      customDomains: 15,
      uploadBytes: GIB,
      savedThemes: null,
      analyticsHistoryDays: 365,
      analyticsBreakdowns: true,
      versionsKept: 25,
    });
    // The exact figures the acceptance names.
    expect(PLAN_IDS.map((plan) => PLAN_LIMITS[plan].uploadBytes)).toEqual([
      10485760, 104857600, 1073741824,
    ]);
  });

  it("M4-02 the app chrome's page meter (PLAN_INFO) agrees with the table", () => {
    for (const plan of PLAN_IDS) expect(PLAN_INFO[plan].maxPages).toBe(PLAN_LIMITS[plan].pages);
  });

  it("M4-02 an unknown plan reads as free (fail closed)", () => {
    expect(toPlanId("enterprise")).toBe("free");
    expect(toPlanId(null)).toBe("free");
    expect(toPlanId(undefined)).toBe("free");
    expect(toPlanId("studio")).toBe("studio");
  });

  it("M4-02 the upload-byte literals appear in src/ only in the table module", () => {
    const hits: string[] = [];
    const root = join(process.cwd(), "src");
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|css|json|mjs|js)$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (/10485760|104857600|1073741824/.test(text)) hits.push(relative(process.cwd(), path));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(["src/lib/limits/table.ts"]);
  });
});

describe("M4-31 / M4-32 formatting", () => {
  it("M4-32 under 1 MiB reads '<1 MB', up to 999 MiB whole MB, beyond that GB with one decimal", () => {
    expect(formatBytes(0)).toBe("<1 MB");
    expect(formatBytes(MIB - 1)).toBe("<1 MB");
    expect(formatBytes(MIB)).toBe("1 MB");
    expect(formatBytes(18 * MIB)).toBe("18 MB");
    expect(formatBytes(18.4 * MIB)).toBe("18 MB");
    expect(formatBytes(999 * MIB)).toBe("999 MB");
    expect(formatBytes(1000 * MIB)).toBe("1.0 GB");
    expect(formatBytes(GIB)).toBe("1.0 GB");
    expect(formatBytes(1.5 * GIB)).toBe("1.5 GB");
    expect(formatBytes(Number.NaN)).toBe("<1 MB");
    expect(formatBytes(-5)).toBe("<1 MB");
  });

  it("M4-32 the caps read 10 MB, 100 MB and 1 GB", () => {
    expect(PLAN_IDS.map((plan) => formatLimitBytes(PLAN_LIMITS[plan].uploadBytes))).toEqual([
      "10 MB",
      "100 MB",
      "1 GB",
    ]);
  });

  it("M4-32 the usage text drops the used unit when it is the cap's unit", () => {
    expect(formatUploadUsage(18 * MIB, 100 * MIB)).toBe("18 / 100 MB");
    expect(formatUploadUsage(0, 10 * MIB)).toBe("<1 / 10 MB");
    expect(formatUploadUsage(600 * MIB, GIB)).toBe("600 MB / 1 GB");
  });

  it("M4-31 the quota message names the plan's cap", () => {
    expect(uploadQuotaMessage("free")).toBe(
      "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
    );
    expect(uploadQuotaMessage("pro")).toBe(
      "Uploads are limited to 100 MB on Pro. Delete an image or upgrade.",
    );
    expect(uploadQuotaMessage("studio")).toBe(
      "Uploads are limited to 1 GB on Studio. Delete an image or upgrade.",
    );
  });

  it("M4-18 the page-limit messages read per plan", () => {
    expect(pageLimitMessage("free", 1)).toBe("Free includes 1 page. Pro includes 3.");
    expect(pageLimitMessage("pro", 3)).toBe("You’ve used 3 of 3 pages. Studio includes 15.");
    expect(pageLimitMessage("studio", 15)).toBe("You’ve used 15 of 15 pages.");
  });

  it("M4-05 the plan blurbs come from the table and promise nothing deferred", () => {
    expect(planBlurb("free")).toBe("1 page, hydlnk.com address, 30 days of per-link clicks.");
    expect(planBlurb("pro")).toBe("3 pages, 1 custom domain, a year of analytics, no badge.");
    expect(planBlurb("studio")).toBe("15 pages, 15 custom domains, a year of analytics, no badge.");
    for (const plan of PLAN_IDS) {
      expect(planBlurb(plan)).not.toMatch(/editor|team|csv|schedul/i);
    }
  });
});

describe("M4-32 / M4-33 usage meters", () => {
  const usage = (
    over: Partial<Record<"pages" | "domains" | "savedThemes" | "uploadBytes", number>>,
  ) => ({
    pages: 0,
    domains: 0,
    savedThemes: 0,
    uploadBytes: 0,
    ...over,
  });
  const byKey = (meters: ReturnType<typeof buildMeters>) =>
    Object.fromEntries(meters.map((meter) => [meter.key, meter]));

  it("M4-32 a Pro account with 2 pages, 1 domain, 18 MiB and 5 themes", () => {
    const m = byKey(
      buildMeters("pro", usage({ pages: 2, domains: 1, uploadBytes: 18 * MIB, savedThemes: 5 })),
    );
    expect(m.pages).toMatchObject({ text: "2 / 3", dashed: false, over: false, note: null });
    expect(m.pages!.percent).toBeCloseTo(66.67, 1);
    expect(m.domains).toMatchObject({ text: "1 / 1", percent: 100, over: false });
    expect(m.uploads).toMatchObject({ text: "18 / 100 MB", percent: 18, over: false });
    expect(m.themes).toMatchObject({ text: "5 · no limit", dashed: true, percent: 0, over: false });
  });

  it("M4-32 Free: custom domains read 'Not included' with a dashed track, themes read n / 3", () => {
    const m = byKey(buildMeters("free", usage({ pages: 1, savedThemes: 2 })));
    expect(m.domains).toMatchObject({
      text: "Not included",
      dashed: true,
      percent: 0,
      over: false,
    });
    expect(m.themes).toMatchObject({ text: "2 / 3", dashed: false });
    expect(m.pages).toMatchObject({ text: "1 / 1", percent: 100, over: false });
  });

  it("M4-33 over the limit after a downgrade: the fill stays at 100% and the helper line shows", () => {
    const m = byKey(
      buildMeters("free", usage({ pages: 3, domains: 1, savedThemes: 4, uploadBytes: 50 * MIB })),
    );
    expect(m.pages).toMatchObject({
      text: "3 / 1",
      percent: 100,
      over: true,
      note: OVER_LIMIT_NOTE,
    });
    // A kept domain is shown against a limit of 0, not as 'Not included'.
    expect(m.domains).toMatchObject({
      text: "1 / 0",
      percent: 100,
      over: true,
      note: OVER_LIMIT_NOTE,
    });
    expect(m.themes).toMatchObject({
      text: "4 / 3",
      percent: 100,
      over: true,
      note: OVER_LIMIT_NOTE,
    });
    expect(m.uploads).toMatchObject({
      text: "50 / 10 MB",
      percent: 100,
      over: true,
      note: OVER_LIMIT_NOTE,
    });
    expect(OVER_LIMIT_NOTE).toBe(
      "Over your plan’s limit. What you have stays; you can’t add more.",
    );
  });

  it("M4-32 at the limit is not over", () => {
    const m = byKey(buildMeters("free", usage({ pages: 1, uploadBytes: 10 * MIB })));
    expect(m.pages!.over).toBe(false);
    expect(m.uploads!.over).toBe(false);
    expect(m.uploads!.percent).toBe(100);
  });
});
