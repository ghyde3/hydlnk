import { createHash, randomBytes } from "node:crypto";
import { authorizeRequest, type AuthorizeDeps, type AuthorizeResult } from "@/lib/oauth/authorize";
import { decideConsent, type ConsentDeps, type ConsentResult } from "@/lib/oauth/consent";
import { resolveClient } from "@/lib/oauth/clients";
import { handleTokenRequest, type TokenDeps } from "@/lib/oauth/token";
import { handleRevokeRequest, type RevokeDeps } from "@/lib/oauth/revoke";
import type { HttpResult } from "@/lib/oauth/register";
import { FakeOauthStore, openLimiter } from "./oauth-fake-store";

/** The constants of the unit tests: a local root domain, so every address is under app.localhost:3000. */
export const ISSUER = "http://app.localhost:3000";
export const RESOURCE = "http://app.localhost:3000/mcp";
export const DCR_ID = `hlc_${"a".repeat(32)}`;
export const REDIRECT = "https://a.example/cb";
export const USER = { id: "11111111-1111-4111-8111-111111111111", email: "person@example.com" };
export const OTHER = { id: "22222222-2222-4222-8222-222222222222", email: "other@example.com" };

export function pkce(seed = randomBytes(32).toString("base64url")) {
  const verifier = seed.padEnd(43, "x").slice(0, 128);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeQuery(
  over: Record<string, string | null> = {},
  challenge = pkce().challenge,
) {
  const base: Record<string, string | null> = {
    response_type: "code",
    client_id: DCR_ID,
    redirect_uri: REDIRECT,
    state: "state-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    scope: "hydlnk.read hydlnk.write hydlnk.publish",
    ...over,
  };
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(base)) if (value !== null) params.set(name, value);
  return params.toString();
}

export interface Harness {
  store: FakeOauthStore;
  limiter: ReturnType<typeof openLimiter>;
  authorizeDeps: AuthorizeDeps;
  consentDeps: ConsentDeps;
  tokenDeps: TokenDeps;
  revokeDeps: RevokeDeps;
  csrfs: string[];
  codes: string[];
  authorize: (
    query: string,
    over?: { user?: typeof USER | null; resumeId?: string | null; clientKey?: string },
  ) => Promise<AuthorizeResult>;
  consent: (
    fields: Record<string, string | string[] | undefined>,
    over?: { user?: typeof USER | null; origin?: string | null; secFetchSite?: string | null },
  ) => Promise<ConsentResult>;
  token: (
    form: Record<string, string | undefined>,
    over?: { authorization?: string | null; mediaType?: string; clientKey?: string },
  ) => Promise<HttpResult>;
  revoke: (
    form: Record<string, string | undefined>,
    over?: { authorization?: string | null; clientKey?: string },
  ) => Promise<HttpResult>;
}

/** One store, one clock, every core function wired to it. */
export function harness(
  options: {
    limit?: AuthorizeDeps["limit"];
    clientUris?: string[];
  } = {},
): Harness {
  const store = new FakeOauthStore();
  const limiter = openLimiter();
  const limit = options.limit ?? limiter.limit;
  store.addClient(DCR_ID, options.clientUris ?? [REDIRECT]);
  const csrfs: string[] = [];
  const codes: string[] = [];
  let ids = 0;
  const now = store.now;

  const authorizeDeps: AuthorizeDeps = {
    store,
    limit,
    now,
    issuer: ISSUER,
    resource: RESOURCE,
    resolveClient: (clientId) =>
      resolveClient(clientId, {
        store,
        now,
        loadCimdClient: async () => ({ ok: false, reason: "cannot_verify" }),
      }),
    newRequestId: () => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
    },
    newCsrf: () => {
      const value = `csrf-${csrfs.length + 1}-${randomBytes(8).toString("hex")}`;
      csrfs.push(value);
      return value;
    },
  };
  const consentDeps: ConsentDeps = {
    store,
    limit,
    now,
    appOrigin: "http://app.localhost:3000",
    issuer: ISSUER,
    newCode: () => {
      const value = `hl_ac_${randomBytes(32).toString("base64url")}`;
      codes.push(value);
      return value;
    },
  };
  const tokenDeps: TokenDeps = { store, limit, now, resource: RESOURCE };
  const revokeDeps: RevokeDeps = { store, limit };

  const bodyOf = (text: string) => async () => ({ ok: true as const, text });
  const form = (values: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(values))
      if (value !== undefined) params.set(name, value);
    return params.toString();
  };

  return {
    store,
    limiter,
    authorizeDeps,
    consentDeps,
    tokenDeps,
    revokeDeps,
    csrfs,
    codes,
    authorize: (query, over = {}) =>
      authorizeRequest(
        {
          rawQuery: query,
          clientKey: over.clientKey ?? "203.0.113.7",
          user: over.user === undefined ? USER : over.user,
          resumeId: over.resumeId ?? null,
        },
        authorizeDeps,
      ),
    consent: (fields, over = {}) => {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) params.append(name, v);
      }
      return decideConsent(
        {
          origin: over.origin === undefined ? "http://app.localhost:3000" : over.origin,
          secFetchSite: over.secFetchSite ?? null,
          user: over.user === undefined ? USER : over.user,
          fields: params,
        },
        consentDeps,
      );
    },
    token: (values, over = {}) =>
      handleTokenRequest(
        {
          clientKey: over.clientKey ?? "203.0.113.7",
          mediaType: over.mediaType ?? "application/x-www-form-urlencoded",
          authorization: over.authorization ?? null,
          readBody: bodyOf(form(values)),
        },
        tokenDeps,
      ),
    revoke: (values, over = {}) =>
      handleRevokeRequest(
        {
          clientKey: over.clientKey ?? "203.0.113.7",
          mediaType: "application/x-www-form-urlencoded",
          authorization: over.authorization ?? null,
          readBody: bodyOf(form(values)),
        },
        revokeDeps,
      ),
  };
}

/** Runs authorize (signed in) and Allow, and returns what the app would see. */
export async function allow(
  h: Harness,
  options: {
    scopes?: string[];
    query?: Record<string, string | null>;
    user?: typeof USER;
    challenge?: string;
    decision?: "allow" | "deny";
  } = {},
) {
  const challenge = options.challenge ?? pkce().challenge;
  const result = await h.authorize(authorizeQuery(options.query ?? {}, challenge), {
    user: options.user ?? USER,
  });
  if (result.kind !== "consent") throw new Error(`expected the consent screen, got ${result.kind}`);
  const decision = await h.consent(
    {
      request: result.view.requestId,
      csrf: result.view.csrf,
      decision: options.decision ?? "allow",
      scope: options.scopes ?? ["hydlnk.write", "hydlnk.publish"],
    },
    { user: options.user ?? USER },
  );
  if (decision.kind !== "redirect") throw new Error(`expected a redirect, got ${decision.kind}`);
  const location = new URL(decision.location);
  return { view: result.view, location, code: location.searchParams.get("code") };
}

/** A whole sign-in: authorize, Allow, and the first token exchange. */
export async function connect(h: Harness, options: Parameters<typeof allow>[1] = {}) {
  const { verifier, challenge } = pkce();
  const { code, view } = await allow(h, { ...options, challenge });
  const response = await h.token({
    grant_type: "authorization_code",
    code: code ?? undefined,
    redirect_uri: REDIRECT,
    client_id: DCR_ID,
    code_verifier: verifier,
  });
  if (response.status !== 200)
    throw new Error(`the exchange failed: ${JSON.stringify(response.body)}`);
  const body = response.body as {
    access_token: string;
    refresh_token: string;
    scope: string;
    expires_in: number;
    token_type: string;
  };
  return { ...body, view, verifier, code: code! };
}
