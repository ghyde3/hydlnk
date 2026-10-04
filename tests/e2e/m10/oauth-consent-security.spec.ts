import { expect, test, type Browser, type BrowserContext, type TestInfo } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, signedInUser } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, type RawResponse } from "../fixtures/http";
import {
  APP_ORIGIN,
  authorizeQuery,
  expireRequest,
  issuedCodesCount,
  ownIp,
  pkcePair,
  registerClient,
  rows,
} from "../fixtures/oauth";

/**
 * M10-14, over HTTP and with two browsers: forged posts, someone else's request, replays, tampering
 * and framing. Each refusal is proved by an unchanged count of issued codes, read with the secret key.
 * The decision is a plain form post, so raw requests with the person's cookies are the same thing the
 * browser sends.
 */

test.afterAll(cleanupUsers);

interface Screen {
  requestId: string;
  csrf: string;
  html: string;
}

async function cookies(context: BrowserContext): Promise<string> {
  return cookieHeader(await authCookies(context));
}

const field = (html: string, name: string): string => {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  if (!match) throw new Error(`the consent form has no ${name} field`);
  return match[1]!;
};

/** Draws the consent screen as a signed-in person, without a browser, and reads its hidden fields. */
async function draw(
  context: BrowserContext,
  clientId: string,
  options: Parameters<typeof authorizeQuery>[2] = {},
): Promise<Screen> {
  const res = await appRaw(
    `/oauth/authorize?${authorizeQuery(clientId, pkcePair().challenge, options)}`,
    {
      cookie: await cookies(context),
      headers: { "x-forwarded-for": ownIp() },
    },
  );
  if (res.status !== 200) throw new Error(`the consent screen was a ${res.status}`);
  return { requestId: field(res.body, "request"), csrf: field(res.body, "csrf"), html: res.body };
}

async function post(
  context: BrowserContext,
  fields: Record<string, string | string[] | undefined>,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(name, v);
  }
  return appRaw("/oauth/consent", {
    method: "POST",
    cookie: await cookies(context),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: APP_ORIGIN,
      "x-forwarded-for": ownIp(),
      ...headers,
    },
    body: params.toString(),
  });
}

const allowFields = (screen: Screen, scopes: string[] = ["hydlnk.write", "hydlnk.publish"]) => ({
  request: screen.requestId,
  csrf: screen.csrf,
  decision: "allow",
  scope: scopes,
});

const EXPIRED = "This request expired. Go back to the app and try again.";

async function twoUsers(browser: Browser, info: TestInfo) {
  const a = await browser.newContext(info.project.use as object);
  const b = await browser.newContext(info.project.use as object);
  const userA = await signedInUser(a, { label: "csa" });
  const userB = await signedInUser(b, { label: "csb" });
  return { a, b, userA, userB };
}

test.describe("M10-14 CSRF", () => {
  test("a post with the right fields and another Origin is a 403 and issues no code", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "cs1" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id);
    const before = await issuedCodesCount(client.client_id);
    for (const origin of [
      "https://evil.example",
      "http://app.localhost:3000.evil.example",
      "http://app.localhost:3001",
    ]) {
      const res = await post(context, allowFields(screen), { origin });
      expect(res.status, origin).toBe(403);
      expect(res.location).toBeNull();
    }
    expect(await issuedCodesCount(client.client_id)).toBe(before);
    // The request is still there to be answered by the real page.
    expect((await post(context, allowFields(screen))).status).toBe(303);
  });

  test("with no Origin the fetch metadata decides: same-origin and the literal null pass, anything else is a 403", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "cs2" });
    const client = await registerClient();
    const before = await issuedCodesCount(client.client_id);
    const screen = await draw(context, client.client_id);
    // appRaw sets origin unless told otherwise: send none, and the literal null, with each site value.
    for (const [origin, site] of [
      [undefined, undefined],
      [undefined, "cross-site"],
      [undefined, "same-site"],
      ["null", "cross-site"],
      ["null", "same-site"],
      ["null", undefined],
    ] as const) {
      const headers: Record<string, string> = { origin: origin ?? "" };
      if (site) headers["sec-fetch-site"] = site;
      const res = await rawPostWithoutOrigin(
        context,
        allowFields(screen),
        headers,
        origin === undefined,
      );
      expect(res.status, `${origin} / ${site}`).toBe(403);
    }
    expect(await issuedCodesCount(client.client_id)).toBe(before);
    const ok = await rawPostWithoutOrigin(
      context,
      allowFields(screen),
      { "sec-fetch-site": "same-origin", origin: "null" },
      false,
    );
    expect(ok.status).toBe(303);
  });

  test("a missing, wrong or other person's form secret is a 403 'This request expired' and issues no code", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const { a, b } = await twoUsers(browser, info);
    const client = await registerClient();
    const screenA = await draw(a, client.client_id);
    const screenB = await draw(b, client.client_id);
    const before = await issuedCodesCount(client.client_id);
    for (const csrf of [undefined, "", "wrong", `${screenA.csrf}x`, screenB.csrf]) {
      const res = await post(a, { ...allowFields(screenA), csrf });
      expect(res.status).toBe(403);
      expect(res.body).toContain(EXPIRED);
    }
    expect(await issuedCodesCount(client.client_id)).toBe(before);
    await a.close();
    await b.close();
  });

  test("an auto-submitting form served from another origin, with the victim's session cookie in the jar, issues no code", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough");
    const victim = await browser.newContext(info.project.use as object);
    await signedInUser(victim, { label: "cs3" });
    const client = await registerClient();
    const screen = await draw(victim, client.client_id);
    const before = await issuedCodesCount(client.client_id);

    // The attacker's page runs in a context that holds the victim's cookies.
    const attacker = await browser.newContext({
      ...(info.project.use as object),
      storageState: await victim.storageState(),
    });
    const page = await attacker.newPage();
    const form = `<form id="f" method="post" action="${APP_ORIGIN}/oauth/consent">
      <input name="request" value="${screen.requestId}"><input name="csrf" value="${screen.csrf}">
      <input name="decision" value="allow"><input name="scope" value="hydlnk.publish"></form>
      <script>document.getElementById("f").submit()</script>`;
    await page.route("https://evil.example/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: form }),
    );
    await page.route("https://a.example/**", (route) => route.abort());
    await page.goto("https://evil.example/");
    await page.waitForTimeout(1500);
    expect(await issuedCodesCount(client.client_id)).toBe(before);
    const stored = await rows<{ status: string }>("oauth_authorization_codes", {
      client_id: client.client_id,
    });
    expect(stored[0]!.status).toBe("pending");
    await attacker.close();
    await victim.close();
  });
});

/** A post whose Origin header is omitted or sent as given, for the cases appRaw would fill in. */
async function rawPostWithoutOrigin(
  context: BrowserContext,
  fields: Record<string, string | string[] | undefined>,
  headers: Record<string, string>,
  omitOrigin: boolean,
): Promise<RawResponse> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(name, v);
  }
  const send: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "x-forwarded-for": ownIp(),
    ...headers,
  };
  if (omitOrigin) delete send.origin;
  return appRaw("/oauth/consent", {
    method: "POST",
    cookie: await cookies(context),
    headers: send,
    body: params.toString(),
  });
}

test.describe("M10-14 binding, replay and expiry", () => {
  test("another signed-in person gets 'started by someone else', and a decision posted as them changes nothing", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const { a, b } = await twoUsers(browser, info);
    const client = await registerClient();
    const screen = await draw(a, client.client_id);
    const before = await issuedCodesCount(client.client_id);

    // B holds A's resume cookie value and opens /oauth/authorize with it.
    const opened = await appRaw("/oauth/authorize", {
      cookie: `${await cookies(b)}; hl_oauth_resume=${screen.requestId}`,
      headers: { "x-forwarded-for": ownIp() },
    });
    expect(opened.status).toBe(403);
    expect(opened.body).toContain(
      "This request was started by someone else. Go back to the app and start again.",
    );
    expect(opened.body).not.toContain("<form");
    expect(opened.body).not.toContain(client.client_name);
    expect(opened.body).not.toContain(screen.csrf);

    const forged = await post(b, allowFields(screen));
    expect(forged.status).toBe(403);
    expect(await issuedCodesCount(client.client_id)).toBe(before);
    const stored = await rows<{ status: string; user_id: string }>("oauth_authorization_codes", {
      client_id: client.client_id,
    });
    expect(stored[0]!.status).toBe("pending");
    expect(stored[0]!.user_id).not.toBeNull();
    await a.close();
    await b.close();
  });

  test("an answered request cannot be answered again, and two simultaneous Allow posts issue exactly one code", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "rp1" });
    const client = await registerClient();
    const before = await issuedCodesCount(client.client_id);
    const screen = await draw(context, client.client_id);
    const results = await Promise.all([
      post(context, allowFields(screen)),
      post(context, allowFields(screen)),
      post(context, allowFields(screen)),
    ]);
    expect(results.filter((r) => r.status === 303)).toHaveLength(1);
    expect(
      results.filter((r) => r.status !== 303).every((r) => r.status === 400 || r.status === 403),
    ).toBe(true);
    expect(await issuedCodesCount(client.client_id)).toBe(before + 1);

    const again = await post(context, allowFields(screen));
    expect(again.status).toBe(400);
    expect(again.body).toContain("This request was already answered.");
    expect(await issuedCodesCount(client.client_id)).toBe(before + 1);
    expect(await rows("oauth_grants", { client_id: client.client_id })).toHaveLength(1);
  });

  test("a request older than ten minutes shows 'expired' and issues nothing", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "ex1" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id);
    const before = await issuedCodesCount(client.client_id);
    await expireRequest(screen.requestId);
    const res = await post(context, allowFields(screen));
    expect(res.status).toBe(400);
    expect(res.body).toContain(EXPIRED);
    expect(await issuedCodesCount(client.client_id)).toBe(before);
    // Opening it again shows the same page, with no form.
    const opened = await appRaw("/oauth/authorize", {
      cookie: `${await cookies(context)}; hl_oauth_resume=${screen.requestId}`,
      headers: { "x-forwarded-for": ownIp() },
    });
    expect(opened.status).toBe(400);
    expect(opened.body).toContain(EXPIRED);
    expect(opened.body).not.toContain("<form");
  });
});

test.describe("M10-14 tampering", () => {
  test("fields a forged form adds are ignored: the answer goes to the stored address with the stored state", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "tp1" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id, {
      state: "stored-state",
      scope: "hydlnk.read",
    });
    const res = await post(context, {
      request: screen.requestId,
      csrf: screen.csrf,
      decision: "allow",
      redirect_uri: "https://evil.example/cb",
      client_id: `hlc_${"9".repeat(32)}`,
      state: "forged-state",
      code_challenge: pkcePair().challenge,
      resource: "https://evil.example/mcp",
      scope: ["hydlnk.publish", "hydlnk.write", "everything"],
    });
    expect(res.status).toBe(303);
    const back = new URL(res.location!);
    expect(`${back.origin}${back.pathname}`).toBe("https://a.example/cb");
    expect(back.searchParams.get("state")).toBe("stored-state");
    // A scope the app never asked for is dropped; read is always included.
    const grants = await rows<{ scopes: string[] }>("oauth_grants", {
      client_id: client.client_id,
    });
    expect(grants[0]!.scopes).toEqual(["hydlnk.read"]);
  });

  test("the decision redirects only to the stored matched address, a login or a settings page: never to a posted one", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "tp2" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id);
    for (const decision of ["deny", "allow"]) {
      const fresh = decision === "allow" ? await draw(context, client.client_id) : screen;
      const res = await post(context, {
        request: fresh.requestId,
        csrf: fresh.csrf,
        decision,
        redirect_uri: "https://evil.example/cb",
        next: "https://evil.example",
      });
      expect(res.status).toBe(303);
      expect(new URL(res.location!).origin).toBe("https://a.example");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
    }
  });

  test("a client that no longer lists the stored address is refused: 'This app changed its settings'", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "tp3" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id);
    await adminClient()
      .from("oauth_clients")
      .update({ redirect_uris: ["https://changed.example/cb"] })
      .eq("client_id", client.client_id);
    const before = await issuedCodesCount(client.client_id);
    const res = await post(context, allowFields(screen));
    expect(res.status).toBe(403);
    expect(res.body).toContain("This app changed its settings. Go back to the app and try again.");
    expect(await issuedCodesCount(client.client_id)).toBe(before);
  });

  test("malformed posts are refused: no secret, a repeated decision, an unknown decision, JSON", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "tp4" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id);
    const before = await issuedCodesCount(client.client_id);
    for (const fields of [
      { request: screen.requestId, decision: "allow" },
      { request: screen.requestId, csrf: screen.csrf, decision: ["allow", "allow"] },
      { request: screen.requestId, csrf: screen.csrf, decision: "maybe" },
      { request: "not-an-id", csrf: screen.csrf, decision: "allow" },
      {},
    ]) {
      expect((await post(context, fields)).status).toBe(403);
    }
    const json = await appRaw("/oauth/consent", {
      method: "POST",
      cookie: await cookies(context),
      headers: {
        "content-type": "application/json",
        origin: APP_ORIGIN,
        "x-forwarded-for": ownIp(),
      },
      body: JSON.stringify({ request: screen.requestId, csrf: screen.csrf, decision: "allow" }),
    });
    expect(json.status).toBe(403);
    expect(await issuedCodesCount(client.client_id)).toBe(before);
    // /oauth/consent answers POST only, and /oauth/authorize GET only.
    expect((await appRaw("/oauth/consent", { cookie: await cookies(context) })).status).toBe(405);
    const post405 = await appRaw("/oauth/authorize", {
      method: "POST",
      cookie: await cookies(context),
      body: "",
    });
    expect(post405.status).toBe(405);
    expect(post405.headers.allow).toBe("GET");
  });

  test("a signed-out post is sent to sign in and changes nothing", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const user = await signedInUser(context, { label: "tp5" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id);
    void user;
    const before = await issuedCodesCount(client.client_id);
    const res = await appRaw("/oauth/consent", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: APP_ORIGIN,
        "x-forwarded-for": ownIp(),
      },
      body: new URLSearchParams(
        allowFields(screen) as unknown as Record<string, string>,
      ).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.location).toBe(`${APP_ORIGIN}/login`);
    expect(await issuedCodesCount(client.client_id)).toBe(before);
  });
});

test.describe("M10-13 the decision limit", () => {
  test("30 decisions an hour per person, then 'Too many tries'", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    await signedInUser(context, { label: "lim1" });
    const client = await registerClient();
    const screen = await draw(context, client.client_id);
    let last: RawResponse | undefined;
    for (let i = 0; i < 30; i += 1) {
      last = await post(context, { ...allowFields(screen), csrf: "wrong" });
      expect(last.status).toBe(403);
    }
    last = await post(context, allowFields(screen));
    expect(last.status).toBe(429);
    expect(last.body).toContain("Too many tries. Try again in a while.");
  });
});

void [adminClient];
