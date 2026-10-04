import { expect, test, type Page } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers, rand, signedInUser, trackUser } from "../fixtures/data";
import {
  APP_ORIGIN,
  CLIENT_REDIRECT,
  ISSUER,
  RESOURCE,
  answer,
  authorizeUrl,
  dcrHeading,
  ownAddress,
  codesCount,
  exchangeCode,
  issuedCodesCount,
  pkcePair,
  refreshTokens,
  registerClient,
  revokeRequest,
  rows,
} from "../fixtures/oauth";

/**
 * M10-11 to M10-17, through the real UI and the real endpoints: a signed-out request is sent to sign
 * in with a cookie and no query, the person comes back to the consent screen, Allow and Deny answer
 * with a real 303, and the code becomes tokens that rotate and can be revoked. The browser never
 * follows the 303 to the app (there is no such site): the spec reads it from the answer itself.
 */

test.beforeEach(async ({ context }) => {
  await ownAddress(context);
});

test.afterAll(cleanupUsers);

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test.describe("M10-12 signing in before consent, and coming back to it", () => {
  test("M10-12 a signed-out request goes to /login with no query and a resume cookie; signing in lands on its consent screen", async ({
    page,
    context,
  }) => {
    const name = `Zq app ${rand(5)}`;
    const client = await registerClient([CLIENT_REDIRECT], name);
    const pair = pkcePair();
    const before = await codesCount(client.client_id);

    await page.goto(authorizeUrl(client.client_id, pair.challenge));
    await expect(page).toHaveURL(`${APP_ORIGIN}/login`);
    expect(page.url()).not.toContain("?");
    expect(await codesCount(client.client_id)).toBe(before + 1);

    // One cookie, host only, HttpOnly, Lax, ten minutes, holding the pending id.
    const cookie = (await context.cookies(APP_ORIGIN)).find((c) => c.name === "hl_oauth_resume");
    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    expect(cookie!.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const lifetime = cookie!.expires - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(540);
    expect(lifetime).toBeLessThanOrEqual(601);
    expect(cookie!.domain).toBe("app.localhost");

    // The sign-in page learns nothing about the request.
    await expect(page.locator("body")).not.toContainText(name);
    expect(await page.content()).not.toContain(client.client_id);

    // Sign in (the emailed-link helper), then take the landing route the callback ends on.
    const email = `e2e-dance-${rand(6)}@example.com`;
    const user = await signInAs(context, email, { handle: `zq-dance-${rand(5)}` });
    trackUser(user.userId);
    await page.goto(`${APP_ORIGIN}/`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/oauth/authorize`);
    await expect(heading(page)).toHaveText(dcrHeading(name));
    await expect(page.locator("body")).toContainText(`Connecting as ${email}.`);
  });

  test("M10-12 a new account claims its handle and the same request resumes: the consent screen, not the editor", async ({
    page,
    context,
  }) => {
    const name = `Zq claim app ${rand(5)}`;
    const client = await registerClient([CLIENT_REDIRECT], name);
    const pair = pkcePair();
    await page.goto(authorizeUrl(client.client_id, pair.challenge));
    await expect(page).toHaveURL(`${APP_ORIGIN}/login`);

    // Signing in with no page yet: the landing route sends the new account to /claim, as it always did.
    const email = `e2e-claim-${rand(6)}@example.com`;
    const user = await signInAs(context, email);
    trackUser(user.userId);
    await page.goto(`${APP_ORIGIN}/`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/claim`);

    const handle = `zq-claim-${rand(5)}`;
    await page.getByLabel("Handle", { exact: true }).fill(handle);
    await expect(page.locator("#cl-handle-status")).toHaveText(`${handle}.hydlnk.com is available`);
    await page.getByRole("button", { name: "Claim it" }).click();

    // The page exists now, and the request that started the sign-in is still inside its ten minutes.
    await expect(page).toHaveURL(`${APP_ORIGIN}/oauth/authorize`, { timeout: 30_000 });
    await expect(heading(page)).toHaveText(dcrHeading(name));
    await expect(page.locator("body")).toContainText(`Connecting as ${email}.`);
  });

  test("M10-12 a forged resume cookie resumes nothing: the usual landing, no consent screen", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "forged" });
    for (const value of ["00000000-0000-4000-8000-00000000f00d", "not-an-id"]) {
      await context.addCookies([
        { name: "hl_oauth_resume", value, url: APP_ORIGIN, httpOnly: true, sameSite: "Lax" },
      ]);
      await page.goto(`${APP_ORIGIN}/`);
      await expect(page).toHaveURL(`${APP_ORIGIN}/editor`);
      await expect(page.locator("body")).not.toContainText("wants to connect");
    }
  });

  test("M10-12 /login reached any other way still ignores a return address", async ({ page }) => {
    await page.goto(
      `${APP_ORIGIN}/login?next=/oauth/authorize&return_to=/settings&redirect_to=/editor`,
    );
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(heading(page)).toHaveText("Log in");
  });

  test("M10-12 already signed in: the consent screen is drawn at the request's own URL, with no second redirect", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "already" });
    const client = await registerClient();
    const pair = pkcePair();
    const url = authorizeUrl(client.client_id, pair.challenge);
    const hops: string[] = [];
    page.on("response", (response) => {
      if (response.url().startsWith(`${APP_ORIGIN}/oauth/`) || response.url().endsWith("/login")) {
        hops.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(url);
    await expect(heading(page)).toContainText("wants to connect to your HYDLNK");
    expect(page.url()).toBe(url);
    expect(hops).toEqual([`200 ${url}`]);
  });
});

test.describe("M10-13 and M10-15 Allow, the code, and the tokens", () => {
  test("M10-13 Allow answers a 303 with code, state and iss, and the code becomes tokens that rotate and can be revoked", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "allow" });
    const client = await registerClient();
    const pair = pkcePair();
    await page.goto(authorizeUrl(client.client_id, pair.challenge, { state: "state-xyz" }));
    const decision = await answer(page, "Allow");

    expect(decision.status).toBe(303);
    const arrived = decision.location;
    expect(`${arrived.origin}${arrived.pathname}`).toBe(CLIENT_REDIRECT);
    expect(arrived.searchParams.get("state")).toBe("state-xyz");
    expect(arrived.searchParams.get("iss")).toBe(ISSUER);
    const code = arrived.searchParams.get("code")!;
    expect(code).toMatch(/^hl_ac_[A-Za-z0-9_-]{43}$/);
    expect(arrived.hash).toBe("");
    expect(decision.headers["cache-control"]).toBe("no-store");
    expect(decision.headers["referrer-policy"]).toBe("no-referrer");

    // The code is stored only as a hash.
    const stored = await rows<{ code_hash: string; status: string }>("oauth_authorization_codes", {
      client_id: client.client_id,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: "issued" });
    expect(stored[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(code);

    const first = await exchangeCode(client.client_id, code, pair.verifier);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.headers.pragma).toBe("no-cache");
    expect(first.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "hydlnk.read hydlnk.write",
    });
    const access = String(first.body.access_token);
    const refresh = String(first.body.refresh_token);
    expect(access).toMatch(/^hl_at_[A-Za-z0-9_-]{43}$/);
    expect(refresh).toMatch(/^hl_rt_[A-Za-z0-9_-]{43}$/);

    // The code is single use, and presenting it again ended the connection.
    const again = await exchangeCode(client.client_id, code, pair.verifier);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
    expect((await refreshTokens(client.client_id, refresh)).body.error).toBe("invalid_grant");
  });

  test("M10-16 a refresh token rotates, narrows, and a reused one ends the whole connection", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "refresh" });
    const client = await registerClient();
    const pair = pkcePair();
    await page.goto(authorizeUrl(client.client_id, pair.challenge));
    const decision = await answer(page, "Allow");
    const first = await exchangeCode(
      client.client_id,
      decision.location.searchParams.get("code")!,
      pair.verifier,
    );
    expect(first.status).toBe(200);

    const second = await refreshTokens(client.client_id, String(first.body.refresh_token), {
      scope: "hydlnk.read",
    });
    expect(second.status).toBe(200);
    expect(second.body.scope).toBe("hydlnk.read");
    expect(second.body.access_token).not.toBe(first.body.access_token);
    expect(second.body.refresh_token).not.toBe(first.body.refresh_token);

    const wider = await refreshTokens(client.client_id, String(second.body.refresh_token), {
      scope: "hydlnk.read hydlnk.nope",
    });
    expect(wider.body.error).toBe("invalid_scope");
    const third = await refreshTokens(client.client_id, String(second.body.refresh_token));
    expect(third.status).toBe(200);
    expect(third.body.scope).toBe("hydlnk.read hydlnk.write");

    // Presenting a rotated token again ends the family: the newest refresh token is dead as well.
    const reuse = await refreshTokens(client.client_id, String(first.body.refresh_token));
    expect(reuse.body.error).toBe("invalid_grant");
    const dead = await refreshTokens(client.client_id, String(third.body.refresh_token));
    expect(dead.body.error).toBe("invalid_grant");
    const grants = await rows<{ revoked_at: string | null }>("oauth_grants", {
      client_id: client.client_id,
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.revoked_at).not.toBeNull();
  });

  test("M10-17 revoking a token ends the whole connection and always answers 200", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "revoke" });
    const client = await registerClient();
    const other = await registerClient();
    const pair = pkcePair();
    await page.goto(authorizeUrl(client.client_id, pair.challenge));
    const decision = await answer(page, "Allow");
    const tokens = await exchangeCode(
      client.client_id,
      decision.location.searchParams.get("code")!,
      pair.verifier,
    );

    // Another app's id, an unknown token and a junk value change nothing and say 200 all the same.
    for (const [token, id] of [
      [String(tokens.body.access_token), other.client_id],
      ["hl_at_" + "A".repeat(43), client.client_id],
      ["x".repeat(300), client.client_id],
    ] as const) {
      const res = await revokeRequest(token, id);
      expect(res.status).toBe(200);
      expect(res.body).toBe("");
      expect(res.headers["cache-control"]).toBe("no-store");
    }
    const rotated = await refreshTokens(client.client_id, String(tokens.body.refresh_token));
    expect(rotated.status).toBe(200);

    // Revoking the access token of the live pair ends the refresh token too.
    const res = await revokeRequest(
      String(rotated.body.access_token),
      client.client_id,
      "access_token",
    );
    expect(res.status).toBe(200);
    expect(
      (await refreshTokens(client.client_id, String(rotated.body.refresh_token))).body.error,
    ).toBe("invalid_grant");
    const grants = await rows<{ id: string; revoked_at: string | null }>("oauth_grants", {
      client_id: client.client_id,
    });
    expect(grants[0]!.revoked_at).not.toBeNull();
    const live = await rows<{ revoked_at: string | null }>("oauth_tokens", {
      grant_id: grants[0]!.id,
    });
    expect(live.every((token) => token.revoked_at !== null)).toBe(true);
  });
});

test.describe("M10-13 what the person decides", () => {
  test("M10-13 Deny answers a 303 with access_denied, state and iss, and issues nothing", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "deny" });
    const client = await registerClient();
    const pair = pkcePair();
    const issuedBefore = await issuedCodesCount(client.client_id);
    await page.goto(authorizeUrl(client.client_id, pair.challenge, { state: "deny-state" }));
    const decision = await answer(page, "Deny");
    expect(decision.status).toBe(303);
    expect(decision.location.searchParams.get("error")).toBe("access_denied");
    expect(decision.location.searchParams.get("state")).toBe("deny-state");
    expect(decision.location.searchParams.get("iss")).toBe(ISSUER);
    expect(decision.location.searchParams.has("code")).toBe(false);
    expect(await issuedCodesCount(client.client_id)).toBe(issuedBefore);
    expect(await rows("oauth_grants", { client_id: client.client_id })).toHaveLength(0);
  });

  // Edit your drafts starts ticked and Publish your pages starts unticked (M10-37, Gary 2026-10-04).
  for (const [label, toggle, expected] of [
    ["defaults, nothing touched", [] as string[], "hydlnk.read hydlnk.write"],
    ["Publish ticked", ["Publish your pages"], "hydlnk.read hydlnk.write hydlnk.publish"],
    ["Write unticked", ["Edit your drafts"], "hydlnk.read"],
    [
      "Write unticked, Publish ticked",
      ["Edit your drafts", "Publish your pages"],
      "hydlnk.read hydlnk.publish",
    ],
  ] as const) {
    test(`M10-13 M10-37 scope choice through the real UI: ${label} gives '${expected}'`, async ({
      page,
      context,
    }) => {
      await signedInUser(context, { label: "scope" });
      const client = await registerClient();
      const pair = pkcePair();
      await page.goto(authorizeUrl(client.client_id, pair.challenge));
      await expect(page.getByRole("checkbox", { name: /Edit your drafts/ })).toBeChecked();
      await expect(page.getByRole("checkbox", { name: /Publish your pages/ })).not.toBeChecked();
      for (const name of toggle) {
        const box = page.getByRole("checkbox", { name: new RegExp(name) });
        if (await box.isChecked()) await box.uncheck();
        else await box.check();
      }
      const decision = await answer(page, "Allow");
      const tokens = await exchangeCode(
        client.client_id,
        decision.location.searchParams.get("code")!,
        pair.verifier,
      );
      expect(tokens.body.scope).toBe(expected);
      const grant = await rows<{ scopes: string[] }>("oauth_grants", {
        client_id: client.client_id,
      });
      expect(grant[0]!.scopes.join(" ")).toBe(expected);
    });
  }

  test("M10-13 a read-only request shows only the always-on line", async ({ page, context }) => {
    await signedInUser(context, { label: "readonly" });
    const client = await registerClient();
    await page.goto(authorizeUrl(client.client_id, pkcePair().challenge, { scope: "hydlnk.read" }));
    const read = page.getByRole("checkbox", { name: /See your sites, pages and analytics/ });
    await expect(read).toBeChecked();
    await expect(read).toBeDisabled();
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText("Edit your drafts");
    await expect(page.locator("body")).toContainText("Always included");
  });

  test("M10-13 connecting again says so, and replaces the earlier grant and its tokens", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "again" });
    const client = await registerClient();
    const first = pkcePair();
    await page.goto(authorizeUrl(client.client_id, first.challenge));
    await page.getByRole("checkbox", { name: /Publish your pages/ }).check();
    const one = await exchangeCode(
      client.client_id,
      (await answer(page, "Allow")).location.searchParams.get("code")!,
      first.verifier,
    );
    expect(one.body.scope).toBe("hydlnk.read hydlnk.write hydlnk.publish");

    const second = pkcePair();
    await page.goto(authorizeUrl(client.client_id, second.challenge));
    await expect(page.locator("body")).toContainText(
      "You’ve connected this app before. Allowing again replaces what it can do now.",
    );
    await expect(page.locator("body")).toContainText(
      "Allowed now: see your pages and analytics, edit your drafts, publish your pages.",
    );
    // Publish is held, so it starts ticked again: a reconnect does not take it away unasked.
    await expect(page.getByRole("checkbox", { name: /Publish your pages/ })).toBeChecked();
    await page.getByRole("checkbox", { name: /Publish your pages/ }).uncheck();
    const two = await exchangeCode(
      client.client_id,
      (await answer(page, "Allow")).location.searchParams.get("code")!,
      second.verifier,
    );
    expect(two.body.scope).toBe("hydlnk.read hydlnk.write");
    // The old refresh token ended with the new consent: a downgrade takes effect at once.
    expect((await refreshTokens(client.client_id, String(one.body.refresh_token))).body.error).toBe(
      "invalid_grant",
    );
    expect(await rows("oauth_grants", { client_id: client.client_id })).toHaveLength(1);
  });

  test("M10-12 a suspended account sees a screen with Deny only, and a forged Allow is access_denied with no code", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "susp" });
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", user.userId);
    const client = await registerClient();
    const pair = pkcePair();
    await page.goto(authorizeUrl(client.client_id, pair.challenge));
    await expect(page.locator("body")).toContainText(
      "Your account is suspended, so you can’t connect apps. Contact support to appeal.",
    );
    await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deny" })).toBeVisible();

    // A forged Allow post (the real form with the Deny button's value changed) is refused server side.
    const issuedBefore = await issuedCodesCount(client.client_id);
    await page.evaluate(() => {
      (document.querySelector('button[value="deny"]') as HTMLButtonElement).value = "allow";
    });
    const decision = await answer(page, "Deny");
    expect(decision.location.searchParams.get("error")).toBe("access_denied");
    expect(decision.location.searchParams.has("code")).toBe(false);
    expect(await issuedCodesCount(client.client_id)).toBe(issuedBefore);
  });
});

test.describe("M10-11 resource and issuer in the dance", () => {
  test("M10-15 a token carries the canonical resource; a request for another resource from a registered app is the 400 page, not a redirect", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "res" });
    const client = await registerClient();
    const pair = pkcePair();
    await page.route(`${new URL(CLIENT_REDIRECT).origin}/**`, (route) => route.abort());
    const wrong = await page.request.get(
      authorizeUrl(client.client_id, pair.challenge, { resource: "https://app.hydlnk.com/mcp" }),
      { maxRedirects: 0 },
    );
    // A registered app's return address is never sent an error before anyone has answered (Wave L
    // review); the known-client redirect with iss is proved in oauth-endpoints.spec.ts.
    expect(wrong.status()).toBe(400);
    expect(wrong.headers()["location"]).toBeUndefined();
    expect(await wrong.text()).toContain("This sign-in request isn’t valid.");

    await page.goto(authorizeUrl(client.client_id, pair.challenge, { resource: null }));
    const decision = await answer(page, "Allow");
    const tokens = await exchangeCode(
      client.client_id,
      decision.location.searchParams.get("code")!,
      pair.verifier,
      CLIENT_REDIRECT,
      { resource: "https://elsewhere.example/mcp" },
    );
    expect(tokens.body.error).toBe("invalid_target");
    const stored = await rows<{ resource: string }>("oauth_authorization_codes", {
      client_id: client.client_id,
    });
    for (const row of stored) expect(row.resource).toBe(RESOURCE);
  });
});
