import { expect, test, type Page } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { addPage, cleanupUsers, desktopOnly, rand, uniq } from "../fixtures/data";
import { sessionOf } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  dismissPath,
  json,
  postApp,
  sessionCookie,
  signInAsAdmin,
  signInAsUser,
  suspendedAt,
} from "./admin-helpers";

/**
 * M5-06: the admin report queue at /admin/reports. Reports are written with the secret key (the
 * public report form is another feature), in the shape of the Wave D contract: reason, details,
 * reporter_email, status open | dismissed | actioned, reviewed_at, reviewed_by.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

// The reports table comes from the reports migration (20261003000001). Without it there is nothing
// to list, so the specs say so instead of failing on a missing relation.
test.beforeAll(async () => {
  const probe = await adminClient().from("reports").select("id").limit(1);
  test.skip(
    probe.error !== null,
    `the reports table is not applied to this database (${probe.error?.message})`,
  );
});

interface NewReport {
  reason?: string;
  details?: string | null;
  reporter_email?: string | null;
  status?: string;
  created_at?: string;
}

async function addReport(pageId: string, over: NewReport = {}): Promise<string> {
  const { data, error } = await adminClient()
    .from("reports")
    .insert({ page_id: pageId, reason: "spam", details: "A report.", ...over })
    .select("id")
    .single();
  if (error) throw new Error(`addReport failed: ${error.message}`);
  return data.id as string;
}

const reportRow = async (id: string) =>
  (await adminClient().from("reports").select("*").eq("id", id).single()).data as {
    status: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
  };

const rowOf = (page: Page, id: string) => page.locator(`tr[data-report-id="${id}"]`);
const open = async (page: Page, status?: "resolved" | "all") => {
  await page.goto(url("app", status ? `/admin/reports?status=${status}` : "/admin/reports"));
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
};

test.describe("M5-06 the report queue", () => {
  test("M5-06 lists reports newest first with time, page link, reason, 120 characters of details, reporter email, the count for the page and a status chip; Open is the default", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(await browser.newContext(), "rq");
    const other = await signInAsUser(await browser.newContext(), "rq2");
    const long = `${"a".repeat(119)}XYZ${"b".repeat(60)}`;
    const older = await addReport(owner.pageId!, {
      created_at: "2026-09-01T10:00:00Z",
      reason: "phishing",
    });
    const newest = await addReport(owner.pageId!, {
      created_at: "2026-09-03T12:30:00Z",
      reason: "malware",
      details: long,
      reporter_email: "reporter@example.test",
    });
    const mid = await addReport(other.pageId!, {
      created_at: "2026-09-02T08:00:00Z",
      reason: "other",
      details: null,
    });
    const resolved = await addReport(other.pageId!, {
      created_at: "2026-09-04T00:00:00Z",
      status: "dismissed",
    });
    await signInAsAdmin(context, "rqa");

    await open(page);
    // The segmented control: Open | Resolved | All, Open selected.
    const nav = page.getByRole("navigation", { name: "Report status" });
    await expect(nav.getByRole("link")).toHaveText(["Open", "Resolved", "All"]);
    await expect(nav.getByRole("link", { name: "Open" })).toHaveAttribute("aria-current", "true");

    const ids = await page
      .locator("tr[data-report-id]")
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-report-id")));
    // Newest first among ours; the resolved one is not in Open.
    const ours = ids.filter((id) => [older, newest, mid, resolved].includes(id ?? ""));
    expect(ours).toEqual([newest, mid, older]);

    const row = rowOf(page, newest);
    await expect(row).toContainText("2026-09-03 12:30 UTC");
    await expect(row).toContainText("Malware");
    await expect(row).toContainText("reporter@example.test");
    await expect(row.locator("td").nth(5)).toHaveText(/2$/);
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "open");
    // Details: the first 120 characters, then an ellipsis.
    const details = (await row.locator("td").nth(3).textContent()) ?? "";
    expect(details).toContain("a".repeat(119));
    expect(details).not.toContain("XYZ");
    expect(details).toContain("…");
    // The page address opens the public page in a new tab, safely.
    const link = row.getByRole("link", { name: owner.handle! });
    await expect(link).toHaveAttribute("href", url(owner.handle!));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    // No details and no reporter read as an em dash.
    await expect(rowOf(page, mid).locator("td").nth(3)).toContainText("—");
    await expect(rowOf(page, mid).locator("td").nth(4)).toContainText("—");

    // Resolved and All.
    await open(page, "resolved");
    await expect(rowOf(page, resolved)).toBeVisible();
    await expect(rowOf(page, resolved).locator("[data-status]")).toHaveText("Dismissed");
    await expect(rowOf(page, newest)).toHaveCount(0);
    await expect(rowOf(page, resolved).getByRole("button")).toHaveCount(0);
    await open(page, "all");
    for (const id of [older, newest, mid, resolved]) await expect(rowOf(page, id)).toBeVisible();
  });

  test("M5-06 Dismiss sets the report dismissed with who and when, and it moves to Resolved", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(await browser.newContext(), "rd");
    const id = await addReport(owner.pageId!);
    const adminUser = await signInAsAdmin(context, "rda");
    await open(page);
    await rowOf(page, id).getByRole("button", { name: "Dismiss" }).click();
    await expect(rowOf(page, id)).toHaveCount(0, { timeout: 15_000 });
    const stored = await reportRow(id);
    expect(stored.status).toBe("dismissed");
    expect(stored.reviewed_at).not.toBeNull();
    expect(stored.reviewed_by).toBe(adminUser.userId);
    await open(page, "resolved");
    await expect(rowOf(page, id).locator("[data-status]")).toHaveText("Dismissed");
  });

  test("M5-06 Suspend owner confirms, suspends the account, takes the page offline and marks that account's open reports actioned", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(await browser.newContext(), "rs", { plan: "pro" });
    await addPage(owner.userId, uniq("rs2").slice(0, 28));
    const bystander = await signInAsUser(await browser.newContext(), "rsb");
    const a = await addReport(owner.pageId!);
    const b = await addReport(owner.pageId!, { reason: "phishing" });
    const c = await addReport(bystander.pageId!);
    await signInAsAdmin(context, "rsa");
    await open(page);
    await rowOf(page, a)
      .getByRole("button", { name: /^Suspend owner/ })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toHaveText(
      `Suspend ${owner.handle}? All 2 of its pages stop serving right away.`,
    );
    await dialog.getByRole("button", { name: "Suspend account" }).click();
    await expect(rowOf(page, a)).toHaveCount(0, { timeout: 15_000 });
    expect(await suspendedAt(owner.userId)).not.toBeNull();
    expect((await reportRow(a)).status).toBe("actioned");
    expect((await reportRow(b)).status).toBe("actioned");
    expect((await reportRow(c)).status).toBe("open");
    expect((await page.request.get(url(owner.handle!))).status()).toBe(404);
    await open(page, "resolved");
    await expect(rowOf(page, a).locator("[data-status]")).toHaveText("Actioned");
  });

  test("M5-06 a report whose page was deleted shows 'Page deleted' and offers Dismiss only", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(await browser.newContext(), "rg", { plan: "pro" });
    const second = uniq("rg2").slice(0, 28);
    const secondId = await addPage(owner.userId, second);
    const id = await addReport(secondId, { details: "about a page that is gone" });
    await adminClient().from("pages").delete().eq("id", secondId);
    expect(
      (await adminClient().from("reports").select("id").eq("id", id)).data,
      "the report must outlive its page (reports.page_id on delete set null)",
    ).toHaveLength(1);
    await signInAsAdmin(context, "rga");
    await open(page);
    const row = rowOf(page, id);
    await expect(row).toContainText("Page deleted");
    await expect(row.getByRole("link")).toHaveCount(0);
    await expect(row.getByRole("button")).toHaveText(["Dismiss"]);
    await row.getByRole("button", { name: "Dismiss" }).click();
    await expect(rowOf(page, id)).toHaveCount(0, { timeout: 15_000 });
    expect((await reportRow(id)).status).toBe("dismissed");
  });

  test("M5-06 reporter-supplied text is escaped: <script> shows as text and nothing runs", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(await browser.newContext(), "rx");
    const payload = "<script>window.__xss = 1; alert(1)</script>";
    const email = "<img src=x onerror=window.__xss=2>@example.test";
    const id = await addReport(owner.pageId!, { details: payload, reporter_email: email });
    await signInAsAdmin(context, "rxa");
    let alerted = false;
    page.on("dialog", async (dialog) => {
      alerted = true;
      await dialog.dismiss();
    });
    await open(page);
    const row = rowOf(page, id);
    await expect(row.locator("td").nth(3)).toContainText(payload);
    await expect(row.locator("td").nth(4)).toContainText(email);
    expect(await row.locator("script, img").count()).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    expect(alerted).toBe(false);
  });

  test("M5-06 direct API: a non-admin cannot read reports (no rows or denied) and cannot dismiss one: 403 and the row is unchanged", async ({
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const owner = await signInAsUser(await browser.newContext(), "ra");
    const id = await addReport(owner.pageId!, { details: "secret details" });
    const nonAdmin = await signInAsUser(context, "ranon");
    const { access_token } = await sessionOf(context);

    for (const token of [null, access_token]) {
      const res = await fetch(`${supabaseUrl()}/rest/v1/reports?select=*`, {
        headers: {
          apikey: publishableKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const text = await res.text();
      expect(res.status >= 400 || text.trim() === "[]", `${res.status} ${text.slice(0, 200)}`).toBe(
        true,
      );
      expect(text).not.toContain("secret details");
    }
    // Writing is just as closed.
    const write = await fetch(`${supabaseUrl()}/rest/v1/reports?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${access_token}`,
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status: "dismissed" }),
    });
    const body = await write.text();
    expect(write.status >= 400 || body.trim() === "[]").toBe(true);

    const cookie = await sessionCookie(context);
    const denied = await postApp(dismissPath(id), { cookie });
    expect(denied.status).toBe(403);
    expect(json(denied).error).toBe("forbidden");
    expect((await postApp(dismissPath(id))).status).toBe(401);
    const stored = await reportRow(id);
    expect(stored.status).toBe("open");
    expect(stored.reviewed_at).toBeNull();
    expect(nonAdmin.userId).toBeTruthy();
  });
});

test.describe("M5-06 report queue layout", () => {
  test("M5-06 at 390x844 the table collapses to stacked cards with no horizontal scroll and Dismiss and Suspend at least 44px tall", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone layout");
    const owner = await signInAsUser(await browser.newContext(), "rlp");
    const id = await addReport(owner.pageId!, {
      details: "x".repeat(300),
      reporter_email: `${rand(30)}@example-long-domain.test`,
    });
    await signInAsAdmin(context, "rlpa");
    await open(page);
    const row = rowOf(page, id);
    await expect(row).toBeVisible();
    // Stacked: no header row, the cells are blocks one under another.
    await expect(page.locator("thead")).toBeHidden();
    const cells = await row
      .locator("td")
      .evaluateAll((tds) => tds.map((td) => getComputedStyle(td).display));
    expect(new Set(cells)).toEqual(new Set(["block"]));
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    for (const name of ["Dismiss", /^Suspend owner/]) {
      const box = await row.getByRole("button", { name }).boundingBox();
      expect(box!.height, String(name)).toBeGreaterThanOrEqual(44);
    }
    await expectTapTargets(page);
  });

  test("M5-06 at 1440x900 it is a data table: header row on the page color and mono numbers", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(await browser.newContext(), "rld");
    const id = await addReport(owner.pageId!);
    await signInAsAdmin(context, "rlda");
    await open(page);
    const header = page.locator("thead");
    await expect(header).toBeVisible();
    expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(244, 243, 240)",
    );
    const row = rowOf(page, id);
    expect(
      await row
        .locator("td")
        .nth(5)
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/mono/i);
    expect(
      await row
        .locator("td")
        .nth(0)
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/mono/i);
    await expectNoHorizontalScroll(page);
  });
});
