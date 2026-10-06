import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-09: access and layout of /admin/announcement at 390x844 and 1440x900. Read-only, so the phone
 * and the desktop projects can run it at once; what an announcement does to the editor is the one
 * stateful flow in admin-announcement-flow.spec.ts (the table holds one message at a time).
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const SCREEN = url("app", "/admin/announcement");

async function open(page: Page): Promise<void> {
  await page.goto(SCREEN);
  await expect(page.getByRole("heading", { level: 1, name: "Announcement" })).toBeVisible();
  await page.waitForFunction(() => {
    const field = document.querySelector("form[aria-label='Set the announcement'] textarea");
    return !!field && Object.keys(field).some((key) => key.startsWith("__reactProps$"));
  });
}

test.describe("M13-09 announcement screen", () => {
  test("M13-09 a signed-out visitor goes to sign-in and a signed-in non-admin gets the 404", async ({
    browser,
  }) => {
    const out = await appRaw("/admin/announcement");
    expect([302, 303, 307]).toContain(out.status);
    expect(out.location ?? "").toContain("/login");
    const context = await browser.newContext();
    await signInAsUser(context, "annnon");
    const page = await context.newPage();
    expect((await page.goto(SCREEN))?.status()).toBe(404);
    await context.close();
  });

  test("M13-09 the form has no horizontal scroll and every control is at least 44px", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "annlay");
    await open(page);
    await expect(page.getByLabel("Message")).toBeVisible();
    await expect(page.getByLabel("Link (optional)")).toBeVisible();
    await expect(page.getByLabel("Starts")).toBeVisible();
    await expect(page.getByLabel("Ends")).toBeVisible();
    await page
      .getByRole("button", { name: /announcement$/i })
      .last()
      .click();
    await expect(
      page.getByText("Write the message.").or(page.getByText("Choose when it ends.")),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
  });
});
