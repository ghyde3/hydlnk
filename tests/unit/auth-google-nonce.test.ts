import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The nonce half of Google sign-in: what the page is given (only sha256 of a server-kept random
 * value), where the raw value lives (an httpOnly host-only cookie) and who may ask.
 */

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com" as string | undefined,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: env }));

interface SetCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}
let setCalls: SetCall[];
let origin: string | null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) =>
      setCalls.push({ name, value, options }),
  }),
  headers: async () => new Headers(origin === null ? {} : { origin }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/lib/auth/accounts", () => ({ ensureAccount: async () => {} }));
vi.mock("@/lib/handles/claim", () => ({ accountHasPage: async () => false }));
vi.mock("@/lib/handles/availability", () => ({
  checkHandle: async (h: string) => ({ handle: h, status: "available" }),
}));

const { issueGoogleNonce, hashNonce, readIdTokenClaims } = await import("@/lib/auth/google");
const { prepareGoogleSignIn } = await import("@/lib/auth/google-actions");
const { GOOGLE_NONCE_COOKIE, GOOGLE_NONCE_MAX_AGE_SECONDS } =
  await import("@/lib/auth/google-shared");

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(() => {
  setCalls = [];
  origin = "http://app.localhost:3000";
  env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3000";
  env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
});

describe("issueGoogleNonce", () => {
  it("keeps the raw nonce in an httpOnly, host-only, SameSite=Lax cookie that lives at most 15 minutes", async () => {
    const result = await issueGoogleNonce();
    expect(result.ok).toBe(true);
    expect(setCalls).toHaveLength(1);
    const [cookie] = setCalls;
    expect(cookie!.name).toBe(GOOGLE_NONCE_COOKIE);
    expect(cookie!.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: GOOGLE_NONCE_MAX_AGE_SECONDS,
      secure: false, // plain-http local development
    });
    expect(cookie!.options).not.toHaveProperty("domain");
    expect(GOOGLE_NONCE_MAX_AGE_SECONDS).toBeLessThanOrEqual(900);
  });

  it("is Secure on https deployments", async () => {
    env.NEXT_PUBLIC_ROOT_DOMAIN = "hydlnk.com";
    origin = "https://app.hydlnk.com";
    await issueGoogleNonce();
    expect(setCalls[0]!.options).toMatchObject({ secure: true, httpOnly: true });
    expect(setCalls[0]!.options).not.toHaveProperty("domain");
  });

  it("gives the page only sha256(raw): never the raw value", async () => {
    const result = await issueGoogleNonce();
    if (!result.ok) throw new Error("expected a nonce");
    const raw = setCalls[0]!.value;
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(result.nonce).toBe(sha256(raw));
    expect(result.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(result.nonce).not.toBe(raw);
    expect(JSON.stringify(result)).not.toContain(raw);
    expect(hashNonce(raw)).toBe(result.nonce);
  });

  it("is fresh every time", async () => {
    const first = await issueGoogleNonce();
    const second = await issueGoogleNonce();
    expect(first).not.toEqual(second);
    expect(setCalls[0]!.value).not.toBe(setCalls[1]!.value);
  });

  it.each([
    ["a foreign site", "https://evil.example"],
    ["the marketing host", "http://localhost:3000"],
    ["a missing Origin", null],
  ])("refuses %s and sets no cookie", async (_label, value) => {
    origin = value;
    expect(await issueGoogleNonce()).toEqual({ ok: false });
    expect(setCalls).toEqual([]);
  });

  it("is off when Google sign-in is not configured", async () => {
    env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = undefined;
    expect(await issueGoogleNonce()).toEqual({ ok: false });
    expect(setCalls).toEqual([]);
  });

  it("is what the prepareGoogleSignIn Server Action returns", async () => {
    const result = await prepareGoogleSignIn();
    expect(result.ok).toBe(true);
    expect(setCalls).toHaveLength(1);
  });
});

describe("readIdTokenClaims", () => {
  const token = (payload: unknown) =>
    `h.${Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).toString("base64url")}.s`;

  it("reads the payload of a JWT", () => {
    expect(readIdTokenClaims(token({ nonce: "n", aud: "a" }))).toEqual({ nonce: "n", aud: "a" });
  });

  it.each([
    ["no payload", "onlyone"],
    ["not JSON", token("not json")],
    ["an array", token("[1,2]")],
    ["null", token("null")],
    ["a string", token('"x"')],
  ])("returns null for %s", (_label, value) => {
    expect(readIdTokenClaims(value)).toBeNull();
  });
});
