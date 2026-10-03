import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  ANALYTICS,
  dayAt,
  kpi,
  makeOwner,
  rowCounts,
  seed,
  signInOwner,
  windowLabel,
  type Owner,
} from "./analytics-dash-helpers";

/**
 * M4-29 (sample data until the first real event) and M5-17 (empty, zero and error states).
 *
 *   S  a published Pro page that has never recorded anything
 *   N  the same, never published
 *   B  a published Pro page that gets one real view through POST /api/e (the view beacon)
 *   E  a Pro page with one rolled-up day, for the stats-request failure
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

let s: Owner;
let n: Owner;
let b: Owner;
let e: Owner;

test.beforeAll(async () => {
  [s, n, b, e] = await Promise.all([
    makeOwner("sts", "pro"),
    makeOwner("stn", "pro", { published: false }),
    makeOwner("stb", "pro"),
    makeOwner("ste", "pro"),
  ]);
  await seed(e.pageId, [
    { type: "view", day: dayAt(-2), visitor: "e1" },
    { type: "view", day: dayAt(-2), visitor: "e2" },
    { type: "click", day: dayAt(-2), visitor: "e1" },
  ]);
});

test.describe("M4-29 sample data", () => {
  test("M4-29 a page that never recorded anything shows the sample set and the chip, and writes nothing", async ({
    page,
    context,
  }) => {
    await signInOwner(context, s);
    await page.goto(ANALYTICS());

    await expect(page.getByTestId("sample-chip")).toHaveText("Sample data");
    expect(await kpi(page, "Views")).toBe("12,480");
    expect(await kpi(page, "Clicks")).toBe("3,912");
    expect(await kpi(page, "Click-through")).toBe("31.3%");
    expect(await kpi(page, "Unique visitors")).toBe("8,206");

    // The chart, the link table and all three cards are filled too.
    await expect(
      page.getByRole("img", { name: /^Daily views and clicks for / }).locator('[data-bar="drawn"]'),
    ).toHaveCount(30);
    const rows = page.getByTestId("link-row");
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText("Portrait sessions — fall dates");
    await expect(rows.first()).toContainText("1,284");
    await expect(rows.first()).toContainText("10.3%");
    await expect(page.getByTestId("breakdown-referrers").getByTestId("breakdown-row")).toHaveText([
      "instagram.com 54%",
      "tiktok.com 21%",
      "Direct 14%",
      "google.com 7%",
      "Other 4%",
    ]);
    await expect(page.getByTestId("breakdown-devices").getByTestId("breakdown-row")).toHaveText([
      "Mobile 86%",
      "Desktop 12%",
      "Tablet 2%",
    ]);
    await expect(page.getByTestId("breakdown-countries").getByTestId("breakdown-row")).toHaveText([
      "United States 71%",
      "Canada 8%",
      "United Kingdom 6%",
      "Other 15%",
    ]);

    // M5-17: the note that says these are samples (the page is published).
    await expect(page.getByTestId("sample-note")).toHaveText(
      "No visits yet. These numbers are samples. Yours appear after the first view.",
    );

    // The sample scales with the range and the chip stays.
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "7d" })
      .click();
    await expect.poll(() => kpi(page, "Views")).toBe("2,912");
    await expect(page.getByTestId("sample-chip")).toBeVisible();
    await expect(page.getByTestId("date-label")).toHaveText(windowLabel(7));

    // Sample numbers exist only in the render: nothing was written for this page.
    expect(await rowCounts(s.pageId)).toEqual({ events: 0, dailyStats: 0, dailyDims: 0 });
  });

  test("M4-29 an unpublished page shows the chip and asks to publish", async ({
    page,
    context,
  }) => {
    await signInOwner(context, n);
    await page.goto(ANALYTICS());
    await expect(page.getByTestId("sample-chip")).toBeVisible();
    await expect(page.getByTestId("sample-note")).toHaveText(
      "Publish your page to start counting views.",
    );
    expect(await kpi(page, "Views")).toBe("12,480");
    await expect(page.getByText("No visits yet.")).toHaveCount(0);
  });

  test("M4-29 the chip sits beside the date label on a desktop and wraps under it on a phone", async ({
    page,
    context,
  }, info) => {
    await signInOwner(context, s);
    await page.goto(ANALYTICS());
    const label = (await page.getByTestId("date-label").boundingBox())!;
    const chip = (await page.getByTestId("sample-chip").boundingBox())!;
    await expectNoHorizontalScroll(page);
    if (process.env.HL_SHOTS) {
      await page.screenshot({ path: `tmp/screens/analytics-sample-${info.project.name}.png` });
    }
    if (phoneOnly(info)) {
      expect(chip.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
      expect(Math.round(chip.x)).toBe(Math.round(label.x));
    }
    if (desktopOnly(info)) {
      expect(Math.abs(chip.y + chip.height / 2 - (label.y + label.height / 2))).toBeLessThan(8);
      expect(chip.x).toBeGreaterThan(label.x + label.width - 1);
    }
  });

  test("M4-29 after one real beacon the chip and the note are gone and only real numbers show", async ({
    page,
    context,
  }) => {
    await signInOwner(context, b);
    await page.goto(ANALYTICS());
    await expect(page.getByTestId("sample-chip")).toBeVisible();

    const origin = `http://${b.handle}.localhost:3000`;
    const res = await rawRequest(`${b.handle}.localhost:3000`, "/api/e", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      },
      body: JSON.stringify({ pageId: b.pageId, referrer: "" }),
    });
    expect(res.status).toBe(204);
    await expect.poll(async () => (await rowCounts(b.pageId)).events).toBe(1);

    await page.reload();
    await expect(page.getByTestId("sample-chip")).toHaveCount(0);
    await expect(page.getByTestId("sample-note")).toHaveCount(0);
    expect(await kpi(page, "Views")).toBe("1");
    expect(await kpi(page, "Clicks")).toBe("0");
    expect(await kpi(page, "Click-through")).toBe("—");
    expect(await kpi(page, "Unique visitors")).toBe("1");
    await expect(page.getByTestId("link-row")).toHaveCount(0);
    await expect(page.getByTestId("links-empty")).toContainText(
      "No clicks yet. Clicks appear here once someone taps a link.",
    );
    await expect(page.getByTestId("breakdown-referrers").getByTestId("breakdown-row")).toHaveText([
      "Direct 100%",
    ]);
    await expect(page.getByTestId("breakdown-devices").getByTestId("breakdown-row")).toHaveText([
      "Mobile 100%",
    ]);
    await expect(
      page.getByRole("img", { name: /^Daily views and clicks for / }).locator('[data-bar="drawn"]'),
    ).toHaveCount(1);

    // The chip stays gone for every range, and a range of its own never gets sample numbers.
    for (const value of ["7", "90", "365"]) {
      await page.goto(`${ANALYTICS()}?range=${value}`);
      await expect(page.getByTestId("sample-chip")).toHaveCount(0);
      expect(await kpi(page, "Views")).toBe("1");
    }
    expect(await page.locator("main").innerText()).not.toContain("12,480");
  });
});

test.describe("M5-17 stats load failure", () => {
  test("M5-17 a failed stats request shows the error card with Retry, the control stays usable, Retry renders the data", async ({
    page,
    context,
  }, info) => {
    await signInOwner(context, e);
    await page.goto(ANALYTICS());
    expect(await kpi(page, "Views")).toBe("2");

    let failing = true;
    await page.route("**/analytics/stats*", (route) =>
      failing ? route.abort("failed") : route.continue(),
    );

    const group = page.getByRole("group", { name: "Date range" });
    await group.getByRole("button", { name: "7d" }).click();
    const error = page.getByTestId("stats-error");
    await expect(error).toContainText("We couldn’t load your stats. Try again.");
    await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByTestId("kpi-strip")).toHaveCount(0);

    // No stack trace, no internals.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/\bat [\w.<>]+ \(|TypeError|Failed to fetch|NetworkError|stack/i);

    // The control is still there and still works: another range fails the same way, and is pressed.
    await group.getByRole("button", { name: "90d" }).click();
    await expect(group.getByRole("button", { name: "90d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(error).toBeVisible();
    await group.getByRole("button", { name: "7d" }).click();
    await expect(error).toBeVisible();

    if (phoneOnly(info)) {
      expect(
        (await error.getByRole("button", { name: "Retry" }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      await expectTapTargets(page, "main");
      await expectNoHorizontalScroll(page);
    }

    failing = false;
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("stats-error")).toHaveCount(0);
    await expect.poll(() => kpi(page, "Views")).toBe("2");
    expect(await kpi(page, "Clicks")).toBe("1");
    await expect(group.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
  });

  test("M5-17 a stats response that is not JSON is the same error card, not a crash", async ({
    page,
    context,
  }) => {
    await signInOwner(context, e);
    await page.goto(ANALYTICS());
    await page.route("**/analytics/stats*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html>boom</html>" }),
    );
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "7d" })
      .click();
    await expect(page.getByTestId("stats-error")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("boom");
  });

  test("M5-17 only the latest choice counts: a slow answer never overwrites a newer range", async ({
    page,
    context,
  }) => {
    await signInOwner(context, e);
    await page.goto(ANALYTICS());
    await page.route("**/analytics/stats?range=7", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const group = page.getByRole("group", { name: "Date range" });
    await group.getByRole("button", { name: "7d" }).click();
    await group.getByRole("button", { name: "30d" }).click();
    await expect(group.getByRole("button", { name: "30d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.waitForTimeout(2200);
    await expect(page.getByTestId("date-label")).toHaveText(windowLabel(30));
    await expect(page.getByText("Last 30 days", { exact: true })).toBeVisible();
    expect(await kpi(page, "Views")).toBe("2");
  });
});
