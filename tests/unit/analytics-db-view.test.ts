import { describe, expect, it } from "vitest";
import {
  TRAFFIC_PAGE_SIZE,
  formatFlagDate,
  formatViews,
  parseTrafficFilter,
  parseTrafficPage,
  planLabel,
  toTrafficFlagRow,
} from "@/lib/analytics/admin/view";

/** M5-10: the pure half of /admin/traffic (query parsing, number and date formatting, row mapping). */
describe("M5-10 /admin/traffic view helpers", () => {
  it("the filter is Unreviewed unless ?status=reviewed", () => {
    expect(parseTrafficFilter(undefined)).toBe("unreviewed");
    expect(parseTrafficFilter("reviewed")).toBe("reviewed");
    expect(parseTrafficFilter(["reviewed", "x"])).toBe("reviewed");
    for (const junk of ["", "REVIEWED", "all", "unreviewed", "'; drop table", "reviewed "]) {
      expect(parseTrafficFilter(junk)).toBe("unreviewed");
    }
  });

  it("the page number is a whole number from 1 to 10,000, else 1", () => {
    expect(parseTrafficPage(undefined)).toBe(1);
    expect(parseTrafficPage("3")).toBe(3);
    expect(parseTrafficPage(["4"])).toBe(4);
    for (const junk of ["0", "-1", "1.5", "abc", "10001", "NaN", "Infinity", ""]) {
      expect(parseTrafficPage(junk)).toBe(1);
    }
    expect(TRAFFIC_PAGE_SIZE).toBe(100);
  });

  it("views carry thousands separators", () => {
    expect(formatViews(100001)).toBe("100,001");
    expect(formatViews(999)).toBe("999");
    expect(formatViews(1234567)).toBe("1,234,567");
    expect(formatViews(0)).toBe("0");
  });

  it("the flagged date is the UTC calendar date, empty for garbage", () => {
    expect(formatFlagDate("2026-10-03T00:50:00.123+00:00")).toBe("2026-10-03");
    expect(formatFlagDate("2026-10-02T23:59:59-05:00")).toBe("2026-10-03");
    expect(formatFlagDate("not a date")).toBe("");
  });

  it("plans read as words", () => {
    expect(planLabel("free")).toBe("Free");
    expect(planLabel("pro")).toBe("Pro");
    expect(planLabel("studio")).toBe("Studio");
    expect(planLabel("other")).toBe("other");
  });

  it("maps a database row to the screen's shape", () => {
    expect(
      toTrafficFlagRow({
        flag_id: "f",
        page_id: "p",
        handle: "mara",
        owner_id: "o",
        owner_email: "o@example.test",
        plan: "free",
        views: 100001,
        window_start: "2026-09-03",
        window_end: "2026-10-02",
        flagged_at: "2026-10-03T00:50:00+00:00",
        reviewed_at: null,
      }),
    ).toEqual({
      flagId: "f",
      pageId: "p",
      handle: "mara",
      ownerId: "o",
      ownerEmail: "o@example.test",
      plan: "free",
      views: 100001,
      windowStart: "2026-09-03",
      windowEnd: "2026-10-02",
      flaggedAt: "2026-10-03T00:50:00+00:00",
      reviewedAt: null,
    });
  });
});
