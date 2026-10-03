import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeHandle, validateHandle } from "@/lib/handles/rules";

/**
 * Google sign-in through Google Identity Services (M1-29, M1-30): the server side of the flow,
 * with Supabase, the cookie jar and the request headers mocked. Everything a user or an attacker
 * can influence is covered: the Origin, the nonce cookie, the token's claims, the handle.
 */

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const APP_ORIGIN = "http://app.localhost:3000";
const RAW_NONCE = "A".repeat(43); // what randomBytes(32).toString("base64url") looks like
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com" as string | undefined,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: env }));

// --- the request: cookie jar and headers ---------------------------------------------------------
interface SetCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}
let jar: Map<string, string>;
let setCalls: SetCall[];
let deleted: string[];
let origin: string | null;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      jar.set(name, value);
    },
    delete: (name: string) => {
      deleted.push(name);
      jar.delete(name);
    },
  }),
  headers: async () => new Headers(origin === null ? {} : { origin }),
}));

// --- Supabase, accounts, handles -----------------------------------------------------------------
type IdTokenResult = {
  data: { user: { id: string } | null };
  error: { code?: string; status?: number; message: string } | null;
};
const signInWithIdToken = vi.fn<(args: Record<string, unknown>) => Promise<IdTokenResult>>();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { signInWithIdToken: (a: never) => signInWithIdToken(a) },
  }),
}));

const ensureAccount = vi.fn<(id: string) => Promise<void>>();
vi.mock("@/lib/auth/accounts", () => ({ ensureAccount: (id: string) => ensureAccount(id) }));

const accountHasPage = vi.fn<(id: string) => Promise<boolean>>();
vi.mock("@/lib/handles/claim", () => ({ accountHasPage: (id: string) => accountHasPage(id) }));

const TAKEN = new Set(["mara"]);
const RESERVED = new Set(["www", "admin"]);
const checkHandle = vi.fn(async (raw: string) => {
  const handle = normalizeHandle(raw);
  const rule = validateHandle(handle);
  if (rule !== "ok") return { handle, status: rule };
  if (RESERVED.has(handle)) return { handle, status: "reserved" as const };
  if (TAKEN.has(handle)) return { handle, status: "taken" as const };
  return { handle, status: "available" as const };
});
vi.mock("@/lib/handles/availability", () => ({ checkHandle: (raw: string) => checkHandle(raw) }));

const { completeGoogleSignIn, hashNonce } = await import("@/lib/auth/google");
const { signInWithGoogle } = await import("@/lib/auth/google-actions");
const {
  GOOGLE_EXPIRED_MESSAGE,
  GOOGLE_FAILED_MESSAGE,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_RATE_LIMITED_MESSAGE,
} = await import("@/lib/auth/google-shared");
const { PENDING_HANDLE_COOKIE } = await import("@/lib/handles/pending");

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** A Google-looking ID token. The signature is junk: Supabase (mocked here) is what verifies it. */
function idToken(claims: Record<string, unknown> = {}): string {
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1234567890",
    email: "person@example.com",
    nonce: sha256(RAW_NONCE),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.c2ln`;
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const pendingCookie = () => setCalls.find((c) => c.name === PENDING_HANDLE_COOKIE);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3000";
  env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = CLIENT_ID;
  jar = new Map([[GOOGLE_NONCE_COOKIE, RAW_NONCE]]);
  setCalls = [];
  deleted = [];
  origin = APP_ORIGIN;
  signInWithIdToken.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  ensureAccount.mockResolvedValue(undefined);
  accountHasPage.mockResolvedValue(false);
});

describe("a valid token", () => {
  it("signs in through Supabase with the RAW nonce from the cookie, makes the account row and says ok", async () => {
    const token = idToken();
    const result = await completeGoogleSignIn({ credential: token });

    expect(result).toEqual({ kind: "ok" });
    expect(signInWithIdToken).toHaveBeenCalledTimes(1);
    // The raw nonce goes to Supabase, which hashes it itself; Google got the hash.
    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token,
      nonce: RAW_NONCE,
    });
    expect(hashNonce(RAW_NONCE)).toBe(sha256(RAW_NONCE));
    expect(ensureAccount).toHaveBeenCalledWith(USER_ID);
  });

  it("spends the nonce: the cookie is cleared on success", async () => {
    await completeGoogleSignIn({ credential: idToken() });
    expect(deleted).toContain(GOOGLE_NONCE_COOKIE);
    expect(jar.has(GOOGLE_NONCE_COOKIE)).toBe(false);
  });

  it("never reads a nonce from the request: a nonce field in the input is ignored", async () => {
    const attacker = "B".repeat(43);
    const result = await completeGoogleSignIn({
      credential: idToken({ nonce: sha256(attacker) }),
      nonce: attacker,
    } as never);
    expect(result).toEqual({ kind: "error", message: GOOGLE_EXPIRED_MESSAGE });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("an ensureAccount failure does not undo the sign-in", async () => {
    ensureAccount.mockRejectedValue(new Error("db down"));
    expect(await completeGoogleSignIn({ credential: idToken() })).toEqual({ kind: "ok" });
  });

  it("is reached through the Server Action wrapper the button calls", async () => {
    expect(await signInWithGoogle({ credential: idToken() })).toEqual({ kind: "ok" });
    expect(signInWithIdToken).toHaveBeenCalledTimes(1);
  });

  it("the wrapper survives a malformed call (null input) with a refusal", async () => {
    expect(await signInWithGoogle(null as never)).toEqual({
      kind: "error",
      message: GOOGLE_FAILED_MESSAGE,
    });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });
});

describe("the nonce cookie", () => {
  it("is required: without it Supabase is never asked", async () => {
    jar.delete(GOOGLE_NONCE_COOKIE);
    expect(await completeGoogleSignIn({ credential: idToken() })).toEqual({
      kind: "error",
      message: GOOGLE_EXPIRED_MESSAGE,
    });
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(ensureAccount).not.toHaveBeenCalled();
  });

  it.each(["", "short", "!".repeat(43), "A".repeat(44), `${"A".repeat(42)} `])(
    "a value that is not one of ours (%j) is refused",
    async (value) => {
      jar.set(GOOGLE_NONCE_COOKIE, value);
      const result = await completeGoogleSignIn({ credential: idToken() });
      expect(result.kind).toBe("error");
      expect(signInWithIdToken).not.toHaveBeenCalled();
    },
  );

  it("a token made for a different nonce (replay of an earlier page's token) is refused", async () => {
    const result = await completeGoogleSignIn({
      credential: idToken({ nonce: sha256("C".repeat(43)) }),
    });
    expect(result).toEqual({ kind: "error", message: GOOGLE_EXPIRED_MESSAGE });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("the unhashed nonce in the token is not accepted in place of its hash", async () => {
    const result = await completeGoogleSignIn({ credential: idToken({ nonce: RAW_NONCE }) });
    expect(result.kind).toBe("error");
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("a token with no nonce claim, or a non-string one, is refused", async () => {
    for (const nonce of [undefined, null, 5, ["x"]]) {
      jar.set(GOOGLE_NONCE_COOKIE, RAW_NONCE);
      const result = await completeGoogleSignIn({ credential: idToken({ nonce }) });
      expect(result.kind).toBe("error");
    }
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("is single use: cleared by a refused attempt too, so the same page can't try twice with it", async () => {
    await completeGoogleSignIn({ credential: idToken({ nonce: "wrong" }) });
    expect(jar.has(GOOGLE_NONCE_COOKIE)).toBe(false);
    // The second attempt, even with the right token, now has no nonce to match.
    const again = await completeGoogleSignIn({ credential: idToken() });
    expect(again).toEqual({ kind: "error", message: GOOGLE_EXPIRED_MESSAGE });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });
});

describe("the credential", () => {
  it.each([
    ["undefined", undefined],
    ["a number", 42],
    ["an object", { a: 1 }],
    ["an empty string", ""],
    ["not a JWT", "not-a-jwt"],
    ["two segments", "aaa.bbb"],
    ["four segments", "a.b.c.d"],
    ["spaces", "aaa.bbb .ccc"],
    ["over-long", `aaa.${"b".repeat(6000)}.ccc`],
  ])("%s is refused before Supabase", async (_label, credential) => {
    const result = await completeGoogleSignIn({ credential });
    expect(result).toEqual({ kind: "error", message: GOOGLE_FAILED_MESSAGE });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("a JWT whose payload is not JSON is refused", async () => {
    const result = await completeGoogleSignIn({ credential: "aaa.bbb.ccc" });
    expect(result.kind).toBe("error");
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("a token issued for another Google client (audience) is refused", async () => {
    const result = await completeGoogleSignIn({
      credential: idToken({ aud: "someone-elses.apps.googleusercontent.com" }),
    });
    expect(result).toEqual({ kind: "error", message: GOOGLE_FAILED_MESSAGE });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("an audience list that contains this client is fine", async () => {
    const result = await completeGoogleSignIn({
      credential: idToken({ aud: ["other.apps.googleusercontent.com", CLIENT_ID] }),
    });
    expect(result).toEqual({ kind: "ok" });
  });
});

describe("same-origin only (CSRF)", () => {
  it.each([
    ["a foreign site", "https://evil.example"],
    ["the marketing host", "http://localhost:3000"],
    ["a tenant host", "http://mara.localhost:3000"],
    ["the literal string null", "null"],
    ["the app host on another port", "http://app.localhost:3001"],
    ["the app host over https", "https://app.localhost:3000"],
    ["a missing Origin header", null],
  ])("%s is refused, and the visitor's nonce is not burned", async (_label, value) => {
    origin = value;
    const result = await completeGoogleSignIn({ credential: idToken() });
    expect(result).toEqual({ kind: "error", message: GOOGLE_FAILED_MESSAGE });
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(jar.get(GOOGLE_NONCE_COOKIE)).toBe(RAW_NONCE);
    expect(setCalls).toEqual([]);
  });

  it("checks against the production app host", async () => {
    env.NEXT_PUBLIC_ROOT_DOMAIN = "hydlnk.com";
    origin = "https://app.hydlnk.com";
    expect(await completeGoogleSignIn({ credential: idToken() })).toEqual({ kind: "ok" });
    origin = "https://hydlnk.com";
    jar.set(GOOGLE_NONCE_COOKIE, RAW_NONCE);
    expect((await completeGoogleSignIn({ credential: idToken() })).kind).toBe("error");
  });

  it("refuses everything when Google sign-in is not configured", async () => {
    env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = undefined;
    expect(await completeGoogleSignIn({ credential: idToken() })).toEqual({
      kind: "error",
      message: GOOGLE_FAILED_MESSAGE,
    });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });
});

describe("when Supabase says no", () => {
  it("gives a friendly message, no session, no account row, no pending handle, and clears the nonce", async () => {
    signInWithIdToken.mockResolvedValue({
      data: { user: null },
      error: { code: "bad_jwt", status: 400, message: "Bad ID token: signature secret-detail" },
    });
    const result = await completeGoogleSignIn({ credential: idToken(), handle: "zq-gs-1" });

    expect(result).toEqual({ kind: "error", message: GOOGLE_FAILED_MESSAGE });
    expect(JSON.stringify(result)).not.toContain("secret-detail");
    expect(ensureAccount).not.toHaveBeenCalled();
    expect(pendingCookie()).toBeUndefined();
    expect(jar.has(GOOGLE_NONCE_COOKIE)).toBe(false);
    // Only the error code is logged, never its message.
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-detail");
  });

  it("says so when Supabase is rate limiting", async () => {
    signInWithIdToken.mockResolvedValue({
      data: { user: null },
      error: { code: "over_request_rate_limit", status: 429, message: "rate" },
    });
    expect(await completeGoogleSignIn({ credential: idToken() })).toEqual({
      kind: "error",
      message: GOOGLE_RATE_LIMITED_MESSAGE,
    });
  });

  it("survives Supabase being unreachable (a thrown error)", async () => {
    signInWithIdToken.mockRejectedValue(new Error("fetch failed"));
    expect(await completeGoogleSignIn({ credential: idToken() })).toEqual({
      kind: "error",
      message: GOOGLE_FAILED_MESSAGE,
    });
  });

  it("treats a response with no user as a failure", async () => {
    signInWithIdToken.mockResolvedValue({ data: { user: null }, error: null });
    expect((await completeGoogleSignIn({ credential: idToken() })).kind).toBe("error");
    expect(ensureAccount).not.toHaveBeenCalled();
  });
});

describe("signup: the chosen handle (M1-30)", () => {
  it("is carried in the short-lived pending-handle cookie, set only after the sign-in worked", async () => {
    const result = await completeGoogleSignIn({ credential: idToken(), handle: "zq-gs-1" });
    expect(result).toEqual({ kind: "ok" });

    const cookie = pendingCookie();
    expect(cookie, "pending-handle cookie").toBeTruthy();
    expect(cookie!.value).toBe("zq-gs-1");
    expect(cookie!.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(cookie!.options.maxAge as number).toBeLessThanOrEqual(900);
    expect(cookie!.options.maxAge as number).toBeGreaterThan(0);
    expect(cookie!.options).not.toHaveProperty("domain"); // host-only: tenants never see it
    expect(cookie!.options.secure).toBe(false); // plain-http local development
    expect(accountHasPage).toHaveBeenCalledWith(USER_ID);
  });

  it("is Secure on https and still host-only", async () => {
    env.NEXT_PUBLIC_ROOT_DOMAIN = "hydlnk.com";
    origin = "https://app.hydlnk.com";
    await completeGoogleSignIn({ credential: idToken(), handle: "zq-gs-1" });
    expect(pendingCookie()!.options).toMatchObject({ secure: true, httpOnly: true });
    expect(pendingCookie()!.options).not.toHaveProperty("domain");
    expect(setCalls.every((c) => !("domain" in c.options))).toBe(true);
  });

  it("is normalized exactly as the email flow does (the cookie holds a valid normalized handle)", async () => {
    await completeGoogleSignIn({ credential: idToken(), handle: "ZQ-Gs-2" });
    expect(pendingCookie()!.value).toBe("zq-gs-2");
  });

  it.each([
    ["www", "reserved"],
    ["admin", "reserved"],
    ["mara", "taken"],
    ["ab", "short"],
    ["", "short"],
    ["-bad-", "invalid"],
    ["x".repeat(31), "too_long"],
  ])(
    "refuses %j (%s) before anyone is signed in: no session, no cookie, no account",
    async (handle, status) => {
      const result = await completeGoogleSignIn({ credential: idToken(), handle });
      expect(result).toEqual({ kind: "handle", handle: normalizeHandle(handle), status });
      expect(signInWithIdToken).not.toHaveBeenCalled();
      expect(ensureAccount).not.toHaveBeenCalled();
      expect(pendingCookie()).toBeUndefined();
      // The attempt still spent the nonce.
      expect(jar.has(GOOGLE_NONCE_COOKIE)).toBe(false);
    },
  );

  it("refuses a handle that is not a string", async () => {
    for (const handle of [5, { a: 1 }, ["zq"], true]) {
      jar.set(GOOGLE_NONCE_COOKIE, RAW_NONCE);
      const result = await completeGoogleSignIn({ credential: idToken(), handle });
      expect(result).toEqual({ kind: "error", message: GOOGLE_FAILED_MESSAGE });
    }
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("does not sign anyone in when the availability check itself fails", async () => {
    checkHandle.mockRejectedValueOnce(new Error("db down"));
    const result = await completeGoogleSignIn({ credential: idToken(), handle: "zq-gs-1" });
    expect(result.kind).toBe("error");
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(pendingCookie()).toBeUndefined();
  });

  it("sets no cookie, and drops a stale one, when the account already has a page", async () => {
    accountHasPage.mockResolvedValue(true);
    jar.set(PENDING_HANDLE_COOKIE, "zq-old-1");
    const result = await completeGoogleSignIn({ credential: idToken(), handle: "zq-gs-1" });
    expect(result).toEqual({ kind: "ok" });
    expect(pendingCookie()).toBeUndefined();
    expect(deleted).toContain(PENDING_HANDLE_COOKIE);
  });

  it("sets no cookie when the page lookup fails (carries nothing rather than guess)", async () => {
    accountHasPage.mockRejectedValue(new Error("db down"));
    const result = await completeGoogleSignIn({ credential: idToken(), handle: "zq-gs-1" });
    expect(result).toEqual({ kind: "ok" });
    expect(pendingCookie()).toBeUndefined();
  });
});

describe("log in: no handle", () => {
  it("sets no pending-handle cookie and leaves an earlier one for the claim step", async () => {
    jar.set(PENDING_HANDLE_COOKIE, "zq-old-1");
    const result = await completeGoogleSignIn({ credential: idToken() });
    expect(result).toEqual({ kind: "ok" });
    expect(pendingCookie()).toBeUndefined();
    expect(deleted).not.toContain(PENDING_HANDLE_COOKIE);
    expect(checkHandle).not.toHaveBeenCalled();
  });

  it("drops a stale pending-handle cookie when the account already has a page (as /auth/callback does)", async () => {
    accountHasPage.mockResolvedValue(true);
    jar.set(PENDING_HANDLE_COOKIE, "zq-old-1");
    await completeGoogleSignIn({ credential: idToken() });
    expect(deleted).toContain(PENDING_HANDLE_COOKIE);
  });

  it("treats a null handle like a missing one", async () => {
    expect(await completeGoogleSignIn({ credential: idToken(), handle: null })).toEqual({
      kind: "ok",
    });
    expect(checkHandle).not.toHaveBeenCalled();
  });
});
