import { expect, test, type Page } from "@playwright/test";
import { claimHandleWithClient } from "@/lib/handles/claim-core";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, makeUser, rand } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-08: /admin/reserved at 390x844 and 1440x900. Every test uses its own random handles (removed
 * again) and its own admin; the actions' rules are in tests/unit/m13-admin-reserved-announcement-apps.
 */

test.describe.configure({ timeout: 120_000 });

const made: string[] = [];
const handleName = () => {
  const handle = `zq-rv-${rand(8)}`;
  made.push(handle);
  return handle;
};

test.afterAll(async () => {
  for (const handle of made) {
    await adminClient().rpc("admin_remove_reserved_handle", { p_handle: handle });
  }
  await cleanupUsers();
});

const SCREEN = url("app", "/admin/reserved");
const form = (page: Page) => page.getByRole("form", { name: "Reserve a handle" });
const rowOf = (page: Page, handle: string) => page.locator(`tr[data-handle="${handle}"]`);

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(query ? `${SCREEN}?q=${encodeURIComponent(query)}` : SCREEN);
  await expect(page.getByRole("heading", { level: 1, name: "Reserved handles" })).toBeVisible();
  await page.waitForFunction(() => {
    const input = document.querySelector("form[aria-label='Reserve a handle'] input");
    return !!input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
  });
}

async function reserve(page: Page, handle: string, reason: string): Promise<void> {
  await form(page).getByLabel("Handle", { exact: true }).fill(handle);
  await form(page).getByLabel("Reason", { exact: true }).fill(reason);
  await form(page).getByRole("button", { name: "Reserve handle" }).click();
}

test.describe("M13-08 reserved handles screen", () => {
  test("M13-08 a signed-out visitor goes to sign-in and a signed-in non-admin gets the 404", async ({
    browser,
  }) => {
    const out = await appRaw("/admin/reserved");
    expect([302, 303, 307]).toContain(out.status);
    expect(out.location ?? "").toContain("/login");

    const context = await browser.newContext();
    await signInAsUser(context, "rvnon");
    const page = await context.newPage();
    const response = await page.goto(SCREEN);
    expect(response?.status()).toBe(404);
    await context.close();
  });

  test("M13-08 an admin reserves a handle, a new signup with it is refused, and removing it lets it be claimed", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "rvadm");
    await open(page);
    const handle = handleName();
    await reserve(page, handle, "a brand");
    await expect(page.getByRole("status")).toContainText(`Reserved ${handle}`);

    await open(page, handle);
    const row = rowOf(page, handle);
    await expect(row).toBeVisible();
    await expect(row).toContainText("a brand");
    await expect(row).toContainText("Added");

    // A new signup with it is refused (the claim path is the signup's handle step).
    const newcomer = await makeUser("rvnew");
    expect(await claimHandleWithClient(adminClient(), newcomer.id, handle)).toMatchObject({
      ok: false,
      error: "reserved",
    });

    await row.getByRole("button", { name: `Remove ${handle}` }).click();
    await page.getByRole("button", { name: "Remove reservation" }).click();
    await expect(page.getByRole("status")).toContainText(`Removed ${handle}`);
    await expect(rowOf(page, handle)).toHaveCount(0);
    expect(await claimHandleWithClient(adminClient(), newcomer.id, handle)).toMatchObject({
      ok: true,
    });
  });

  test("M13-08 a platform name shows Locked and has no Remove; a bad handle shows the rule", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "rvlock");
    await open(page, "www");
    const www = rowOf(page, "www");
    await expect(www).toBeVisible();
    await expect(www.locator("[data-locked]")).toBeVisible();
    await expect(www.getByRole("button")).toHaveCount(0);

    await reserve(page, "a b", "");
    await expect(form(page).getByRole("alert").first()).toContainText("3 to 30 characters");
  });

  test("M13-08 adding a handle somebody holds names the holder and changes nothing for them", async ({
    page,
    context,
  }) => {
    const holderContext = await page.context().browser()!.newContext();
    const holder = await signInAsUser(holderContext, "rvheld");
    await holderContext.close();
    await signInAsAdmin(context, "rvheld-adm");
    await open(page);
    made.push(holder.handle!);
    await reserve(page, holder.handle!, "taken already");
    await expect(page.getByRole("status")).toContainText("nothing changes for them");
    await expect(page.getByRole("status")).toContainText(holder.email);
    const kept = await adminClient().from("pages").select("owner_id").eq("handle", holder.handle!);
    expect(kept.data).toEqual([{ owner_id: holder.userId }]);
  });

  test("M13-08 the screen has no horizontal scroll and every control is at least 44px", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(context, "rvlay");
    const handle = handleName();
    await open(page);
    await reserve(page, handle, "a brand with a fairly long reason to wrap on a phone screen");
    await open(page, handle);
    await expect(rowOf(page, handle)).toBeVisible();
    await rowOf(page, handle)
      .getByRole("button", { name: `Remove ${handle}` })
      .click();
    await expect(page.getByRole("button", { name: "Remove reservation" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
    await open(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
  });
});
