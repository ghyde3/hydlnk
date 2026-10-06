import { describe, expect, it, vi } from "vitest";
import { resolveClient } from "@/lib/oauth/clients";
import { loadCimdClientWith, type CimdDeps } from "@/lib/oauth/cimd";
import { verifyAccessToken } from "@/lib/oauth/verify";
import { APP_BLOCKED, AUTHORIZE_ERROR_REASON } from "@/lib/oauth/messages";
import {
  CLAUDE_ID,
  CLAUDE_REDIRECT,
  DCR_ID,
  REDIRECT,
  RESOURCE,
  USER,
  addClaude,
  allow,
  authorizeQuery,
  connect,
  harness,
  pkce,
} from "./helpers/oauth-flow";
import { FakeOauthStore, openLimiter } from "./helpers/oauth-fake-store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("@/lib/oauth/config", () => ({ oauthConfig: () => ({ rootDomain: "hydlnk.com" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

/**
 * M13-10: an app an admin revoked for everyone. It can neither authorize nor refresh, its existing
 * tokens stop working, a re-fetch of its metadata cannot lift the block, and a restore lets it
 * authorize again. Pure core over the in-memory store (whose block and unblock mirror
 * admin_block_oauth_client and admin_unblock_oauth_client; the SQL is proved by 185-app-blocking).
 */

const refresh = (h: ReturnType<typeof harness>, token: string, clientId = DCR_ID) =>
  h.token({ grant_type: "refresh_token", refresh_token: token, client_id: clientId });

describe("M13-10 a blocked app", () => {
  it("cannot authorize: the error page, nothing stored, never a redirect (signed in or out)", async () => {
    const h = harness();
    h.store.blockClient(DCR_ID);
    for (const user of [USER, null]) {
      const out = await h.authorize(authorizeQuery({}, pkce().challenge), { user });
      expect(out).toEqual({ kind: "error_page", status: 400, errorClass: "app_blocked" });
    }
    expect(h.store.requests.size).toBe(0);
    expect(AUTHORIZE_ERROR_REASON.app_blocked).toBe("HYDLNK has blocked this app.");
  });

  it("a known client with a trusted return address gets the error page, not an error redirect", async () => {
    const h = harness();
    addClaude(h);
    h.store.blockClient(CLAUDE_ID);
    // A request that would otherwise redirect an error (no code_challenge): still the error page.
    const out = await h.authorize(
      `response_type=code&client_id=${encodeURIComponent(CLAUDE_ID)}&redirect_uri=${encodeURIComponent(CLAUDE_REDIRECT)}&state=s`,
      { user: USER },
    );
    expect(out).toMatchObject({ kind: "error_page", errorClass: "app_blocked" });
  });

  it("cannot refresh: invalid_grant, and the rotated pair is never issued", async () => {
    const h = harness();
    const done = await connect(h);
    h.store.blockClient(DCR_ID);
    const result = await refresh(h, done.refresh_token);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: "invalid_grant",
      error_description: "HYDLNK has blocked this app.",
    });
    expect(h.store.tokens.filter((t) => t.revokedAt === null)).toEqual([]);
  });

  it("the check is on the client's row, not on the tokens: a refresh token that was not ended is refused too", async () => {
    const h = harness();
    const done = await connect(h);
    // Only the flag, as if a token had been issued in the instant between the check and the block.
    h.store.clients.get(DCR_ID)!.blocked_at = new Date(h.store.clock).toISOString();
    const result = await refresh(h, done.refresh_token);
    expect(result.body).toMatchObject({ error: "invalid_grant" });
    expect(h.store.tokens.some((t) => t.kind === "refresh" && t.rotatedAt !== null)).toBe(false);
  });

  it("cannot exchange a code issued before the block", async () => {
    const h = harness();
    const { verifier, challenge } = pkce();
    const { code } = await allow(h, { challenge });
    h.store.clients.get(DCR_ID)!.blocked_at = new Date(h.store.clock).toISOString();
    const result = await h.token({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: REDIRECT,
      client_id: DCR_ID,
      code_verifier: verifier,
    });
    expect(result.body).toMatchObject({ error: "invalid_grant" });
    expect(h.store.tokens).toEqual([]);
  });

  it("its existing access tokens stop working at once", async () => {
    const h = harness();
    const done = await connect(h);
    const deps = { store: h.store, resource: RESOURCE, now: h.store.now, defer: () => undefined };
    expect(await verifyAccessToken(done.access_token, deps)).not.toBeNull();
    h.store.blockClient(DCR_ID);
    expect(await verifyAccessToken(done.access_token, deps)).toBeNull();
  });

  it("an Allow on a screen drawn before the block issues nothing", async () => {
    const h = harness();
    const shown = await h.authorize(authorizeQuery({}, pkce().challenge), { user: USER });
    if (shown.kind !== "consent") throw new Error("expected consent");
    h.store.clients.get(DCR_ID)!.blocked_at = new Date(h.store.clock).toISOString();
    const out = await h.consent(
      { request: shown.view.requestId, csrf: shown.view.csrf, decision: "allow", scope: [] },
      { user: USER },
    );
    expect(out).toMatchObject({ kind: "message", status: 403, message: "app_blocked" });
    expect(h.store.grants).toEqual([]);
    expect(APP_BLOCKED).toContain("blocked");
  });

  it("restore lets it authorize and connect again (the old grants stay ended)", async () => {
    const h = harness();
    const first = await connect(h);
    h.store.blockClient(DCR_ID);
    expect(h.store.unblockClient(DCR_ID)).toBe("unblocked");
    expect((await refresh(h, first.refresh_token)).body).toMatchObject({ error: "invalid_grant" });
    const again = await connect(h);
    expect(again.access_token).toMatch(/^hl_at_/);
    expect(h.store.clients.get(DCR_ID)!.blocked_at).toBeNull();
  });
});

describe("M13-10 a re-fetch of the metadata never lifts the block", () => {
  const URL_ = "https://app.example.com/oauth/client.json";
  const doc = {
    client_id: URL_,
    client_name: "Example",
    redirect_uris: ["https://app.example.com/cb"],
  };
  function setup() {
    const store = new FakeOauthStore();
    const deps: CimdDeps = {
      store,
      limit: openLimiter().limit,
      now: store.now,
      fetchDeps: { rootDomain: "hydlnk.com", allowTestStub: false },
      inflight: new Map(),
      fetchDocument: async () => ({
        ok: true,
        body: new TextEncoder().encode(JSON.stringify(doc)),
        contentType: "application/json",
        cacheControl: null,
        host: "app.example.com",
      }),
      fetchLogo: async () => null,
    };
    const resolve = () =>
      resolveClient(URL_, {
        store,
        now: store.now,
        loadCimdClient: (id) => loadCimdClientWith(id, "203.0.113.7", deps),
      });
    return { store, resolve };
  }

  it("the stored row and the row handed back both stay blocked after the cache expires", async () => {
    const t = setup();
    expect((await t.resolve()).ok).toBe(true);
    t.store.blockClient(URL_, undefined, "abuse");
    t.store.advance(86_400 * 2);
    const out = await t.resolve();
    expect(out).toMatchObject({ ok: true, client: { blocked_at: expect.any(String) } });
    const row = t.store.clients.get(URL_)!;
    expect(row.blocked_at).not.toBeNull();
    expect(row.blocked_reason).toBe("abuse");
  });

  it("a freshly fetched row for an unblocked client says it is not blocked", async () => {
    const t = setup();
    expect(await t.resolve()).toMatchObject({ ok: true, client: { blocked_at: null } });
  });
});

describe("M13-10 the real store's upsert", () => {
  it("never names the blocked columns", async () => {
    const { createSupabaseOauthStore } = await import("@/lib/oauth/store-supabase");
    let payload: Record<string, unknown> = {};
    const admin = {
      from: () => ({
        upsert: async (row: Record<string, unknown>) => {
          payload = row;
          return { error: null };
        },
      }),
    };
    await createSupabaseOauthStore(admin as never).upsertCimdClient({
      client_id: "https://a.example.com/c.json",
      kind: "cimd",
      client_name: "A",
      redirect_uris: ["https://a.example.com/cb"],
    } as never);
    expect(Object.keys(payload).length).toBeGreaterThan(3);
    expect(Object.keys(payload).filter((key) => key.startsWith("blocked_"))).toEqual([]);
  });
});
