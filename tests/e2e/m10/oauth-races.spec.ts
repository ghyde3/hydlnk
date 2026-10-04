import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, signedInUser } from "../fixtures/data";
import {
  exchangeCode,
  mcpAnswers,
  mcpStatus,
  mintGrant,
  pkcePair,
  refreshTokens,
  registerClient,
  removeClients,
  rows,
} from "../fixtures/oauth";
import { appRaw, authCookies, cookieHeader } from "../fixtures/http";
import { authorizeQuery, ownIp, CLIENT_REDIRECT, APP_ORIGIN } from "../fixtures/oauth";

/**
 * M10-15 and M10-16 on the real database: two requests at the same moment. The first to arrive wins
 * and the other is refused; because both are the same code or the same refresh token, the second one
 * is a copy, so the winner's connection ends too.
 */

const made: string[] = [];
test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

test("M10-15 two simultaneous exchanges of one code give one 200 and one invalid_grant", async ({
  context,
}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  await signedInUser(context, { label: "rc1" });
  const client = await registerClient();
  made.push(client.client_id);
  const cookie = cookieHeader(await authCookies(context));
  const pair = pkcePair();
  const screen = await appRaw(
    `/oauth/authorize?${authorizeQuery(client.client_id, pair.challenge)}`,
    { cookie, headers: { "x-forwarded-for": ownIp() } },
  );
  const field = (name: string) =>
    new RegExp(`name="${name}" value="([^"]*)"`).exec(screen.body)![1]!;
  const answered = await appRaw("/oauth/consent", {
    method: "POST",
    cookie,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: APP_ORIGIN,
      "x-forwarded-for": ownIp(),
    },
    body: new URLSearchParams({
      request: field("request"),
      csrf: field("csrf"),
      decision: "allow",
    }).toString(),
  });
  const code = new URL(answered.location!).searchParams.get("code")!;

  const results = await Promise.all(
    [1, 2, 3].map(() => exchangeCode(client.client_id, code, pair.verifier, CLIENT_REDIRECT)),
  );
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  for (const loser of results.filter((r) => r.status !== 200)) {
    expect(loser.status).toBe(400);
    expect(loser.body.error).toBe("invalid_grant");
  }
  // The later ones were copies, so the connection the winner got has ended.
  const grants = await rows<{ revoked_at: string | null }>("oauth_grants", {
    client_id: client.client_id,
  });
  expect(grants[0]!.revoked_at).not.toBeNull();
});

test("M10-16 two simultaneous refreshes with one token give one success and one invalid_grant, and the success is ended too", async ({
  context,
}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  await signedInUser(context, { label: "rc2" });
  const client = await registerClient();
  made.push(client.client_id);
  const minted = await mintGrant(context, client.client_id);

  const results = await Promise.all([
    refreshTokens(client.client_id, minted.refreshToken),
    refreshTokens(client.client_id, minted.refreshToken),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  expect(results.find((r) => r.status === 400)!.body.error).toBe("invalid_grant");
  const winner = results.find((r) => r.status === 200)!;
  // Because that was a reuse, the success is dead: its refresh token and its access token.
  expect(
    (await refreshTokens(client.client_id, String(winner.body.refresh_token))).body.error,
  ).toBe("invalid_grant");
  if (await mcpAnswers()) expect(await mcpStatus(String(winner.body.access_token))).toBe(401);
});
