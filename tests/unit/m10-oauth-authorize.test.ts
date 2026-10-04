import { describe, expect, it } from "vitest";
import { AUTHORIZE_MAX_QUERY_BYTES, STATE_MAX_LENGTH } from "@/lib/oauth/authorize";
import { buildClientRedirect, errorParams, successParams } from "@/lib/oauth/redirect";
import {
  DCR_ID,
  ISSUER,
  OTHER,
  REDIRECT,
  RESOURCE,
  USER,
  authorizeQuery,
  harness,
  pkce,
} from "./helpers/oauth-flow";
import { memoryLimiter } from "./helpers/oauth-fake-store";

/**
 * M10-11: the authorize endpoint's validation order, errors that never redirect, PKCE, resource and
 * the issuer parameter. Pure core, in-memory store.
 */

type Redirect = { kind: "redirect"; location: string };

function parsedRedirect(result: { kind: string }): URL {
  expect(result.kind).toBe("redirect");
  return new URL((result as Redirect).location);
}

describe("M10-11 a valid request", () => {
  it("creates exactly one pending row holding the validated values", async () => {
    const h = harness();
    const { challenge } = pkce();
    const result = await h.authorize(authorizeQuery({}, challenge), { user: null });
    expect(result.kind).toBe("login");
    expect(h.store.requests.size).toBe(1);
    const row = [...h.store.requests.values()][0]!;
    expect(row).toMatchObject({
      client_id: DCR_ID,
      redirect_uri: REDIRECT,
      status: "pending",
      state: "state-1",
      code_challenge: challenge,
      resource: RESOURCE,
      scopes_requested: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
      user_id: null,
    });
    expect(Date.parse(row.request_expires_at) - h.store.clock).toBe(600_000);
  });

  it("a signed-out request is sent to sign in with the pending id; a signed-in one gets the consent screen", async () => {
    const h = harness();
    const out = await h.authorize(authorizeQuery(), { user: null });
    expect(out).toMatchObject({
      kind: "login",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    const signedIn = await h.authorize(authorizeQuery(), { user: USER });
    expect(signedIn.kind).toBe("consent");
    if (signedIn.kind === "consent") {
      expect(signedIn.view.email).toBe(USER.email);
      expect(signedIn.view.clientName).toBe("Test app");
      expect(signedIn.view.clientKind).toBe("dcr");
      expect(signedIn.view.scopes).toEqual(["hydlnk.read", "hydlnk.write", "hydlnk.publish"]);
    }
  });

  it("binds the request to the first signed-in person who renders it and stores a hash of the form secret", async () => {
    const h = harness();
    const result = await h.authorize(authorizeQuery(), { user: USER });
    if (result.kind !== "consent") throw new Error("expected consent");
    const row = h.store.requests.get(result.view.requestId)!;
    expect(row.user_id).toBe(USER.id);
    expect(row.csrf_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(result.view.csrf);
  });

  it("an unnamed state is stored as null, and the claude request shape is a valid request", async () => {
    const h = harness();
    const result = await h.authorize(authorizeQuery({ state: null, resource: null, scope: null }), {
      user: null,
    });
    expect(result.kind).toBe("login");
    const row = [...h.store.requests.values()][0]!;
    expect(row.state).toBeNull();
    expect(row.resource).toBe(RESOURCE);
    expect(row.scopes_requested).toEqual(["hydlnk.read", "hydlnk.write", "hydlnk.publish"]);
  });
});

describe("M10-11 errors that never redirect", () => {
  it.each([
    ["no client_id", { client_id: null }, "unknown_app"],
    ["an empty client_id", { client_id: "" }, "unknown_app"],
    ["an unknown registered id", { client_id: `hlc_${"b".repeat(32)}` }, "unknown_app"],
    ["a malformed id", { client_id: "not a client" }, "unknown_app"],
    ["a script as the id", { client_id: "<script>alert(1)</script>" }, "unknown_app"],
    ["an http address as the id", { client_id: "http://example.com/x" }, "unknown_app"],
    ["no redirect_uri", { redirect_uri: null }, "bad_redirect"],
    ["an empty redirect_uri", { redirect_uri: "" }, "bad_redirect"],
    ["a javascript: redirect", { redirect_uri: "javascript:alert(1)" }, "bad_redirect"],
    [
      "a redirect the client did not register",
      { redirect_uri: "https://evil.example/cb" },
      "bad_redirect",
    ],
    [
      "a registered redirect with a trailing slash",
      { redirect_uri: `${REDIRECT}/` },
      "bad_redirect",
    ],
    [
      "a registered redirect with an added query",
      { redirect_uri: `${REDIRECT}?x=1` },
      "bad_redirect",
    ],
  ] as const)("%s is the error page", async (_name, over, errorClass) => {
    const h = harness();
    const result = await h.authorize(authorizeQuery(over));
    expect(result).toEqual({ kind: "error_page", status: 400, errorClass });
    expect(h.store.requests.size).toBe(0);
  });

  it("a repeated client_id or redirect_uri is the error page", async () => {
    const h = harness();
    const base = authorizeQuery();
    expect(await h.authorize(`${base}&client_id=${DCR_ID}`)).toMatchObject({
      kind: "error_page",
      errorClass: "unknown_app",
    });
    expect(await h.authorize(`${base}&redirect_uri=${encodeURIComponent(REDIRECT)}`)).toMatchObject(
      {
        kind: "error_page",
        errorClass: "bad_redirect",
      },
    );
    expect(h.store.requests.size).toBe(0);
  });

  it("an error page is chosen by class and holds nothing of the request", async () => {
    const h = harness();
    const result = await h.authorize(
      authorizeQuery({
        client_id: "<script>alert(1)</script>",
        redirect_uri: "javascript:alert(1)",
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/script|javascript|alert/i);
  });

  it("a query over 8 KB, and a single value over 2,048 characters, are the error page", async () => {
    const h = harness();
    expect(
      await h.authorize(`${authorizeQuery()}&junk=${"x".repeat(AUTHORIZE_MAX_QUERY_BYTES)}`),
    ).toMatchObject({
      kind: "error_page",
    });
    expect(await h.authorize(authorizeQuery({ state: "s".repeat(2049) }))).toMatchObject({
      kind: "error_page",
    });
    expect(h.store.requests.size).toBe(0);
  });

  it("the limit comes first: over 60 a minute from one address is a 429 page with a retry time", async () => {
    const h = harness();
    const limited = harness({ limit: memoryLimiter(() => h.store.clock) });
    for (let i = 0; i < 60; i += 1) {
      expect((await limited.authorize(authorizeQuery(), { user: null })).kind).toBe("login");
    }
    const result = await limited.authorize(authorizeQuery(), { user: null });
    expect(result).toMatchObject({ kind: "error_page", status: 429, errorClass: "too_many" });
    expect((result as { retryAfter: number }).retryAfter).toBeGreaterThanOrEqual(1);
    // Another address is not affected.
    expect(
      (await limited.authorize(authorizeQuery(), { user: null, clientKey: "198.51.100.9" })).kind,
    ).toBe("login");
    // The limit key is the first thing asked.
    expect(h.limiter.calls).toHaveLength(0);
  });

  it("asks for the limit before it looks at the client", async () => {
    const h = harness();
    await h.authorize(authorizeQuery({ client_id: null }));
    expect(h.limiter.calls[0]).toEqual({
      key: "oauth-authorize:203.0.113.7",
      limit: 60,
      window: 60,
    });
    expect(h.store.calls.getClient ?? 0).toBe(0);
  });

  it("a client that cannot be verified is the error page, and no request row is made", async () => {
    const h = harness();
    const result = await h.authorize(
      authorizeQuery({ client_id: "https://app.example.com/oauth/client.json" }),
    );
    expect(result).toEqual({ kind: "error_page", status: 400, errorClass: "cannot_verify" });
    expect(h.store.requests.size).toBe(0);
  });
});

describe("M10-11 errors that go back to the app", () => {
  const cases: Array<[string, Record<string, string | null>, string, string?]> = [
    ["a missing response_type", { response_type: null }, "invalid_request"],
    ["response_type=token", { response_type: "token" }, "unsupported_response_type"],
    ["response_mode=fragment", { response_mode: "fragment" }, "invalid_request"],
    ["an unknown scope", { scope: "hydlnk.read hydlnk.admin" }, "invalid_scope"],
    [
      "a missing code_challenge",
      { code_challenge: null },
      "invalid_request",
      "PKCE with S256 is required.",
    ],
    [
      "a missing code_challenge_method",
      { code_challenge_method: null },
      "invalid_request",
      "PKCE with S256 is required.",
    ],
    [
      "code_challenge_method=plain",
      { code_challenge_method: "plain" },
      "invalid_request",
      "PKCE with S256 is required.",
    ],
    ["a challenge of the wrong length", { code_challenge: "short" }, "invalid_request"],
    ["a resource of another server", { resource: "https://app.hydlnk.com/mcp" }, "invalid_target"],
    ["a resource with a trailing slash", { resource: `${RESOURCE}/` }, "invalid_target"],
    ["a resource with a query", { resource: `${RESOURCE}?x=1` }, "invalid_target"],
    ["prompt=none", { prompt: "none" }, "consent_required"],
    ["prompt=none login", { prompt: "none login" }, "consent_required"],
    ["a request object", { request: "eyJhbGciOiJub25lIn0.e30." }, "request_not_supported"],
    ["a request_uri", { request_uri: "https://x.example/r" }, "request_uri_not_supported"],
  ];

  it.each(cases)("%s", async (_name, over, error, description) => {
    const h = harness();
    const result = await h.authorize(authorizeQuery(over));
    const url = parsedRedirect(result);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe(error);
    expect(url.searchParams.get("error_description")).toBeTruthy();
    if (description) expect(url.searchParams.get("error_description")).toBe(description);
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    expect(h.store.requests.size).toBe(0);
  });

  it("two resource values are invalid_target, and a parameter given twice is invalid_request", async () => {
    const h = harness();
    const twoResources = `${authorizeQuery()}&resource=${encodeURIComponent(RESOURCE)}`;
    expect(parsedRedirect(await h.authorize(twoResources)).searchParams.get("error")).toBe(
      "invalid_target",
    );
    const twoScopes = `${authorizeQuery()}&scope=hydlnk.read`;
    expect(parsedRedirect(await h.authorize(twoScopes)).searchParams.get("error")).toBe(
      "invalid_request",
    );
    const twoChallenges = `${authorizeQuery()}&code_challenge=${pkce().challenge}`;
    expect(parsedRedirect(await h.authorize(twoChallenges)).searchParams.get("error")).toBe(
      "invalid_request",
    );
  });

  it("a state over 512 characters is invalid_request, sent without the state", async () => {
    const h = harness();
    const url = parsedRedirect(
      await h.authorize(authorizeQuery({ state: "s".repeat(STATE_MAX_LENGTH + 1) })),
    );
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    const ok = await h.authorize(authorizeQuery({ state: "s".repeat(STATE_MAX_LENGTH) }), {
      user: null,
    });
    expect(ok.kind).toBe("login");
  });

  it("a request error carries no state when none was sent", async () => {
    const h = harness();
    const url = parsedRedirect(
      await h.authorize(authorizeQuery({ state: null, response_type: "token" })),
    );
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("request and request_uri are refused even when everything else is valid", async () => {
    const h = harness();
    const url = parsedRedirect(await h.authorize(`${authorizeQuery()}&request=abc`));
    expect(url.searchParams.get("error")).toBe("request_not_supported");
  });
});

describe("M10-11 what is accepted", () => {
  it("offline_access is accepted and dropped, never stored", async () => {
    const h = harness();
    const result = await h.authorize(
      authorizeQuery({ scope: "hydlnk.read offline_access hydlnk.write" }),
      { user: null },
    );
    expect(result.kind).toBe("login");
    expect([...h.store.requests.values()][0]!.scopes_requested).toEqual([
      "hydlnk.read",
      "hydlnk.write",
    ]);
  });

  it("a missing, empty or offline_access-only scope asks for all three; read alone stays read alone", async () => {
    for (const scope of [null, "", "offline_access"]) {
      const h = harness();
      await h.authorize(authorizeQuery({ scope }), { user: null });
      expect([...h.store.requests.values()][0]!.scopes_requested).toEqual([
        "hydlnk.read",
        "hydlnk.write",
        "hydlnk.publish",
      ]);
    }
    const h = harness();
    await h.authorize(authorizeQuery({ scope: "hydlnk.read" }), { user: null });
    expect([...h.store.requests.values()][0]!.scopes_requested).toEqual(["hydlnk.read"]);
  });

  it("an absent resource means the canonical URL, and the case of scheme and host does not matter", async () => {
    const h = harness();
    expect((await h.authorize(authorizeQuery({ resource: null }), { user: null })).kind).toBe(
      "login",
    );
    expect(
      (
        await h.authorize(authorizeQuery({ resource: "HTTP://APP.LOCALHOST:3000/mcp" }), {
          user: null,
        })
      ).kind,
    ).toBe("login");
    for (const row of h.store.requests.values()) expect(row.resource).toBe(RESOURCE);
  });

  it("prompt=login, consent and select_account are ignored, and so are unknown parameters", async () => {
    const h = harness();
    for (const prompt of ["login", "consent", "select_account"]) {
      expect(
        (
          await h.authorize(
            authorizeQuery({ prompt, nonce: "n", login_hint: "x", display: "popup" }),
            { user: null },
          )
        ).kind,
      ).toBe("login");
    }
  });

  it("a loopback redirect that matched by the port rule is stored as the exact string requested", async () => {
    const h = harness({ clientUris: ["http://localhost/callback", "http://127.0.0.1/callback"] });
    const result = await h.authorize(
      authorizeQuery({ redirect_uri: "http://localhost:51234/callback" }),
      { user: null },
    );
    expect(result.kind).toBe("login");
    expect([...h.store.requests.values()][0]!.redirect_uri).toBe("http://localhost:51234/callback");
    const other = await h.authorize(
      authorizeQuery({ redirect_uri: "http://[::1]:51234/callback" }),
      { user: null },
    );
    expect(other).toMatchObject({ kind: "error_page", errorClass: "bad_redirect" });
  });
});

describe("M10-11 / M10-14 the redirect builder", () => {
  it("builds the Location with the URL API so the redirect URI's own query is kept", () => {
    const location = buildClientRedirect(
      "https://a.example/cb?keep=1&also=two",
      errorParams("access_denied", "st", ISSUER),
    );
    const url = new URL(location);
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.get("also")).toBe("two");
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    expect(url.hash).toBe("");
  });

  it.each([
    "%0d%0aSet-Cookie: x=1",
    "a b",
    "a&b=c",
    "a#frag",
    "a=b",
    "café ☃",
    "%250d%250a",
    "https://evil.example/",
  ])(
    "a state of %j is percent-encoded exactly once and cannot add a parameter, a header or a fragment",
    (state) => {
      const decoded = decodeURIComponent(state.includes("%0d") ? state : encodeURIComponent(state));
      const location = buildClientRedirect(
        "https://a.example/cb",
        successParams("CODE", decoded, ISSUER),
      );
      const url = new URL(location);
      expect(url.hash).toBe("");
      expect(url.username).toBe("");
      expect(url.host).toBe("a.example");
      expect([...url.searchParams.keys()]).toEqual(["code", "state", "iss"]);
      expect(url.searchParams.get("state")).toBe(decoded);
      expect(location).not.toMatch(/[\r\n]/);
    },
  );

  it("awkward stored URIs cannot add a fragment, user information or a second host", () => {
    for (const uri of [
      "https://a.example/cb?x=1",
      "http://[::1]:8080/cb",
      "https://xn--bcher-kva.example/cb",
      "http://localhost:51234/callback?a=b",
    ]) {
      const url = new URL(buildClientRedirect(uri, successParams("CODE", "s", ISSUER)));
      expect(url.hash).toBe("");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(url.searchParams.get("code")).toBe("CODE");
    }
  });
});

describe("M10-12 resume mode", () => {
  it("a signed-in person with the cookie of their own pending request sees the consent screen of it", async () => {
    const h = harness();
    const out = await h.authorize(authorizeQuery(), { user: null });
    if (out.kind !== "login") throw new Error("expected login");
    const resumed = await h.authorize("", { user: USER, resumeId: out.requestId });
    expect(resumed.kind).toBe("consent");
    if (resumed.kind === "consent") expect(resumed.view.requestId).toBe(out.requestId);
  });

  it("a signed-out visitor with no query learns nothing", async () => {
    const h = harness();
    expect(await h.authorize("", { user: null, resumeId: "x" })).toMatchObject({
      kind: "error_page",
      errorClass: "invalid",
    });
  });

  it("a forged or random cookie value names nothing", async () => {
    const h = harness();
    expect(
      await h.authorize("", { user: USER, resumeId: "00000000-0000-4000-8000-00000000dead" }),
    ).toEqual({
      kind: "invalid_resume",
    });
    expect(await h.authorize("", { user: USER, resumeId: null })).toMatchObject({
      kind: "error_page",
    });
  });

  it("someone else's pending request is the 'started by someone else' page, and not their consent screen", async () => {
    const h = harness();
    const first = await h.authorize(authorizeQuery(), { user: USER });
    if (first.kind !== "consent") throw new Error("expected consent");
    const second = await h.authorize("", { user: OTHER, resumeId: first.view.requestId });
    expect(second).toEqual({ kind: "message", status: 403, message: "someone_else" });
  });

  it("an expired or answered request is a page that says so", async () => {
    const h = harness();
    const first = await h.authorize(authorizeQuery(), { user: USER });
    if (first.kind !== "consent") throw new Error("expected consent");
    h.store.advance(601);
    expect(await h.authorize("", { user: USER, resumeId: first.view.requestId })).toEqual({
      kind: "message",
      status: 400,
      message: "expired",
    });
    h.store.advance(-601);
    h.store.requests.get(first.view.requestId)!.status = "denied";
    expect(await h.authorize("", { user: USER, resumeId: first.view.requestId })).toEqual({
      kind: "message",
      status: 400,
      message: "answered",
    });
  });
});
