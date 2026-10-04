import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { sha256Hex } from "@/lib/oauth/tokens";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers, desktopOnly, phoneOnly, rand, signedInUser } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  APP_ORIGIN,
  mcpAnswers,
  mcpStatus,
  mintGrant,
  refreshTokens,
  registerClient,
  removeClients,
  rows,
} from "../fixtures/oauth";

/**
 * M10-18: the Connected apps card on Settings & billing: what is connected, when it was last used,
 * and Revoke, which ends the connection at once. Grants are made over the real endpoints
 * (`mintGrant`), so a Revoke is proved by what the endpoints say afterwards.
 */

const made: string[] = [];
test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

const SETTINGS = `${APP_ORIGIN}/settings`;
const card = (page: Page) =>
  page.locator("main section", {
    has: page.getByRole("heading", { level: 2, name: "Connected apps" }),
  });

async function app(name: string, redirects = ["https://a.example/cb"]) {
  const client = await registerClient(redirects, name);
  made.push(client.client_id);
  return client;
}

async function cachedClient(name: string, host: string) {
  const clientId = `https://${host}/oauth/client.json`;
  const { error } = await adminClient()
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      kind: "cimd",
      client_name: name,
      redirect_uris: ["https://a.example/cb"],
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
  if (error) throw new Error(error.message);
  made.push(clientId);
  return clientId;
}

const today = () =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date());

async function user(context: BrowserContext, label: string) {
  return signedInUser(context, { label });
}

test.describe("M10-18 the card", () => {
  test("M10-18 sits between Pages and Account, with its intro and the link to the connect page", async ({
    page,
    context,
  }) => {
    await user(context, "ca1");
    await page.goto(SETTINGS);
    const titles = await page.locator("main section > h2").allInnerTexts();
    const at = titles.indexOf("Connected apps");
    expect(at).toBeGreaterThan(0);
    expect(titles[at - 1]).toBe("Pages");
    expect(titles[at + 1]).toBe("Account");
    await expect(card(page)).toContainText(
      "Apps you’ve let manage your pages, like Claude or ChatGPT. Remove one to cut off its access.",
    );
    const link = card(page).getByRole("link", { name: "How to connect an app" });
    await expect(link).toHaveAttribute("href", "http://localhost:3000/connect");
    await expect(card(page)).toContainText("No apps are connected yet.");
  });

  test("M10-18 one row per active grant: name, address or 'not verified', what it may do, dates, and Revoke", async ({
    page,
    context,
  }) => {
    await user(context, "ca2");
    const registered = await app("Zq Registered App");
    const metadataId = await cachedClient("Zq Metadata App", `zq-${rand(5)}.example.org`);
    await mintGrant(context, registered.client_id, { scopes: ["hydlnk.write", "hydlnk.publish"] });
    await mintGrant(context, metadataId, { scopes: [] });
    await page.goto(SETTINGS);

    const registeredRow = card(page).locator('[data-connected-app="Zq Registered App"]');
    await expect(registeredRow).toContainText("Registered automatically. Not verified.");
    await expect(registeredRow).toContainText("Can see your pages and analytics");
    await expect(registeredRow).toContainText("Can edit your drafts");
    await expect(registeredRow).toContainText("Can publish your pages");
    await expect(registeredRow).toContainText(`Connected ${today()}`);
    await expect(registeredRow).toContainText("Not used yet");
    await expect(
      registeredRow.getByRole("button", { name: "Revoke Zq Registered App" }),
    ).toBeVisible();

    const metadataRow = card(page).locator('[data-connected-app="Zq Metadata App"]');
    await expect(metadataRow).toContainText(/Address: zq-[a-z0-9]+\.example\.org/);
    await expect(metadataRow).toContainText("Can see your pages and analytics");
    await expect(metadataRow).not.toContainText("Can edit your drafts");
    await expect(metadataRow).not.toContainText("Can publish your pages");

    // Never a token, a hash, a client id or a grant id as text.
    const text = await card(page).innerText();
    expect(text).not.toMatch(/hl_(at|rt|ac)_|hlc_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    expect(text).not.toContain(registered.client_id);
    expect(text).not.toContain(metadataId);
  });

  test("M10-18 most recently used first, and 'Last used' shows the grant's last use", async ({
    page,
    context,
  }) => {
    const me = await user(context, "ca3");
    const first = await app("Zq First App");
    const second = await app("Zq Second App");
    await mintGrant(context, first.client_id);
    await mintGrant(context, second.client_id);
    const grants = await rows<{ id: string; client_id: string }>("oauth_grants", {
      user_id: me.userId,
    });
    const firstGrant = grants.find((g) => g.client_id === first.client_id)!;
    await adminClient()
      .from("oauth_grants")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", firstGrant.id);
    await page.goto(SETTINGS);
    const names = await card(page)
      .locator("[data-connected-app]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-connected-app")));
    expect(names).toEqual(["Zq First App", "Zq Second App"]);
    await expect(card(page).locator('[data-connected-app="Zq First App"]')).toContainText(
      `Last used ${today()}`,
    );
    await expect(card(page).locator('[data-connected-app="Zq Second App"]')).toContainText(
      "Not used yet",
    );
  });

  test("M10-18 another person's grants never appear, and neither do ended ones", async ({
    page,
    context,
    browser,
  }, info) => {
    await user(context, "ca4");
    const other = await browser.newContext(info.project.use as object);
    await user(other, "ca4b");
    const theirs = await app("Zq Their App");
    const mine = await app("Zq My App");
    await mintGrant(other, theirs.client_id);
    const minted = await mintGrant(context, mine.client_id);
    await page.goto(SETTINGS);
    await expect(card(page).locator("[data-connected-app]")).toHaveCount(1);
    await expect(card(page)).not.toContainText("Zq Their App");
    // A connection that ended (the refresh token was copied and used twice) leaves the card.
    const rotated = await refreshTokens(mine.client_id, minted.refreshToken);
    expect(rotated.status).toBe(200);
    // Past the 60 second grace window (moved back in the table rather than waiting).
    await adminClient()
      .from("oauth_tokens")
      .update({ rotated_at: new Date(Date.now() - 120_000).toISOString() })
      .eq("token_hash", sha256Hex(minted.refreshToken));
    expect((await refreshTokens(mine.client_id, minted.refreshToken)).body.error).toBe(
      "invalid_grant",
    );
    await page.reload();
    await expect(card(page).locator("[data-connected-app]")).toHaveCount(0);
    await expect(card(page)).toContainText("No apps are connected yet.");
    await other.close();
  });

  test("M10-18 a read that fails says so, and the rest of the screen renders", async ({
    page,
    context,
  }) => {
    await user(context, "ca5");
    await context.addCookies([{ name: "hl-fault", value: "connected-apps-load", url: APP_ORIGIN }]);
    await page.goto(SETTINGS);
    await expect(card(page)).toContainText(
      "We couldn’t load your connected apps. Reload to try again.",
    );
    await expect(page.getByRole("heading", { level: 2, name: "Account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test.describe("M10-18 Revoke", () => {
  test("M10-18 Revoke removes the row with a status message, and the connection ends at once", async ({
    page,
    context,
  }) => {
    await user(context, "cr1");
    const client = await app("Zq Revoked App");
    const keep = await app("Zq Kept App");
    const minted = await mintGrant(context, client.client_id);
    const kept = await mintGrant(context, keep.client_id);
    const mcp = await mcpAnswers();
    if (mcp) expect(await mcpStatus(minted.accessToken)).not.toBe(401);

    await page.goto(SETTINGS);
    await card(page).getByRole("button", { name: "Revoke Zq Revoked App" }).click();
    await expect(card(page).getByRole("status")).toHaveText(
      "Zq Revoked App can no longer access your pages.",
    );
    await expect(card(page).locator('[data-connected-app="Zq Revoked App"]')).toHaveCount(0);
    await expect(card(page).locator('[data-connected-app="Zq Kept App"]')).toHaveCount(1);

    // The connection is dead: its access token is a 401 and its refresh token is invalid_grant.
    if (mcp) expect(await mcpStatus(minted.accessToken)).toBe(401);
    expect((await refreshTokens(client.client_id, minted.refreshToken)).body.error).toBe(
      "invalid_grant",
    );
    // The other connection still works.
    expect((await refreshTokens(keep.client_id, kept.refreshToken)).status).toBe(200);
    // And it is gone after a reload too.
    await page.reload();
    await expect(card(page).locator('[data-connected-app="Zq Revoked App"]')).toHaveCount(0);
    const grant = await rows<{ revoked_at: string | null }>("oauth_grants", {
      client_id: client.client_id,
    });
    expect(grant[0]!.revoked_at).not.toBeNull();
    const tokens = await rows<{ revoked_at: string | null }>("oauth_tokens", {
      grant_id: (await rows<{ id: string }>("oauth_grants", { client_id: client.client_id }))[0]!
        .id,
    });
    expect(tokens.every((t) => t.revoked_at !== null)).toBe(true);
  });

  test("M10-18 revoking is not blocked for a suspended account", async ({ page, context }) => {
    const me = await user(context, "cr2");
    const client = await app("Zq Suspended Revoke");
    await mintGrant(context, client.client_id);
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", me.userId);
    await page.goto(SETTINGS);
    await card(page).getByRole("button", { name: "Revoke Zq Suspended Revoke" }).click();
    await expect(card(page).getByRole("status")).toHaveText(
      "Zq Suspended Revoke can no longer access your pages.",
    );
  });

  test("M10-18 the card of a second person is unchanged by the first person's Revoke", async ({
    page,
    context,
    browser,
  }, info) => {
    await user(context, "cr3");
    const other = await browser.newContext(info.project.use as object);
    await user(other, "cr3b");
    const shared = await app("Zq Shared App");
    const mineGrant = await mintGrant(context, shared.client_id);
    const theirGrant = await mintGrant(other, shared.client_id);
    await page.goto(SETTINGS);
    await card(page).getByRole("button", { name: "Revoke Zq Shared App" }).click();
    await expect(card(page).getByRole("status")).toBeVisible();
    expect((await refreshTokens(shared.client_id, mineGrant.refreshToken)).body.error).toBe(
      "invalid_grant",
    );
    expect((await refreshTokens(shared.client_id, theirGrant.refreshToken)).status).toBe(200);
    const theirPage = await other.newPage();
    await theirPage.goto(SETTINGS);
    await expect(card(theirPage).locator('[data-connected-app="Zq Shared App"]')).toHaveCount(1);
    await other.close();
  });
});

test.describe("M10-18 layout", () => {
  test("M10-18 at 390: the rows stack, long names wrap, nothing scrolls sideways, every target is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await user(context, "cl1");
    const longName =
      "Zq A Connected App With A Remarkably Long Name That Must Wrap Onto Several Lines Cleanly";
    const one = await app(longName);
    const two = await cachedClient(
      "Zq Metadata Long Host",
      `a-remarkably-long-host-name-${rand(6)}.example-company-with-a-long-name.org`,
    );
    await mintGrant(context, one.client_id);
    await mintGrant(context, two);
    await page.goto(SETTINGS);
    await expect(card(page).locator("[data-connected-app]")).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-connected-apps]");

    const row = card(page).locator("[data-connected-app]").first();
    const details = (await row.locator("> div").first().boundingBox())!;
    const button = (await row.getByRole("button").boundingBox())!;
    expect(button.y).toBeGreaterThan(details.y + details.height - 1);
    const section = (await card(page).boundingBox())!;
    expect(button.width).toBeGreaterThan(section.width - 50);
    expect(button.height).toBeGreaterThanOrEqual(44);
  });

  test("M10-18 at 1440: the width of the other cards, a row with the details at the left and Revoke at the end, axe clean empty and full", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await user(context, "cl2");
    await page.goto(SETTINGS);
    expect(await axeViolations(page)).toEqual([]);
    const client = await app("Zq Desktop App");
    await mintGrant(context, client.client_id);
    await page.goto(SETTINGS);
    expect(await axeViolations(page)).toEqual([]);

    const connected = (await card(page).boundingBox())!;
    const pages = (await page
      .locator("main section", { has: page.getByRole("heading", { level: 2, name: "Pages" }) })
      .boundingBox())!;
    expect(Math.abs(connected.width - pages.width)).toBeLessThan(1);
    expect(connected.width).toBeLessThanOrEqual(920);

    const row = card(page).locator("[data-connected-app]").first();
    const details = (await row.locator("> div").first().boundingBox())!;
    const button = (await row.getByRole("button").boundingBox())!;
    expect(Math.abs(button.y + button.height / 2 - (details.y + details.height / 2))).toBeLessThan(
      40,
    );
    expect(button.x).toBeGreaterThan(details.x + details.width - 5);
    expect(button.x + button.width).toBeGreaterThan(connected.x + connected.width - 40);
    await expectNoHorizontalScroll(page);
  });
});
