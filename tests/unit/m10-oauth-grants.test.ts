import { describe, expect, it, vi } from "vitest";
import { loadConnectedApps, revokeAllGrants, revokeConnectedAppFor } from "@/lib/oauth/grants";
import { memoryLimiter, openLimiter } from "./helpers/oauth-fake-store";
import { DCR_ID, REDIRECT, USER, OTHER, allow, connect, harness } from "./helpers/oauth-flow";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/oauth/store-supabase", () => ({ defaultOauthStore: () => ({}) }));

/**
 * M10-18 and M10-19 behind the card: what it lists and what Revoke does. The screen is
 * tests/e2e/m10/oauth-connected-apps.spec.ts; the database moves are pgTAP 170.
 */

const GRANT_ID = "00000000-0000-4000-8000-0000000000aa";

describe("M10-18 loadConnectedApps", () => {
  it("lists the person's active grants with the name, address, scopes and dates, and nothing secret", async () => {
    const h = harness();
    await connect(h, { scopes: ["hydlnk.write"] });
    const apps = await loadConnectedApps(USER.id, h.store);
    expect(apps).toEqual([
      {
        id: h.store.grants[0]!.id,
        name: "Test app",
        address: null,
        scopes: ["hydlnk.read", "hydlnk.write"],
        connectedOn: expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2}, 2026$/),
        lastUsedOn: null,
      },
    ]);
    expect(JSON.stringify(apps)).not.toMatch(/hl_(at|rt|ac)_|hlc_|hash/);
    expect(JSON.stringify(apps)).not.toContain(DCR_ID);
  });

  it("shows a metadata client's address host, and a registered one as null (not verified)", async () => {
    const h = harness();
    h.store.addClient("https://app.example.org/oauth/client.json", [REDIRECT], {
      client_name: "Meta app",
    });
    h.store.grants.push({
      id: GRANT_ID,
      userId: USER.id,
      clientId: "https://app.example.org/oauth/client.json",
      scopes: ["hydlnk.read"],
      authorizedAt: h.store.clock,
      createdAt: h.store.clock,
      lastUsedAt: h.store.clock,
      revokedAt: null,
    });
    const [app] = await loadConnectedApps(USER.id, h.store);
    expect(app).toMatchObject({
      name: "Meta app",
      address: "app.example.org",
      lastUsedOn: expect.any(String),
    });
  });

  it("never lists another person's grant, an ended grant, or one whose client is gone; at most 20, most recently used first", async () => {
    const h = harness();
    await connect(h);
    await allow(h, { user: OTHER });
    h.store.grants.push({
      id: GRANT_ID,
      userId: USER.id,
      clientId: "hlc_gone",
      scopes: ["hydlnk.read"],
      authorizedAt: 0,
      createdAt: 0,
      lastUsedAt: null,
      revokedAt: null,
    });
    for (let i = 0; i < 25; i += 1) {
      const clientId = `hlc_${String(i).padStart(32, "0")}`;
      h.store.addClient(clientId, [REDIRECT], { client_name: `App ${i}` });
      h.store.grants.push({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        userId: USER.id,
        clientId,
        scopes: ["hydlnk.read"],
        authorizedAt: 0,
        createdAt: i * 1000,
        lastUsedAt: i * 1000,
        revokedAt: i === 24 ? 1 : null,
      });
    }
    const apps = await loadConnectedApps(USER.id, h.store);
    expect(apps.length).toBeLessThanOrEqual(20);
    expect(apps.map((app) => app.name)).not.toContain("App 24");
    expect(apps.some((app) => app.id === GRANT_ID)).toBe(false);
    for (const app of apps) expect(app.name).not.toBe("");
    const used = apps.map((app) => app.lastUsedOn);
    expect(used[0]).not.toBeNull();
  });
});

describe("M10-18 revokeConnectedAppFor", () => {
  const deps = (h: ReturnType<typeof harness>, limit = openLimiter().limit) => ({
    store: h.store,
    limit,
  });

  it("no session is unauthorized and changes nothing", async () => {
    const h = harness();
    await connect(h);
    const result = await revokeConnectedAppFor(null, h.store.grants[0]!.id, deps(h));
    expect(result).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(h.store.grants[0]!.revokedAt).toBeNull();
  });

  it("another person's grant, a random id and a malformed id are not_found and change nothing", async () => {
    const h = harness();
    await connect(h);
    for (const id of [h.store.grants[0]!.id, GRANT_ID, "not-a-uuid", "", undefined, 5, null]) {
      const result = await revokeConnectedAppFor(OTHER, id, deps(h));
      expect(result, String(id)).toMatchObject({ ok: false, reason: "not_found" });
    }
    expect(h.store.grants[0]!.revokedAt).toBeNull();
    expect(h.store.tokens.every((t) => t.revokedAt === null)).toBe(true);
  });

  it("on success the grant and its tokens end, repeating it is safe, and a suspended account may revoke", async () => {
    const h = harness();
    await connect(h);
    h.store.suspended.add(USER.id);
    const id = h.store.grants[0]!.id;
    expect(await revokeConnectedAppFor(USER, id, deps(h))).toEqual({ ok: true });
    expect(h.store.grants[0]!.revokedAt).not.toBeNull();
    expect(h.store.tokens.every((t) => t.revokedAt !== null)).toBe(true);
    expect(await revokeConnectedAppFor(USER, id, deps(h))).toEqual({ ok: true });
  });

  it("is limited to 60 an hour per person: rate_limited with the plain sentence", async () => {
    const h = harness();
    await connect(h);
    const limit = memoryLimiter(h.store.now);
    for (let i = 0; i < 60; i += 1) await revokeConnectedAppFor(USER, GRANT_ID, deps(h, limit));
    const result = await revokeConnectedAppFor(USER, GRANT_ID, deps(h, limit));
    expect(result).toEqual({
      ok: false,
      reason: "rate_limited",
      message: "You’ve done that a lot. Try again in a while.",
    });
    const keys = openLimiter();
    await revokeConnectedAppFor(USER, GRANT_ID, deps(h, keys.limit));
    expect(keys.calls[0]).toEqual({ key: `oauth-revoke-user:${USER.id}`, limit: 60, window: 3600 });
  });

  it("a store failure is a plain failure that names nothing", async () => {
    const h = harness();
    await connect(h);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.store.failNext = "revokeUserGrant";
    const result = await revokeConnectedAppFor(USER, h.store.grants[0]!.id, deps(h));
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(JSON.stringify(result)).not.toMatch(/XX000|revokeUserGrant/);
  });
});

describe("M10-19 revokeAllGrants", () => {
  it("ends every grant and token of the person and nothing of anyone else", async () => {
    const h = harness();
    await connect(h);
    await allow(h, { user: OTHER });
    await revokeAllGrants(USER.id, h.store);
    expect(
      h.store.grants.filter((g) => g.userId === USER.id).every((g) => g.revokedAt !== null),
    ).toBe(true);
    expect(
      h.store.tokens.filter((t) => t.userId === USER.id).every((t) => t.revokedAt !== null),
    ).toBe(true);
    expect(
      h.store.grants.filter((g) => g.userId === OTHER.id).every((g) => g.revokedAt === null),
    ).toBe(true);
  });
});
