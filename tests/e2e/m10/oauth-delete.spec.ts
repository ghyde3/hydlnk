import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { addPage, cleanupUsers, setPlan, signedInUser } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader } from "../fixtures/http";
import {
  APP_ORIGIN,
  authorizeQuery,
  count,
  mcpAnswers,
  mcpStatus,
  mintGrant,
  ownIp,
  pkcePair,
  refreshTokens,
  registerClient,
  removeClients,
  rows,
} from "../fixtures/oauth";

/**
 * M10-19: deleting an account disconnects every connected app first, and nothing of it remains. The
 * database shows what is left (secret key), the endpoints show that the tokens are dead.
 */

const made: string[] = [];
test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

const SETTINGS = `${APP_ORIGIN}/settings`;
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Delete your account?" });

async function app(name: string) {
  const client = await registerClient(["https://a.example/cb"], name);
  made.push(client.client_id);
  return client;
}

async function openDeleteDialog(page: Page) {
  await page.goto(SETTINGS);
  await page.locator("main").getByRole("button", { name: "Delete account" }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmDelete(page: Page, handle: string) {
  const dialog = await openDeleteDialog(page);
  await dialog.getByLabel("Type your handle to confirm").fill(handle);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  return dialog;
}

async function userExists(id: string): Promise<boolean> {
  return (await adminClient().auth.admin.getUserById(id)).data.user !== null;
}

test.describe("M10-19 account deletion", () => {
  test("M10-19 every connected app is disconnected, nothing of the wave remains for the user, and the clients stay", async ({
    page,
    context,
  }) => {
    const me = await signedInUser(context, { label: "del1" });
    const one = await app("Zq Delete One");
    const two = await app("Zq Delete Two");
    const a = await mintGrant(context, one.client_id);
    const b = await mintGrant(context, two.client_id);
    // A pending request of this person (drawn, not answered).
    const screen = await appRaw(
      `/oauth/authorize?${authorizeQuery(one.client_id, pkcePair().challenge)}`,
      {
        cookie: cookieHeader(await authCookies(context)),
        headers: { "x-forwarded-for": ownIp() },
      },
    );
    expect(screen.status).toBe(200);
    expect(await count("oauth_grants", { user_id: me.userId })).toBe(2);
    expect(await count("oauth_tokens", { user_id: me.userId })).toBe(4);
    expect(await count("oauth_authorization_codes", { user_id: me.userId })).toBeGreaterThanOrEqual(
      3,
    );
    const mcp = await mcpAnswers();
    if (mcp) expect(await mcpStatus(a.accessToken)).not.toBe(401);

    await confirmDelete(page, me.handle);
    await page.waitForURL(`${APP_ORIGIN}/login?deleted=1`);
    expect(await userExists(me.userId)).toBe(false);

    // Nothing of the wave remains for the user; the clients they used are not theirs and stay.
    for (const table of ["oauth_grants", "oauth_tokens", "oauth_authorization_codes"]) {
      expect(await count(table, { user_id: me.userId }), table).toBe(0);
    }
    expect(await rows("oauth_clients", { client_id: one.client_id })).toHaveLength(1);
    expect(await rows("oauth_clients", { client_id: two.client_id })).toHaveLength(1);

    // A token and a refresh token minted before the deletion are dead afterwards.
    if (mcp) {
      expect(await mcpStatus(a.accessToken)).toBe(401);
      expect(await mcpStatus(b.accessToken)).toBe(401);
    }
    expect((await refreshTokens(one.client_id, a.refreshToken)).body.error).toBe("invalid_grant");
    expect((await refreshTokens(two.client_id, b.refreshToken)).body.error).toBe("invalid_grant");
  });

  test("M10-19 when disconnecting fails the dialog says so, nothing else runs, and the account still exists", async ({
    page,
    context,
  }) => {
    const me = await signedInUser(context, { label: "del2" });
    const client = await app("Zq Delete Fails");
    const minted = await mintGrant(context, client.client_id);
    await context.addCookies([{ name: "hl-fault", value: "grants-revoke", url: APP_ORIGIN }]);

    const dialog = await confirmDelete(page, me.handle);
    await expect(dialog).toContainText("We couldn’t disconnect your apps. Try again.");
    expect(await userExists(me.userId)).toBe(true);
    const pages = await rows("pages", { owner_id: me.userId });
    expect(pages).toHaveLength(1);
    const grants = await rows<{ revoked_at: string | null }>("oauth_grants", {
      user_id: me.userId,
    });
    expect(grants[0]!.revoked_at).toBeNull();
    expect((await refreshTokens(client.client_id, minted.refreshToken)).status).toBe(200);

    // Without the fault the same dialog goes through.
    await context.clearCookies({ name: "hl-fault" });
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await page.waitForURL(`${APP_ORIGIN}/login?deleted=1`);
    expect(await userExists(me.userId)).toBe(false);
  });

  test("M10-19 deleting one page leaves every connection untouched (grants are account-wide)", async ({
    page,
    context,
  }) => {
    const me = await signedInUser(context, { label: "del3" });
    await setPlan(me.userId, "pro");
    const extra = `zq-del3x-${Math.random().toString(36).slice(2, 7)}`;
    await addPage(me.userId, extra);
    const client = await app("Zq Page Delete");
    const minted = await mintGrant(context, client.client_id);

    await page.goto(SETTINGS);
    const row = page.locator(`[data-page-row="${extra}"]`);
    await row.getByRole("button", { name: "Delete site" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type the handle to confirm").fill(extra);
    await dialog.getByRole("button", { name: "Delete site" }).click();
    await expect(page.locator(`[data-page-row="${extra}"]`)).toHaveCount(0);

    const grants = await rows<{ revoked_at: string | null }>("oauth_grants", {
      user_id: me.userId,
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.revoked_at).toBeNull();
    expect((await refreshTokens(client.client_id, minted.refreshToken)).status).toBe(200);
  });

  test("M10-19 a suspended account still cannot delete itself, and its connections are not touched by the refusal", async ({
    page,
    context,
  }) => {
    const me = await signedInUser(context, { label: "del4" });
    const client = await app("Zq Suspended Delete");
    await mintGrant(context, client.client_id);
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", me.userId);
    const dialog = await confirmDelete(page, me.handle);
    await expect(dialog).toContainText(
      "Your account is suspended, so it can’t be deleted. Contact support to appeal.",
    );
    expect(await userExists(me.userId)).toBe(true);
    const grants = await rows<{ revoked_at: string | null }>("oauth_grants", {
      user_id: me.userId,
    });
    expect(grants[0]!.revoked_at).toBeNull();
  });
});
