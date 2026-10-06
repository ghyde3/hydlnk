import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { appRaw } from "../fixtures/http";
import {
  authorizeRaw,
  mcpAnswers,
  mcpStatus,
  mintGrant,
  pkcePair,
  refreshTokens,
  registerClient,
  removeClients,
  type RegisteredClient,
} from "../fixtures/oauth";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { sessionCookie, signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-10: /admin/apps at 390x844 and 1440x900. Revoke for everyone ends an app's connections and
 * blocks it: its tokens stop at once, it can neither authorize nor refresh, and Restore lets it
 * authorize again. Every test registers its own app, so the two projects can run at once.
 */

test.describe.configure({ timeout: 180_000 });

const made: string[] = [];
test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

const SCREEN = url("app", "/admin/apps");
const rowOf = (page: Page, clientId: string) => page.locator(`tr[data-client-id="${clientId}"]`);

async function newApp(name: string): Promise<RegisteredClient> {
  const client = await registerClient(["https://a.example/cb"], name);
  made.push(client.client_id);
  return client;
}

async function open(page: Page): Promise<void> {
  await page.goto(SCREEN);
  await expect(page.getByRole("heading", { level: 1, name: "Connected apps" })).toBeVisible();
}

test.describe("M13-10 connected apps screen", () => {
  test("M13-10 a signed-out visitor goes to sign-in and a signed-in non-admin gets the 404", async ({
    browser,
  }) => {
    const out = await appRaw("/admin/apps");
    expect([302, 303, 307]).toContain(out.status);
    expect(out.location ?? "").toContain("/login");
    const context = await browser.newContext();
    await signInAsUser(context, "appnon");
    const page = await context.newPage();
    expect((await page.goto(SCREEN))?.status()).toBe(404);
    // The routes refuse a non-admin too.
    const refused = await appRaw("/api/admin/apps/block", {
      method: "POST",
      cookie: await sessionCookie(context),
      headers: { "content-type": "application/json", origin: "http://app.localhost:3000" },
      body: JSON.stringify({ client_id: "hlc_" + "0".repeat(32), reason: "x" }),
    });
    expect(refused.status).toBe(403);
    await context.close();
  });

  test("M13-10 revoke ends the app's tokens and blocks authorize and refresh; restore lets it authorize again", async ({
    browser,
    page,
    context,
  }) => {
    const app = await newApp("Watched app");
    const ownerContext = await browser.newContext();
    const owner = await signInAsUser(ownerContext, "appown");
    const minted = await mintGrant(ownerContext, app.client_id);
    const mcp = await mcpAnswers();
    if (mcp) expect(await mcpStatus(minted.accessToken)).not.toBe(401);

    await signInAsAdmin(context, "appadm");
    await open(page);
    const row = rowOf(page, app.client_id);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Watched app");
    await expect(row).toContainText("Allowed");
    expect(await row.locator("td").nth(1).innerText()).toContain("1");

    // Revoke needs a reason.
    await row.getByRole("button", { name: /^Revoke Watched app for everyone/ }).click();
    await page.getByRole("button", { name: "Revoke app" }).click();
    await expect(page.locator("tr[data-confirm-for] [role=alert]")).toContainText("Give a reason");
    await page.getByLabel("Reason").fill("abusing the publish scope");
    await page.getByRole("button", { name: "Revoke app" }).click();
    await expect(page.getByRole("status")).toContainText("Revoked Watched app for everyone");
    await expect(rowOf(page, app.client_id)).toContainText("Revoked");
    await expect(rowOf(page, app.client_id)).toContainText("abusing the publish scope");

    // At 390 and 1440: no sideways scroll, controls of 44px.
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");

    const stored = await adminClient()
      .from("oauth_clients")
      .select("blocked_at, blocked_reason")
      .eq("client_id", app.client_id)
      .single();
    expect(stored.data?.blocked_at).not.toBeNull();
    const audit = await adminClient()
      .from("admin_audit")
      .select("action")
      .eq("action", "block_app")
      .eq("detail->>client_id", app.client_id);
    expect(audit.data).toHaveLength(1);

    // Its token stopped at once, its refresh is refused, and it can't start a new authorization.
    if (mcp) expect(await mcpStatus(minted.accessToken)).toBe(401);
    const refreshed = await refreshTokens(app.client_id, minted.refreshToken);
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe("invalid_grant");
    const authorize = await authorizeRaw(app.client_id, pkcePair().challenge, undefined, {
      cookie: await sessionCookie(ownerContext),
    });
    expect(authorize.status).toBe(400);
    expect(authorize.body).toContain("HYDLNK has blocked this app.");

    // Restore: authorizing works again, the old refresh token stays dead.
    await rowOf(page, app.client_id)
      .getByRole("button", { name: /^Restore Watched app/ })
      .click();
    await expect(page.getByRole("status")).toContainText("Restored Watched app");
    // With no connection left and no block, an app has nothing to show: it leaves the list.
    await expect(rowOf(page, app.client_id)).toHaveCount(0);
    const again = await authorizeRaw(app.client_id, pkcePair().challenge, undefined, {
      cookie: await sessionCookie(ownerContext),
    });
    expect(again.status).toBe(200);
    expect((await refreshTokens(app.client_id, minted.refreshToken)).status).toBe(400);
    const fresh = await mintGrant(ownerContext, app.client_id);
    expect(fresh.accessToken).not.toBe(minted.accessToken);
    expect(owner.userId).toBeTruthy();
    await ownerContext.close();
  });
});
