import { describe, expect, it } from "vitest";
import {
  formDailyLimitNotice,
  formLimitNotice,
  formMeterHelp,
  formMeterText,
} from "@/lib/limits/messages";
import { PLAN_LIMITS } from "@/lib/limits/table";

/** M17-02 step 5: the Audience meter and the over-limit notice, every number from the limits table. */
describe("M17-02 form submission limit copy", () => {
  it("the allowance per plan", () => {
    expect(PLAN_LIMITS.free.formSubmissionsPerMonth).toBe(100);
    expect(PLAN_LIMITS.pro.formSubmissionsPerMonth).toBe(5000);
    expect(PLAN_LIMITS.studio.formSubmissionsPerMonth).toBe(50000);
  });

  it("the meter", () => {
    expect(formMeterText("free", 87)).toBe("87 / 100 this month");
    expect(formMeterText("pro", 1200)).toBe("1,200 / 5,000 this month");
    expect(formMeterText("studio", 0)).toBe("0 / 50,000 this month");
  });

  it("the notice once something was refused; none before", () => {
    expect(formLimitNotice("free", 0)).toBeNull();
    expect(formLimitNotice("free", 12)).toBe(
      "You’ve reached this month’s limit of 100 form submissions on Free. 12 were not saved. Upgrade to keep more, or wait until the 1st.",
    );
    expect(formLimitNotice("pro", 1)).toBe(
      "You’ve reached this month’s limit of 5,000 form submissions on Pro. 1 was not saved. Upgrade to keep more, or wait until the 1st.",
    );
    expect(formLimitNotice("studio", 3000)).toBe(
      "You’ve reached this month’s limit of 50,000 form submissions on Studio. 3,000 were not saved.",
    );
  });

  it("the daily cap per site is well under the month on every plan (security review A1)", () => {
    expect(PLAN_LIMITS.free.formSubmissionsPerSiteDay).toBe(20);
    expect(PLAN_LIMITS.pro.formSubmissionsPerSiteDay).toBe(500);
    expect(PLAN_LIMITS.studio.formSubmissionsPerSiteDay).toBe(5000);
    for (const plan of ["free", "pro", "studio"] as const) {
      const { formSubmissionsPerMonth: month, formSubmissionsPerSiteDay: day } = PLAN_LIMITS[plan];
      expect(day * 4).toBeLessThanOrEqual(month);
    }
  });

  it("the line under the meter says what is counted and names the daily cap", () => {
    expect(formMeterHelp("free")).toBe(
      "Counts what your forms hold from the 1st of the month (UTC). Deleting a submission frees its place. Each site takes up to 20 a day.",
    );
    expect(formMeterHelp("studio")).toContain("up to 5,000 a day");
  });

  it("the daily notice once a site's daily cap refused something; none before", () => {
    expect(formDailyLimitNotice("free", 0)).toBeNull();
    expect(formDailyLimitNotice("free", 3)).toBe(
      "A site reached its limit of 20 form submissions a day on Free. 3 were not saved this month. Delete what you don’t need to make room, or wait until tomorrow (UTC).",
    );
    expect(formDailyLimitNotice("pro", 1)).toContain(
      "500 form submissions a day on Pro. 1 was not saved",
    );
  });
});
