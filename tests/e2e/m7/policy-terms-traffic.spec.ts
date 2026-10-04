import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  IPHONE_UA,
  ingestPage,
  postBeacon,
  settledCount,
  waitForEvents,
} from "../m4/analytics-ingest-helpers";
import { signInAsAdmin, signInAsUser, tenantRaw } from "../m5/admin-helpers";
import { flagOf, seedFlaggedPage } from "../m5/traffic-helpers";

/**
 * M7-10 and M7-11: the Terms say the two-month rule, the claim about what counts as a view is true,
 * and /admin/traffic shows both months. The rule itself is pgTAP 140-traffic-two-months (a throwaway
 * production account cannot show two full months), and tests/unit/m7-policy-*.test.ts scan the copy.
 */

test.describe.configure({ timeout: 180_000 });
test.afterAll(cleanupUsers);

/** The five paragraphs Gary approved (curly apostrophes as written). */
const PARAGRAPHS = [
  "Your page keeps serving when traffic spikes, on every plan. A post that takes off is the whole point of a link in bio, and we will never switch off your page for being popular.",
  "HYDLNK is a small company running on modest infrastructure, and the Free plan is generous by choice. We ask for the same good faith in return.",
  "If a Free page gets more than about 100,000 views a month for two months in a row, we’ll take a look. A view is one page load by a person. We don’t count bots, crawlers, link previews or our own checks. One big week never triggers a review.",
  "When we review a page, we check that it fits these terms. If it does and the traffic is here to stay, we’ll email you about a paid plan and give you at least 30 days to decide. Your page keeps serving the whole time.",
  "We may limit or suspend a page, sometimes without notice, if it’s used for automated or fake traffic, scraping, load testing, hosting files or media for other sites, or anything else that slows HYDLNK down for everyone. If you’re planning something big, write to us first. We’d rather help.",
];

test.describe("M7-11 the Terms", () => {
  test("M7-11 Free plan traffic is the heading and exactly the five approved paragraphs, and the contents link is unchanged", async ({
    page,
  }, info) => {
    await page.goto(url(null, "/terms"));
    await expect(page.locator("h2#traffic")).toHaveText("Free plan traffic");
    const siblings = await page.evaluate(() => {
      const out: string[] = [];
      let el = document.querySelector("h2#traffic")?.nextElementSibling ?? null;
      while (el && el.id !== "payments") {
        out.push(`${el.tagName}|${(el.textContent ?? "").replace(/\s+/g, " ").trim()}`);
        el = el.nextElementSibling;
      }
      return { out, next: el?.tagName ?? null, nextText: el?.textContent ?? null };
    });
    expect(siblings.out).toEqual(PARAGRAPHS.map((text) => `P|${text}`));
    expect(siblings.next).toBe("H2");
    expect(siblings.nextText).toBe("Plans, billing and refunds");

    const contents = page.getByRole("navigation", { name: "Contents" });
    await expect(contents.getByRole("link", { name: "Free plan traffic" })).toBeVisible();
    await expect(contents.getByRole("link", { name: "Free plan traffic" })).toHaveAttribute(
      "href",
      "#traffic",
    );

    if (phoneOnly(info)) {
      // At 390: no sideways scroll, and the contents link and the paragraphs wrap without clipping.
      await expectNoHorizontalScroll(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const clipped = await page.evaluate(() => {
        const bad: string[] = [];
        const check = (el: Element) => {
          if (el.scrollWidth > el.clientWidth + 1)
            bad.push(`${el.tagName} ${el.textContent?.slice(0, 40)}`);
        };
        let el = document.querySelector("h2#traffic")?.nextElementSibling ?? null;
        while (el && el.id !== "payments") {
          check(el);
          el = el.nextElementSibling;
        }
        document.querySelectorAll('nav[aria-label="Contents"] a').forEach(check);
        return bad;
      });
      expect(clipped).toEqual([]);
    } else {
      // At 1440 the reading column and the contents list stay as they were.
      await expect(contents).toBeVisible();
      await expect(page.locator(".prose-hl")).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe("M7-11 what the Terms say counts as a view", () => {
  test("M7-11 bots, link previews and curl record nothing; a phone browser records one view", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, one project");
    const p = await ingestPage("polbeacon");
    for (const ua of ["Googlebot/2.1", "Slackbot-LinkExpanding 1.0", "curl/8.4"]) {
      const response = await postBeacon(p, undefined, { ua });
      expect(response.status, ua).toBe(204);
    }
    expect(await settledCount(p.pageId)).toBe(0);

    const person = await postBeacon(p, undefined, { ua: IPHONE_UA });
    expect(person.status).toBe(204);
    const rows = await waitForEvents(p.pageId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "view", block_id: "" });
  });
});

/** An old-rule flag (30-day window, no earlier month) made with psql in the local database container. */
function insertOldRuleFlag(pageId: string): boolean {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "supabase_db_hydlnk",
        "psql",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `insert into public.traffic_flags (page_id, window_start, window_end, views, flagged_at) values ('${pageId}', current_date - 30, current_date - 1, 123456, now())`,
      ],
      { stdio: "ignore", timeout: 20_000 },
    );
    return true;
  } catch {
    return false;
  }
}

const rowOf = (page: Page, flagId: string) => page.locator(`tr[data-flag-id="${flagId}"]`);

test.describe("M7-11 /admin/traffic shows both months", () => {
  test("M7-11 the sentence, seven columns, both counts in mono with thousands separators, and a dash for a flag made by the old rule", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const flagged = await seedFlaggedPage(browser, "polflag");
    const owner = await signInAsUser(await browser.newContext(), "polold");
    const oldRule = insertOldRuleFlag(owner.pageId!);
    await signInAsAdmin(context, "poladm");
    await page.goto(url("app", "/admin/traffic"));
    await expect(page.getByRole("heading", { level: 1, name: "Traffic" })).toBeVisible();
    await expect(
      page.getByText(
        "Free pages with more than 100,000 views in each of the last two full months. They keep serving.",
      ),
    ).toBeVisible();
    await expect(page.locator("thead th")).toHaveText([
      "Page",
      "Owner",
      "Plan",
      "Views, last month",
      "Views, month before",
      "Flagged",
      "Actions",
    ]);

    const row = rowOf(page, flagged.flagId);
    await expect(row).toBeVisible();
    await expect(row.locator("[data-views]")).toHaveText("1,234");
    await expect(row.locator("[data-views]")).toHaveAttribute("data-views", String(flagged.views));
    await expect(row.locator("[data-views-previous]")).toHaveText("1,234");
    await expect(row.locator("[data-views-previous]")).toHaveAttribute(
      "data-views-previous",
      "1234",
    );
    for (const index of [3, 4]) {
      const cell = row.locator("td").nth(index);
      expect(await cell.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
      expect(await cell.evaluate((el) => getComputedStyle(el).textAlign)).toBe("right");
    }
    // The flag records the later month in views and the earlier month in views_previous_month.
    const stored = await adminClient()
      .from("traffic_flags")
      .select("views, views_previous_month")
      .eq("id", flagged.flagId)
      .single();
    expect(stored.data).toEqual({ views: 1234, views_previous_month: 1234 });
    await expectNoHorizontalScroll(page);

    if (!oldRule) {
      test.info().annotations.push({
        type: "skipped",
        description: "docker is not available: the old-rule row was not made",
      });
      return;
    }
    const flag = await adminClient()
      .from("traffic_flags")
      .select("id")
      .eq("page_id", owner.pageId!)
      .single();
    const old = rowOf(page, flag.data!.id as string);
    await expect(old).toBeVisible();
    await expect(old.locator("[data-views]")).toHaveText("123,456");
    await expect(old.locator("[data-views-previous]")).toHaveText("—");
    // An old-rule flag can still be marked reviewed, and the page keeps serving.
    await old.getByRole("button", { name: `Mark ${owner.handle} reviewed` }).click();
    await expect(old).toHaveCount(0);
    expect((await flagOf(owner.pageId!))?.reviewed_at).not.toBeNull();
    expect((await tenantRaw(owner.handle!)).status).toBe(200);
    await page.goto(url("app", "/admin/traffic?status=reviewed"));
    await expect(page.locator("thead th").last()).toHaveText("Reviewed");
    await expect(rowOf(page, flag.data!.id as string).locator("[data-views-previous]")).toHaveText(
      "—",
    );
  });

  test("M7-11 at 390x844 the list is stacked cards labeled with both months, with no sideways scroll and 44px targets", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    const flagged = await seedFlaggedPage(browser, "polphone");
    await signInAsAdmin(context, "polphoneadm");
    await page.goto(url("app", "/admin/traffic"));
    const row = rowOf(page, flagged.flagId);
    await expect(row).toBeVisible();
    await expect(page.locator("thead")).toBeHidden();
    for (const label of [
      "Page",
      "Owner",
      "Plan",
      "Views, last month",
      "Views, month before",
      "Flagged",
    ]) {
      await expect(row.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(row.getByRole("button", { name: /Mark .* reviewed/ })).toBeVisible();
    const cells = await row
      .locator("td")
      .evaluateAll((tds) => tds.map((td) => getComputedStyle(td).display));
    expect(new Set(cells)).toEqual(new Set(["block"]));
    expect(
      (await row.getByRole("button", { name: /Mark .* reviewed/ }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectTapTargets(page);
  });
});
