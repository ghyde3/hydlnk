import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { appRaw, rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { postApp, sessionCookie, signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-09: an announcement set on /admin/announcement shows at the top of the editor for a signed-in
 * owner between its start and end, dismisses per browser, and never appears on a public page or the
 * marketing site. The table holds one message at a time, so this flow runs once (the desktop project)
 * and switches the owner's page to 390x844 for the phone checks.
 */

test.describe.configure({ timeout: 180_000, mode: "serial" });

const clearAll = () => adminClient().from("announcements").delete().gte("ends_at", "1970-01-01");
test.beforeAll(async () => void (await clearAll()));
test.afterAll(async () => {
  await clearAll();
  await cleanupUsers();
});

/** A `datetime-local` value, in this machine's zone (the browser under test is on the same one). */
const local = (hoursFromNow: number): string => {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const ADMIN_SCREEN = url("app", "/admin/announcement");
const EDITOR = url("app", "/editor");
const banner = (page: Page) => page.locator("[data-announcement]");

async function setViaScreen(
  page: Page,
  fields: { message: string; link?: string; starts?: string; ends: string },
): Promise<void> {
  await page.goto(ADMIN_SCREEN);
  await page.waitForFunction(() => {
    const field = document.querySelector("form[aria-label='Set the announcement'] textarea");
    return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps$"));
  });
  await page.getByLabel("Message").fill(fields.message);
  await page.getByLabel("Link (optional)").fill(fields.link ?? "");
  await page.getByLabel("Starts").fill(fields.starts ?? "");
  await page.getByLabel("Ends").fill(fields.ends);
  await page.getByRole("button", { name: /^(Set|Replace) announcement$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Announcement set." })).toBeVisible();
}

test("M13-09 set, shown in the editor, escaped, dismissed per browser, replaced, scheduled and cleared", async ({
  browser,
}, info) => {
  test.skip(
    !desktopOnly(info),
    "one stateful flow: the desktop project switches the viewport itself",
  );

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signInAsAdmin(adminContext, "annadm");
  const ownerContext = await browser.newContext();
  const owner = await signInAsUser(ownerContext, "annown");
  const ownerPage = await ownerContext.newPage();

  // Nothing set: no banner.
  await ownerPage.goto(EDITOR);
  await expect(ownerPage.locator("main").first()).toBeVisible();
  await expect(banner(ownerPage)).toHaveCount(0);

  // Set one, with markup in it and a link.
  await setViaScreen(adminPage, {
    message: "Maintenance <b>tonight</b> & more",
    link: "https://example.com/status",
    ends: local(2),
  });
  await expect(adminPage.locator("[data-announcement-current]")).toContainText("Showing now");

  const audit = await adminClient()
    .from("admin_audit")
    .select("action")
    .eq("action", "set_announcement")
    .order("id", { ascending: false })
    .limit(1);
  expect(audit.data).toHaveLength(1);

  // The owner sees it, as text.
  await ownerPage.goto(EDITOR);
  await expect(banner(ownerPage)).toBeVisible();
  await expect(ownerPage.locator("[data-announcement-message]")).toHaveText(
    "Maintenance <b>tonight</b> & more",
  );
  await expect(banner(ownerPage).locator("b")).toHaveCount(0);
  const link = banner(ownerPage).getByRole("link", { name: "Read more" });
  await expect(link).toHaveAttribute("href", "https://example.com/status");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // At 390x844 it fits and its controls are touchable.
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(ownerPage);
  await expectTapTargets(ownerPage, "[data-announcement]");
  await ownerPage.setViewportSize({ width: 1440, height: 900 });
  await expectTapTargets(ownerPage, "[data-announcement]");

  // Never on a public page, the marketing site or the sign-in page.
  const publicPage = await rawRequest(`${owner.handle}.localhost:3000`, "/");
  expect(publicPage.body).not.toContain("Maintenance");
  const marketing = await rawRequest("localhost:3000", "/");
  expect(marketing.body).not.toContain("Maintenance");
  expect((await appRaw("/login")).body).not.toContain("Maintenance");

  // Dismiss: gone now, still gone after a reload, remembered by the announcement's id.
  const id = (await banner(ownerPage).getAttribute("data-announcement"))!;
  await banner(ownerPage).getByRole("button", { name: "Dismiss announcement" }).click();
  await expect(banner(ownerPage)).toHaveCount(0);
  await ownerPage.reload();
  await expect(ownerPage.locator("main").first()).toBeVisible();
  await expect(banner(ownerPage)).toHaveCount(0);
  expect(
    await ownerPage.evaluate(
      (key) => window.localStorage.getItem(key),
      `hl-announcement-dismissed:${id}`,
    ),
  ).toBe("1");

  // A new announcement is a new id: it shows again.
  await setViaScreen(adminPage, { message: "Second message", ends: local(3) });
  await ownerPage.reload();
  await expect(banner(ownerPage)).toContainText("Second message");
  expect(await banner(ownerPage).getAttribute("data-announcement")).not.toBe(id);

  // Clear it, then schedule one for later: not shown yet, and the admin sees it as scheduled.
  await adminPage.getByRole("button", { name: "Clear announcement" }).click();
  await expect(adminPage.getByText("No announcement is set.")).toBeVisible();
  await setViaScreen(adminPage, { message: "Later message", starts: local(1), ends: local(2) });
  await expect(adminPage.locator("[data-announcement-current]")).toContainText("Scheduled");
  await ownerPage.reload();
  await expect(banner(ownerPage)).toHaveCount(0);

  // Clear: nothing is left.
  await adminPage.getByRole("button", { name: "Clear announcement" }).click();
  await expect(
    adminPage.getByRole("status").filter({ hasText: "Announcement cleared." }),
  ).toBeVisible();
  await expect(adminPage.getByText("No announcement is set.")).toBeVisible();
  const left = await adminClient()
    .from("announcements")
    .select("id")
    .gt("ends_at", new Date().toISOString());
  expect(left.data).toEqual([]);

  // A signed-in non-admin can't set one.
  const refused = await postApp("/api/admin/announcement", {
    cookie: await sessionCookie(ownerContext),
    body: JSON.stringify({
      message: "nope",
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  });
  expect(refused.status).toBe(403);

  await adminContext.close();
  await ownerContext.close();
});
