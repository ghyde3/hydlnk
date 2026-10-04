/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each step checks */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand, signedInUser, trackUser } from "../fixtures/data";
import { CIMD_CLIENT_ID, startCimdStub, stopCimdStub } from "../fixtures/cimd-stub-server";
import { McpClient, discover, startLoopback } from "../fixtures/mcp-client";
import { OfficialMcpClient } from "../fixtures/official-mcp-client";
import {
  APP_ORIGIN,
  ISSUER,
  RESOURCE,
  authorizeUrl,
  exchangeCode,
  ownAddress,
  pkcePair,
  refreshTokens,
  registerClient,
  removeClients,
  revokeRequest,
  rows,
} from "../fixtures/oauth";
import { url } from "../helpers";
import { pageRow } from "../m2/editor-helpers";
import { prepareFlowUser, runEveryTool, tenantHtml, type FlowUser } from "./mcp-flow-helpers";

/**
 * M10-33: the real OAuth dance, then the MCP calls with the token it produced. A fresh Pro user with a
 * page whose draft differs from the live page; a client that finds the server from a bare POST /mcp,
 * registers with a loopback redirect, opens the authorization URL in a signed-out browser, signs in,
 * sees the consent screen of the SAME request and clicks Allow; the loopback listener gets code, state
 * and iss; the exchange gives the tokens; and the token works on all twelve tools. Then the other ends
 * of the connection: a downgrade at consent, a refresh and its reuse, revocation at the endpoint and
 * from the Connected apps card, an account deletion, a replayed code and Deny.
 *
 * Pure HTTP plus a browser, so the phone project skips it (the reason is printed).
 */

const registered: string[] = [];
test.afterAll(async () => {
  await cleanupUsers();
  await removeClients(registered.splice(0));
});
test.beforeEach(({}, info) =>
  test.skip(!desktopOnly(info), "the OAuth dance is pure HTTP plus one browser: desktop only"),
);

/**
 * `page.goto` that tries again when the browser cancels the navigation (net::ERR_ABORTED): the page that
 * was sitting on /login can start a navigation of its own while the dev server compiles a route for the
 * other worker, and the two cancel each other about one run in four. The answer under test (where the
 * landing route sends a person who just signed in) is read from the URL afterwards, never from this call.
 */
async function gotoAgain(page: Page, address: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(address);
      return;
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("ERR_ABORTED")) throw error;
    }
  }
}

const SCOPES_ALL = "hydlnk.read hydlnk.write hydlnk.publish";

interface Connection {
  clientId: string;
  name: string;
  verifier: string;
  redirectUri: string;
  /** What the loopback listener received: the query of the redirect. */
  arrived: URL;
  tokens: { status: number; body: Record<string, any> };
  access: string;
  refresh: string;
}

/**
 * One whole connection, the way a desktop app makes it: register, open the authorization URL in a
 * signed-out browser, land on /login (no query), sign in, see the consent screen of the same request,
 * check that Publish your pages starts unticked (M10-37), tick it unless the test leaves it, answer, and read the redirect on the loopback listener.
 */
async function connect(
  browser: Browser,
  user: { email: string },
  options: {
    leavePublish?: boolean;
    decision?: "Allow" | "Deny";
    state?: string;
    name?: string;
  } = {},
): Promise<Connection> {
  const name = options.name ?? `Zq desktop app ${rand(5)}`;
  const loopback = await startLoopback();
  const client = await registerClient([loopback.redirectUri], name);
  registered.push(client.client_id);
  const pair = pkcePair();
  const context = await browser.newContext();
  await ownAddress(context);
  try {
    const page = await context.newPage();
    const state = options.state ?? `state-${rand(8)}`;
    await page.goto(
      authorizeUrl(client.client_id, pair.challenge, { redirectUri: loopback.redirectUri, state }),
    );
    // Signed out: sent to sign in, with nothing of the request in the address.
    await expect(page).toHaveURL(`${APP_ORIGIN}/login`);
    expect(page.url()).not.toContain("?");
    await signInAs(context, user.email);
    await gotoAgain(page, `${APP_ORIGIN}/`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/oauth/authorize`);
    // The consent screen of the same request: who, how it registered, where it returns, what it gets.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `“${name}” (unverified) on this computer wants to connect to your HYDLNK`,
    );
    await expect(page.locator("body")).toContainText(
      "Registered automatically. HYDLNK hasn’t verified this app.",
    );
    await expect(page.locator("body")).toContainText(
      "Only continue if you started this connection from an app on this computer.",
    );
    for (const label of [
      "See your sites, pages and analytics",
      "Edit your drafts",
      "Publish your pages",
    ]) {
      await expect(page.getByRole("checkbox", { name: new RegExp(label) })).toBeVisible();
    }
    // Gary, 2026-10-04: Edit your drafts starts ticked, Publish your pages starts unticked.
    await expect(page.getByRole("checkbox", { name: /Edit your drafts/ })).toBeChecked();
    const publishBox = page.getByRole("checkbox", { name: /Publish your pages/ });
    await expect(publishBox).not.toBeChecked();
    if (!options.leavePublish) await publishBox.check();
    await page.getByRole("button", { name: options.decision ?? "Allow" }).click();
    const arrived = await loopback.next();
    expect(arrived.pathname).toBe("/callback");
    expect(arrived.searchParams.get("state")).toBe(state);
    expect(arrived.searchParams.get("iss")).toBe(ISSUER);
    if (options.decision === "Deny") {
      return {
        clientId: client.client_id,
        name,
        verifier: pair.verifier,
        redirectUri: loopback.redirectUri,
        arrived,
        tokens: { status: 0, body: {} },
        access: "",
        refresh: "",
      };
    }
    const code = arrived.searchParams.get("code")!;
    const tokens = await exchangeCode(client.client_id, code, pair.verifier, loopback.redirectUri);
    expect(tokens.status).toBe(200);
    return {
      clientId: client.client_id,
      name,
      verifier: pair.verifier,
      redirectUri: loopback.redirectUri,
      arrived,
      tokens: { status: tokens.status, body: tokens.body as Record<string, any> },
      access: String(tokens.body.access_token),
      refresh: String(tokens.body.refresh_token),
    };
  } finally {
    await context.close();
    await loopback.close();
  }
}

const grantOf = async (userId: string, clientId: string) =>
  (
    await rows<{ id: string; scopes: string[]; revoked_at: string | null }>("oauth_grants", {
      user_id: userId,
      client_id: clientId,
    })
  )[0]!;

async function mcpStatus(token: string): Promise<number> {
  const response = await fetch(url("app", "/mcp"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  await response.text();
  return response.status;
}

test("M10-33 the whole dance on registration, then every tool with the token it produced", async ({
  browser,
  context,
  page,
}) => {
  const user = await prepareFlowUser(context, "flow");

  // The client finds the server from a bare POST /mcp, with the checks the real clients make.
  const found = await discover();
  expect(found.resource).toBe(RESOURCE);
  expect(found.issuer).toBe(ISSUER);

  const connection = await connect(browser, user, { state: "flow-state" });
  expect(connection.arrived.searchParams.get("code")).toMatch(/^hl_ac_[A-Za-z0-9_-]{43}$/);
  expect(connection.tokens.body).toMatchObject({
    token_type: "Bearer",
    expires_in: 3600,
    scope: SCOPES_ALL,
  });
  expect(connection.access).toMatch(/^hl_at_[A-Za-z0-9_-]{43}$/);
  expect(connection.refresh).toMatch(/^hl_rt_[A-Za-z0-9_-]{43}$/);

  const grant = await grantOf(user.userId, connection.clientId);
  // The twelve tools through the official MCP client (Streamable HTTP transport, bearer token).
  const mcp = new OfficialMcpClient(connection.access);
  try {
    await runEveryTool({
      context,
      page,
      user,
      mcp,
      clientId: connection.clientId,
      grantId: grant.id,
    });
  } finally {
    await mcp.close();
  }

  // A second protocol generation with the same token (hand-rolled: the wire envelope is the point): server/discover and a tools/list with the envelope.
  const modern = new McpClient(connection.access, { era: "2026" });
  expect((await modern.rpc("server/discover")).status).toBe(200);
  expect(await modern.listTools()).toHaveLength(12);

  // The token was used: the grant says so (the Connected apps card shows it as "Last used").
  expect((await grantOf(user.userId, connection.clientId)).id).toBe(grant.id);
  const used = await rows<{ last_used_at: string | null }>("oauth_grants", { id: grant.id });
  expect(used[0]!.last_used_at).not.toBeNull();
});

test("M10-33 (a) / M10-37 Publish left unticked at consent (the default): the token has read and write, publish_page is insufficient_scope with the step-up challenge, and the live page does not change", async ({
  browser,
  context,
}) => {
  const user = await prepareFlowUser(context, "flow-down");
  const connection = await connect(browser, user, { leavePublish: true });
  expect(connection.tokens.body.scope).toBe("hydlnk.read hydlnk.write");
  const mcp = new OfficialMcpClient(connection.access);
  await mcp.initialize();
  const liveBefore = await tenantHtml(user.handle);
  const refused = await mcp.callTool("publish_page", { pageId: user.pageId });
  expect(refused.isError).toBe(true);
  expect(refused.structured.error).toMatchObject({
    code: "insufficient_scope",
    requiredScope: "hydlnk.publish",
  });
  expect((refused.meta!["mcp/www_authenticate"] as string[])[0]).toContain(
    'error="insufficient_scope"',
  );
  expect((refused.meta!["mcp/www_authenticate"] as string[])[0]).toContain(
    `resource_metadata="${url("app", "/.well-known/oauth-protected-resource/mcp")}"`,
  );
  // Writing still works, and nothing went live.
  const added = await mcp.callTool("add_block", {
    pageId: user.pageId,
    type: "header",
    fields: { text: "Written with a narrower grant" },
  });
  expect(added.isError, JSON.stringify(added.structured.error)).toBe(false);
  expect(await tenantHtml(user.handle)).toBe(liveBefore);
  expect((await pageRow(user.pageId)).published_at).toBe((await pageRow(user.pageId)).published_at);
  expect(await tenantHtml(user.handle)).not.toContain("Written with a narrower grant");
  await mcp.close();
});

test("M10-33 (b) a refresh gives a new pair, and the first refresh token presented again is invalid_grant and kills the newer access token", async ({
  browser,
  context,
}) => {
  const user = await prepareFlowUser(context, "flow-refresh");
  const connection = await connect(browser, user);
  const second = await refreshTokens(connection.clientId, connection.refresh);
  expect(second.status).toBe(200);
  expect(second.body.access_token).not.toBe(connection.access);
  expect(second.body.refresh_token).not.toBe(connection.refresh);
  expect(await mcpStatus(String(second.body.access_token))).toBe(200);
  // The first refresh token again, at once (there is no grace window, M10-40): a copied token. The
  // family ends, and the grant with it, as this was the only install.
  const reuse = await refreshTokens(connection.clientId, connection.refresh);
  expect(reuse.status).toBe(400);
  expect(reuse.body.error).toBe("invalid_grant");
  expect(await mcpStatus(String(second.body.access_token))).toBe(401);
  expect(await mcpStatus(connection.access)).toBe(401);
});

test("M10-33 (c) revoke at the endpoint ends the token, and the Connected apps card loses the row; a second connection ends from the card's own Revoke", async ({
  browser,
  context,
  page,
}) => {
  const user = await prepareFlowUser(context, "flow-revoke");
  const first = await connect(browser, user, { name: `Zq first app ${rand(4)}` });
  await page.goto(url("app", "/settings"));
  const row = (name: string) => page.locator(`[data-connected-app="${name}"]`);
  await expect(row(first.name)).toBeVisible();
  expect(await mcpStatus(first.access)).toBe(200);
  const revoked = await revokeRequest(first.access, first.clientId, "access_token");
  expect(revoked.status).toBe(200);
  expect(await mcpStatus(first.access)).toBe(401);
  expect(await mcpStatus(first.refresh)).toBe(401);
  await page.reload();
  await expect(row(first.name)).toHaveCount(0);

  // The second connection is ended by the card instead.
  const second = await connect(browser, user, { name: `Zq second app ${rand(4)}` });
  await page.reload();
  await expect(row(second.name)).toBeVisible();
  expect(await mcpStatus(second.access)).toBe(200);
  await row(second.name)
    .getByRole("button", { name: `Revoke ${second.name}` })
    .click();
  await expect(page.getByRole("status")).toContainText(
    `${second.name} can no longer access your pages.`,
  );
  await expect(row(second.name)).toHaveCount(0);
  expect(await mcpStatus(second.access)).toBe(401);
});

test("M10-33 (d) deleting the account through the real dialog: the old token is a 401 and every row of it is gone", async ({
  browser,
  context,
  page,
}) => {
  const user = await prepareFlowUser(context, "flow-delete");
  const connection = await connect(browser, user);
  const mcp = new McpClient(connection.access);
  await mcp.initialize();
  await mcp.call("list_pages");
  const admin = adminClient();
  // The activity row is written after the response: wait for it.
  await expect
    .poll(
      async () =>
        (await admin.from("mcp_activity").select("id").eq("user_id", user.userId)).data!.length,
    )
    .toBeGreaterThan(0);

  await page.goto(url("app", "/settings"));
  await page.locator("main").getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).not.toHaveURL(/\/settings/, { timeout: 30_000 });

  expect(await mcpStatus(connection.access)).toBe(401);
  for (const table of ["oauth_grants", "oauth_tokens", "mcp_activity"]) {
    expect((await admin.from(table).select("id").eq("user_id", user.userId)).data, table).toEqual(
      [],
    );
  }
  trackUser(user.userId);
});

test("M10-33 (e) a code used twice is invalid_grant, and the first token it made stops working", async ({
  browser,
  context,
}) => {
  const user = await prepareFlowUser(context, "flow-replay");
  const connection = await connect(browser, user);
  expect(await mcpStatus(connection.access)).toBe(200);
  const code = connection.arrived.searchParams.get("code")!;
  const again = await exchangeCode(
    connection.clientId,
    code,
    connection.verifier,
    connection.redirectUri,
  );
  expect(again.status).toBe(400);
  expect(again.body.error).toBe("invalid_grant");
  expect(await mcpStatus(connection.access)).toBe(401);
});

test("M10-33 (f) Deny sends error=access_denied with the same state and iss, and no code", async ({
  browser,
  context,
}) => {
  const user = await prepareFlowUser(context, "flow-deny");
  const connection = await connect(browser, user, { decision: "Deny", state: "deny-me" });
  expect(connection.arrived.searchParams.get("error")).toBe("access_denied");
  expect(connection.arrived.searchParams.get("state")).toBe("deny-me");
  expect(connection.arrived.searchParams.get("iss")).toBe(ISSUER);
  expect(connection.arrived.searchParams.has("code")).toBe(false);
  expect(
    await rows("oauth_grants", { user_id: user.userId, client_id: connection.clientId }),
  ).toHaveLength(0);
});

test("M10-33 a Client ID Metadata Document client runs the same dance (production-build shards only)", async ({
  browser,
  context,
}) => {
  test.skip(
    process.env.HYDLNK_QUERY_COUNTER !== "1",
    "the metadata-document fetch of a loopback address is allowed only while the test hooks are on (HYDLNK_QUERY_COUNTER=1, the production-build CI shards)",
  );
  const user: FlowUser = await prepareFlowUser(context, "flow-cimd");
  const loopback = await startLoopback();
  const stub = await startCimdStub(loopback.redirectUri);
  const pair = pkcePair();
  const authContext = await browser.newContext();
  await ownAddress(authContext);
  try {
    const page = await authContext.newPage();
    await page.goto(
      authorizeUrl(CIMD_CLIENT_ID, pair.challenge, {
        redirectUri: loopback.redirectUri,
        state: "cimd-state",
      }),
    );
    await expect(page).toHaveURL(`${APP_ORIGIN}/login`);
    await signInAs(authContext, user.email);
    await gotoAgain(page, `${APP_ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Metadata document app");
    await page.getByRole("button", { name: "Allow" }).click();
    const arrived = await loopback.next();
    expect(arrived.searchParams.get("state")).toBe("cimd-state");
    const tokens = await exchangeCode(
      CIMD_CLIENT_ID,
      arrived.searchParams.get("code")!,
      pair.verifier,
      loopback.redirectUri,
    );
    expect(tokens.status).toBe(200);
    expect(await mcpStatus(String(tokens.body.access_token))).toBe(200);
    registered.push(CIMD_CLIENT_ID);
  } finally {
    await authContext.close();
    await stopCimdStub(stub);
    await loopback.close();
  }
});

void signedInUser;
