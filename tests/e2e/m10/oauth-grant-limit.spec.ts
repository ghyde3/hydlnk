import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, signedInUser } from "../fixtures/data";
import {
  APP_ORIGIN,
  CLIENT_REDIRECT,
  answer,
  authorizeUrl,
  ownAddress,
  pkcePair,
  registerClient,
  removeClients,
  rows,
} from "../fixtures/oauth";

/**
 * M10-13 and M10-05: at 20 active connected apps a new Allow is refused with a sentence and a way to
 * Settings, the pending request survives the visit, and a re-consent for an app that is still connected
 * is allowed (it adds nothing). The limit is the database's (HL007); the screen only words it.
 */

test.beforeEach(async ({ context }) => {
  await ownAddress(context);
});

const made: string[] = [];
test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

async function twentyGrants(userId: string): Promise<string[]> {
  const admin = adminClient();
  const ids = Array.from({ length: 20 }, () => `hlc_${randomBytes(16).toString("hex")}`);
  made.push(...ids);
  const clients = await admin.from("oauth_clients").insert(
    ids.map((client_id, i) => ({
      client_id,
      kind: "dcr",
      client_name: `Zq Limit App ${i + 1}`,
      redirect_uris: [CLIENT_REDIRECT],
    })),
  );
  if (clients.error) throw new Error(clients.error.message);
  const grants = await admin
    .from("oauth_grants")
    .insert(ids.map((client_id) => ({ user_id: userId, client_id, scopes: ["hydlnk.read"] })));
  if (grants.error) throw new Error(grants.error.message);
  return ids;
}

test("M10-13 at 20 apps Allow is refused with the sentence and a link to Settings; the request survives; a re-consent is allowed; a freed slot lets the new app in", async ({
  page,
  context,
}) => {
  const me = await signedInUser(context, { label: "gl1" });
  const connected = await twentyGrants(me.userId);
  const fresh = await registerClient();
  made.push(fresh.client_id);

  await page.goto(authorizeUrl(fresh.client_id, pkcePair().challenge));
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator("main")).toContainText(
    "You have 20 connected apps. Remove one in Settings, then try again.",
  );
  const link = page.getByRole("link", { name: "Open Settings" });
  await expect(link).toHaveAttribute("href", "/settings");
  const pending = await rows<{ status: string }>("oauth_authorization_codes", {
    client_id: fresh.client_id,
  });
  expect(pending[0]!.status).toBe("pending");
  expect(await rows("oauth_grants", { client_id: fresh.client_id })).toHaveLength(0);

  // A re-consent for an app that is still connected is allowed at 20, and adds nothing.
  await page.goto(authorizeUrl(connected[0]!, pkcePair().challenge));
  await expect(page.locator("body")).toContainText("You’ve connected this app before.");
  const decision = await answer(page, "Allow");
  expect(decision.location.searchParams.has("code")).toBe(true);
  expect(await rows("oauth_grants", { user_id: me.userId })).toHaveLength(20);

  // Remove one in Settings, then try again.
  await page.goto(`${APP_ORIGIN}/settings`);
  await page.getByRole("button", { name: "Revoke Zq Limit App 2", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "can no longer access your pages" }),
  ).toBeVisible();
  await page.goto(authorizeUrl(fresh.client_id, pkcePair().challenge));
  const allowed = await answer(page, "Allow");
  expect(allowed.location.searchParams.has("code")).toBe(true);
  const active = await rows<{ revoked_at: string | null }>("oauth_grants", { user_id: me.userId });
  expect(active.filter((grant) => grant.revoked_at === null)).toHaveLength(20);
});
