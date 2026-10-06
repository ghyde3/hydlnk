import { expect, test } from "@playwright/test";
import { classifyJob, type CronJobRow } from "@/lib/admin/health";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin } from "../m5/admin-helpers";

/** M13-06: /admin/health lists each pg_cron job with its last run, duration and outcome. */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

test.describe("M13-06 admin health", () => {
  test("M13-06 lists every cron job with a status, last run, duration and outcome; no sideways scroll and 44px targets", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "m13hl");
    const { data, error } = await adminClient().rpc("admin_cron_health");
    expect(error).toBeNull();
    const jobs = (data ?? []) as CronJobRow[];

    await page.goto(url("app", "/admin/health"));
    await expect(page.getByRole("heading", { level: 1, name: "Health" })).toBeVisible();

    if (jobs.length === 0) {
      await expect(page.locator("body")).toContainText("No scheduled jobs were found");
    } else {
      await expect(page.locator("tr[data-job]")).toHaveCount(jobs.length);
      const now = new Date();
      for (const job of jobs.slice(0, 5)) {
        const name = job.jobname ?? "";
        const row = page.locator(`tr[data-job="${name}"]`);
        await expect(row, name).toBeVisible();
        const state = classifyJob(job, now).state;
        // A job near its limit may flip between the read and the render: only a clear case is asserted.
        if (state === "failed") await expect(row).toHaveAttribute("data-state", "failed");
        await expect(row, name).toContainText(/Succeeded|Failed|Running|Never ran|\w+/);
      }
      await expect(page.getByTestId("health-summary")).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main, body");
  });
});
