import { describe, expect, it } from "vitest";
import { formLimitNotice, formMeterText } from "@/lib/limits/messages";
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
});
