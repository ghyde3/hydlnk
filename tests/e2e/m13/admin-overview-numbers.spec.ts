import { expect, test } from "@playwright/test";
import { classifyJob, healthTile, summarizeHealth, type CronJobRow } from "@/lib/admin/health";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-03 (numbers at a glance) and the Overview's health tile (M13-06): the admin Overview renders
 * the numbers, the 30-day signups chart and the Stripe link at both viewports. The exact counts are
 * proven on a seeded set in tests/unit/admin-health-numbers.test.ts and supabase/tests/database/
 * 186-admin-readers.test.sql; other specs create accounts while this runs, so a count here is only
 * checked for its shape.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

test.describe("M13-03 admin overview numbers", () => {
  test("M13-03 a signed-in non-admin gets the 404 on /admin/health and /admin/domains", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "no layout involved");
    await signInAsUser(context, "m13non");
    for (const path of ["/admin/health", "/admin/domains"]) {
      const response = await page.goto(url("app", path));
      expect(response?.status(), path).toBe(404);
      await expect(page.locator("body"), path).toContainText("That page doesn’t exist.");
    }
  });

  test("M13-03 the Overview shows the numbers, the signups chart and the Stripe link, with no sideways scroll and 44px targets", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "m13ov");
    await page.goto(url("app", "/admin"));
    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();

    const numbers = page.getByRole("region", { name: "Numbers at a glance" });
    for (const id of ["accounts", "paying", "live-sites", "sub-pages", "domains", "views"]) {
      const stat = numbers.locator(`[data-stat="${id}"]`);
      await expect(stat, id).toBeVisible();
      await expect(stat, id).toContainText(/\d/);
    }
    await expect(numbers.locator('[data-stat="accounts"]')).toContainText(
      /Free \d+, Pro \d+, Studio \d+/,
    );
    await expect(numbers.locator('[data-stat="paying"]')).toContainText("Gifts not counted");

    // The chart: 30 days, one bar a day, a text label and a total.
    const chart = page.getByTestId("signups-chart");
    await expect(chart).toBeVisible();
    await expect(
      chart.getByRole("img", { name: /^Signups per day, \d+ in the last 30 days$/ }),
    ).toBeVisible();
    await expect(chart.locator("svg rect")).toHaveCount(30);
    // This admin signed up just now, so today's bar is not empty.
    await expect(chart.locator("svg rect").last()).toHaveClass(/fill-brass/);

    const stripe = page.getByRole("link", { name: "Open the Stripe dashboard" });
    await expect(stripe).toHaveAttribute("href", /^https:\/\/dashboard\.stripe\.com\//);
    await expect(stripe).toHaveAttribute("rel", /noopener/);

    // The existing tiles are still there.
    for (const label of ["Open reports", "Suspended accounts", "Traffic", "Blocked links"]) {
      await expect(page.getByRole("link", { name: new RegExp(label) }).first()).toBeVisible();
    }

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main, body");
  });

  test("M13-06 the health tile is red exactly when a job is failed or late", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "m13tile");
    const { data, error } = await adminClient().rpc("admin_cron_health");
    expect(error).toBeNull();
    await page.goto(url("app", "/admin"));
    const tile = page.getByTestId("health-tile");
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("href", "/admin/health");
    const now = new Date();
    const rows = (data ?? []) as CronJobRow[];
    // The tile's own rule (src/lib/admin/health.ts): no job history is neutral, never green.
    const expected = healthTile(summarizeHealth(rows, now)).state;
    const bad = rows.some((row) => {
      const state = classifyJob(row, now).state;
      return state === "failed" || state === "late";
    });
    // A job may cross its limit between the two reads: only the stable cases are asserted.
    const attribute = await tile.getAttribute("data-health");
    expect(["ok", "bad", "none"]).toContain(attribute);
    if (expected === "none") expect(attribute).toBe("none");
    else if (bad) expect(attribute).toBe("bad");
    await expectNoHorizontalScroll(page);
  });
});
