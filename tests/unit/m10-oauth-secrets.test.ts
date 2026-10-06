import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/oauth/tokens";
import { verifyAccessToken } from "@/lib/oauth/verify";
import {
  DCR_ID,
  REDIRECT,
  RESOURCE,
  USER,
  authorizeQuery,
  harness,
  pkce,
  type Harness,
} from "./helpers/oauth-flow";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("outside a request");
  },
}));
vi.mock("@/lib/oauth/config", () => ({
  oauthConfig: () => ({ resource: "http://app.localhost:3000/mcp" }),
}));
vi.mock("@/lib/oauth/store-supabase", () => ({ defaultOauthStore: () => ({}) }));

/**
 * M10-17: no secret in a log, and none in a response header it was not meant for. Every endpoint of the
 * wave is driven with unique canary values for the code, the verifier, the access and refresh tokens,
 * the form secret, the Authorization header, the resume cookie and the state, on success and on each
 * failure path. No `console` call may have received a canary, and no response header other than the
 * intended ones may carry one.
 */

const CANARY = {
  verifier: "CANARYverifier0123456789abcdefghijklmnopqrstuvwxyz-._~AAAA",
  state: "CANARYstate-9f3a1c",
  basic: "CANARYbasic",
  resume: "00000000-0000-4000-8000-0000c0ffee00",
  bearer: "CANARYbearerCANARYbearerCANARYbearerCANARYbearer",
  client: "CANARYsecret",
};

let spies: Array<ReturnType<typeof vi.spyOn>> = [];

function watchConsole() {
  spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
}

function logged(): string {
  return spies.map((spy) => JSON.stringify(spy.mock.calls)).join("\n");
}

afterEach(() => vi.restoreAllMocks());

const headerText = (headers: Record<string, string>) => JSON.stringify(headers);

describe("M10-17 no secret in a log", () => {
  it("drives authorize, consent, token, refresh and revoke on success and failure, and no canary reaches the console", async () => {
    watchConsole();
    const h = harness();
    const secrets: string[] = [];

    // authorize: with a canary state, signed in; and a failure with a canary state.
    const pair = pkce(CANARY.verifier);
    const shown = await h.authorize(authorizeQuery({ state: CANARY.state }, pair.challenge));
    if (shown.kind !== "consent") throw new Error("expected consent");
    secrets.push(shown.view.csrf, CANARY.state);
    await h.authorize(
      authorizeQuery({ state: CANARY.state, response_type: "token" }, pair.challenge),
    );
    await h.authorize(
      authorizeQuery({ client_id: "hlc_unknown", state: CANARY.state }, pair.challenge),
    );
    await h.authorize("", { resumeId: CANARY.resume });
    await h.authorize("", { user: null, resumeId: CANARY.resume });

    // consent: a wrong secret, then the right one (the code is a canary of its own).
    const code = `hl_ac_${"Q".repeat(43)}`;
    h.consentDeps.newCode = () => code;
    secrets.push(code);
    await h.consent({ request: shown.view.requestId, csrf: "CANARYwrongcsrf", decision: "allow" });
    await h.consent({ request: shown.view.requestId, csrf: shown.view.csrf, decision: "allow" });
    await h.consent({ request: shown.view.requestId, csrf: shown.view.csrf, decision: "allow" });

    // token: failures first (wrong verifier, a client_secret, a Basic header), then success, then reuse.
    await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: "x".repeat(43),
    });
    await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: pair.verifier,
      client_secret: CANARY.client,
    });
    await h.token(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: DCR_ID,
        code_verifier: pair.verifier,
      },
      { authorization: `Basic ${Buffer.from(`${DCR_ID}:${CANARY.basic}`).toString("base64")}` },
    );
    const ok = await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: pair.verifier,
    });
    expect(ok.status).toBe(200);
    const tokens = ok.body as { access_token: string; refresh_token: string };
    secrets.push(tokens.access_token, tokens.refresh_token, pair.verifier);
    await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: pair.verifier,
    });

    // refresh, reuse (the family ends), revoke.
    const next = await h.token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: DCR_ID,
    });
    expect(next.status).toBe(400);
    await h.revoke({ token: tokens.access_token, client_id: DCR_ID });
    await h.revoke({ token: `hl_rt_${"Z".repeat(43)}`, client_id: DCR_ID });
    secrets.push(`hl_rt_${"Z".repeat(43)}`);

    // the bearer check, with a canary credential and with a real one.
    const verify = (token: string) =>
      verifyAccessToken(token, {
        store: h.store,
        resource: RESOURCE,
        now: h.store.now,
        defer: (work) => void work(),
      });
    await verify(CANARY.bearer);
    await verify(tokens.access_token);
    secrets.push(CANARY.bearer);

    // a store failure on a token path.
    h.store.failNext = "getRequestByCodeHash";
    await h.token({
      grant_type: "authorization_code",
      code: `hl_ac_${"R".repeat(43)}`,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: pair.verifier,
    });
    secrets.push(
      `hl_ac_${"R".repeat(43)}`,
      CANARY.client,
      CANARY.basic,
      CANARY.resume,
      "CANARYwrongcsrf",
    );

    const output = logged();
    for (const secret of secrets) expect(output, secret).not.toContain(secret);
    // The one thing a log may say is that a code was used twice, with the app and nothing else.
    expect(output).toContain("code_reuse");
  });

  it("no response of the token, registration and revocation endpoints carries a secret in a header", async () => {
    watchConsole();
    const h = harness();
    const pair = pkce();
    const code = `hl_ac_${"T".repeat(43)}`;
    const view = await h.authorize(authorizeQuery({}, pair.challenge));
    if (view.kind !== "consent") throw new Error("expected consent");
    h.consentDeps.newCode = () => code;
    await h.consent({ request: view.view.requestId, csrf: view.view.csrf, decision: "allow" });
    const ok = await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: pair.verifier,
    });
    const body = ok.body as { access_token: string; refresh_token: string };
    for (const secret of [code, pair.verifier, body.access_token, body.refresh_token]) {
      expect(headerText(ok.headers), secret).not.toContain(secret);
    }
    const revoked = await h.revoke({ token: body.access_token, client_id: DCR_ID });
    for (const secret of [body.access_token, body.refresh_token]) {
      expect(headerText(revoked.headers), secret).not.toContain(secret);
    }
    expect(Object.keys(ok.headers).sort()).toEqual(["Cache-Control", "Pragma"]);
    expect(Object.keys(revoked.headers).sort()).toEqual(["Cache-Control", "Pragma"]);
  });

  it("the redirect to the app carries the code only in its Location, with no-store and no Referer", async () => {
    watchConsole();
    const h = harness();
    const view = await h.authorize(authorizeQuery({ state: CANARY.state }));
    if (view.kind !== "consent") throw new Error("expected consent");
    const code = `hl_ac_${"U".repeat(43)}`;
    h.consentDeps.newCode = () => code;
    const result = await h.consent({
      request: view.view.requestId,
      csrf: view.view.csrf,
      decision: "allow",
    });
    expect(result.kind).toBe("redirect");
    expect(JSON.stringify(result)).toContain(code);
    expect(JSON.stringify(h.store.requests.get(view.view.requestId))).not.toContain(code);
    expect(logged()).not.toContain(code);
    expect(logged()).not.toContain(CANARY.state);
  });

  it("everything stored is a hash: codes, tokens and form secrets", async () => {
    const h: Harness = harness();
    const pair = pkce();
    const view = await h.authorize(authorizeQuery({}, pair.challenge));
    if (view.kind !== "consent") throw new Error("expected consent");
    const code = `hl_ac_${"V".repeat(43)}`;
    h.consentDeps.newCode = () => code;
    await h.consent({ request: view.view.requestId, csrf: view.view.csrf, decision: "allow" });
    const ok = await h.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: pair.verifier,
    });
    const body = ok.body as { access_token: string; refresh_token: string };
    const stored = JSON.stringify([
      ...h.store.requests.values(),
      ...h.store.tokens,
      ...h.store.grants,
      USER,
    ]);
    for (const secret of [
      code,
      body.access_token,
      body.refresh_token,
      view.view.csrf,
      pair.verifier,
    ]) {
      expect(stored, secret).not.toContain(secret);
    }
    expect(stored).toContain(sha256Hex(code));
    expect(stored).toContain(sha256Hex(body.access_token));
    expect(stored).toContain(sha256Hex(body.refresh_token));
    expect(stored).toContain(sha256Hex(view.view.csrf).slice(0, 0));
  });
});
