import { describe, expect, it, vi } from "vitest";
import { registerClient, REGISTER_MAX_BODY_BYTES } from "@/lib/oauth/register";
import { hostsToBlock, protectedHosts, redirectHosts } from "@/lib/oauth/blocked-hosts";
import { KNOWN_CLIENT_IDS, VENDORS } from "@/lib/oauth/known-clients";
import {
  CLAUDE_ID,
  CLAUDE_REDIRECT,
  DCR_ID,
  REDIRECT,
  USER,
  addClaude,
  authorizeQuery,
  harness,
  pkce,
} from "./helpers/oauth-flow";
import { FakeOauthStore, openLimiter } from "./helpers/oauth-fake-store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("@/lib/oauth/config", () => ({ oauthConfig: () => ({ rootDomain: "hydlnk.com" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

/**
 * Wave N security review, finding 1: a blocked app cannot come back under a new id. Blocking records
 * the app's non-loopback return hosts (the pgTAP file 187 proves the table and the functions); the
 * register and authorize endpoints refuse a return address on one. The in-memory store mirrors the SQL.
 */

const register = (store: FakeOauthStore, redirectUris: string[], name = "Some app") =>
  registerClient(
    {
      clientKey: "203.0.113.9",
      mediaType: "application/json",
      readBody: async () => {
        const text = JSON.stringify({ redirect_uris: redirectUris, client_name: name });
        return new TextEncoder().encode(text).length > REGISTER_MAX_BODY_BYTES
          ? { ok: false as const, reason: "too_large" as const }
          : { ok: true as const, text };
      },
    },
    { store, limit: openLimiter().limit, now: () => store.clock },
  );

describe("the hosts a block records", () => {
  it("are the lower-case https hosts, without loopback and without repeats", () => {
    expect(
      redirectHosts([
        "https://Evil.Example.test/cb",
        "https://evil.example.test/other",
        "http://localhost:8123/cb",
        "http://127.0.0.1:1/cb",
        "http://[::1]:2/cb",
        "not a uri",
      ]),
    ).toEqual(["evil.example.test"]);
  });

  it("never include a host of a known client or a vendor, nor a subdomain of one", () => {
    const guard = protectedHosts();
    for (const vendor of VENDORS) for (const host of vendor.hosts) expect(guard).toContain(host);
    for (const id of KNOWN_CLIENT_IDS) expect(guard).toContain(new URL(id).hostname);
    expect(
      hostsToBlock([
        CLAUDE_REDIRECT,
        "https://claude.ai/x",
        "https://www.claude.ai/x",
        "https://chatgpt.com/x",
        "https://evilclaude.ai/x",
        "https://mine.example.test/x",
      ]),
    ).toEqual(["evilclaude.ai", "mine.example.test"]);
  });

  it("a loopback-only app records none (it can be blocked by id only)", () => {
    expect(hostsToBlock(["http://localhost:9/cb", "http://127.0.0.1:9/cb"])).toEqual([]);
  });
});

describe("a blocked app cannot come back under a new id", () => {
  it("register refuses a return address on a blocked host, whatever its case, and accepts others", async () => {
    const store = new FakeOauthStore();
    store.addClient(DCR_ID, ["https://Evil.Example.test/cb", "http://localhost:8123/cb"]);
    store.blockClient(DCR_ID);
    expect([...store.blockedHosts.keys()]).toEqual(["evil.example.test"]);

    const again = await register(store, ["https://evil.example.test/cb"]);
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ error: "invalid_redirect_uri" });
    const mixed = await register(store, [
      "https://fine.example.test/cb",
      "https://EVIL.example.TEST/other",
    ]);
    expect(mixed.status).toBe(400);
    expect(store.calls.insertDcrClient ?? 0).toBe(0);

    const fine = await register(store, ["https://fine.example.test/cb"]);
    expect(fine.status).toBe(201);
    // A loopback return address is never refused: it has no host.
    const loopback = await register(store, ["http://localhost:8123/cb"]);
    expect(loopback.status).toBe(201);
  });

  it("register fails closed when the blocked-host table cannot be read", async () => {
    const store = new FakeOauthStore();
    store.anyHostBlocked = async () => {
      throw new Error("[oauth] anyHostBlocked failed (XX000)");
    };
    const out = await register(store, ["https://fine.example.test/cb"]);
    expect(out.status).toBe(500);
    expect(store.calls.insertDcrClient ?? 0).toBe(0);
  });

  it("authorize refuses a stored client that returns to a blocked host (a new id, an old row), as the blocked page", async () => {
    const h = harness({ clientUris: ["https://evil.example.test/cb"] });
    h.store.blockClient(DCR_ID);
    const sibling = `hlc_${"b".repeat(32)}`;
    h.store.addClient(sibling, ["https://evil.example.test/cb"]);
    const out = await h.authorize(
      authorizeQuery(
        { client_id: sibling, redirect_uri: "https://evil.example.test/cb" },
        pkce().challenge,
      ),
      { user: USER },
    );
    expect(out).toEqual({ kind: "error_page", status: 400, errorClass: "app_blocked" });
    expect(h.store.requests.size).toBe(0);
  });

  it("authorize still serves an app on another host", async () => {
    const h = harness({ clientUris: ["https://evil.example.test/cb"] });
    h.store.blockClient(DCR_ID);
    const fine = `hlc_${"c".repeat(32)}`;
    h.store.addClient(fine, [REDIRECT]);
    const out = await h.authorize(
      authorizeQuery({ client_id: fine, redirect_uri: REDIRECT }, pkce().challenge),
      { user: USER },
    );
    expect(out).not.toMatchObject({ errorClass: "app_blocked" });
  });

  it("blocking a known client never records claude.ai, and Claude is never checked", async () => {
    const h = harness();
    addClaude(h);
    h.store.blockClient(CLAUDE_ID);
    expect(h.store.blockedHosts.size).toBe(0);
    // Even a damaged table cannot lock Claude out: authorize skips the host check for a known client.
    h.store.blockedHosts.set("claude.ai", "hlc_x");
    const out = await h.authorize(
      authorizeQuery({ client_id: CLAUDE_ID, redirect_uri: CLAUDE_REDIRECT }, pkce().challenge),
      { user: USER },
    );
    // (the known client is itself blocked here: the first rule still wins)
    expect(out).toMatchObject({ errorClass: "app_blocked" });
    h.store.unblockClient(CLAUDE_ID);
    const ok = await h.authorize(
      authorizeQuery({ client_id: CLAUDE_ID, redirect_uri: CLAUDE_REDIRECT }, pkce().challenge),
      { user: USER },
    );
    expect(ok).not.toMatchObject({ errorClass: "app_blocked" });
  });

  it("unblocking clears the hosts it recorded and the return address is allowed again", async () => {
    const store = new FakeOauthStore();
    store.addClient(DCR_ID, ["https://evil.example.test/cb"]);
    store.blockClient(DCR_ID);
    expect((await register(store, ["https://evil.example.test/cb"])).status).toBe(400);
    store.unblockClient(DCR_ID);
    expect(store.blockedHosts.size).toBe(0);
    expect((await register(store, ["https://evil.example.test/cb"])).status).toBe(201);
  });
});
