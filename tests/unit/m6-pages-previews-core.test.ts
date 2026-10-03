import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M6-09 server half against the local Supabase: the logic behind the preview-link Server Actions.
 * It runs the real core with the secret key and the real `preview_links` table (its trigger, its
 * constraints), with the session, the suspension read and the rate limiter injected.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M6-09 preview links: create, list, turn off (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/previews/core");
  let messages: typeof import("@/lib/previews/messages");
  const owners: TestOwner[] = [];
  let alice: TestOwner;
  let bob: TestOwner;

  const ORIGIN = "http://app.localhost:3000";
  const allowAll = async () => ({ allowed: true, retryAfter: 0 });
  const deps = (over: Partial<import("@/lib/previews/core").PreviewDeps> = {}) => ({
    admin: admin as never,
    isSuspended: async () => false,
    limit: allowAll,
    appOrigin: ORIGIN,
    ...over,
  });
  const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  const linksOf = async (pageId: string) => {
    const { data, error } = await admin.from("preview_links").select("*").eq("page_id", pageId);
    expect(error).toBeNull();
    return data ?? [];
  };
  const tokenOf = (url: string) => url.slice(`${ORIGIN}/share/`.length);

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    core = await import("@/lib/previews/core");
    messages = await import("@/lib/previews/messages");
  });

  // Fresh owners and pages for every test: service_role cannot delete links (the nightly job does),
  // and the cap is per page, so a page of its own keeps each test independent.
  beforeEach(async () => {
    alice = await makeOwner(admin, "pl-a");
    bob = await makeOwner(admin, "pl-b");
    owners.push(alice, bob);
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("create", () => {
    it("no session is unauthorized and creates nothing", async () => {
      const result = await core.createPreviewLinkCore(deps(), null, alice.pageId);
      expect(result).toMatchObject({ ok: false, reason: "unauthorized", status: 401 });
      expect(await linksOf(alice.pageId)).toHaveLength(0);
    });

    it("another account's page, a random page and a malformed id are all not_found and create nothing", async () => {
      for (const pageId of [
        bob.pageId,
        "00000000-0000-4000-8000-0000000000ff",
        "not-a-uuid",
        "",
        "../x",
      ]) {
        const result = await core.createPreviewLinkCore(deps(), alice.userId, pageId);
        expect(result, pageId).toMatchObject({ ok: false, reason: "not_found", status: 404 });
      }
      expect(await core.createPreviewLinkCore(deps(), alice.userId, 42)).toMatchObject({
        ok: false,
        reason: "not_found",
      });
      expect(
        await core.createPreviewLinkCore(deps(), alice.userId, { id: alice.pageId }),
      ).toMatchObject({
        ok: false,
        reason: "not_found",
      });
      expect(await linksOf(alice.pageId)).toHaveLength(0);
      expect(await linksOf(bob.pageId)).toHaveLength(0);
    });

    it("a suspended owner gets account_suspended and nothing is created; the limiter is not touched", async () => {
      const limit = vi.fn(allowAll);
      const result = await core.createPreviewLinkCore(
        deps({ isSuspended: async () => true, limit }),
        alice.userId,
        alice.pageId,
      );
      expect(result).toMatchObject({ ok: false, reason: "account_suspended", status: 403 });
      expect(limit).not.toHaveBeenCalled();
      expect(await linksOf(alice.pageId)).toHaveLength(0);
    });

    it("succeeds with {ok, id, url, expiresAt}: a 43 character base64url token, only its SHA-256 stored", async () => {
      const result = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.url.startsWith(`${ORIGIN}/share/`)).toBe(true);
      const token = tokenOf(result.url);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const rows = await linksOf(alice.pageId);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.id).toBe(result.id);
      expect(row.token_hash).toBe(sha256(token));
      expect(row.token_hash).not.toBe(token);
      // A `select *` of the row has no token column, and no value of it holds the token.
      expect(Object.keys(row).sort()).toEqual(
        ["created_at", "expires_at", "id", "page_id", "revoked_at", "token_hash"].sort(),
      );
      expect(JSON.stringify(row)).not.toContain(token);
      expect(row.revoked_at).toBeNull();
    });

    it("expires_at comes from the database default: 7 days after creation, not the caller's", async () => {
      const result = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = (await linksOf(alice.pageId))[0]!;
      const span = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime();
      expect(span).toBe(7 * 24 * 3600 * 1000);
      expect(result.expiresAt).toBe(row.expires_at);
      expect(
        Math.abs(new Date(row.expires_at).getTime() - (Date.now() + 7 * 24 * 3600 * 1000)),
      ).toBeLessThan(5 * 60 * 1000);
    });

    it("every token is different and uses the CSPRNG shape", async () => {
      const urls = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const result = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
        expect(result.ok).toBe(true);
        if (result.ok) urls.add(result.url);
      }
      expect(urls.size).toBe(4);
    });

    it("Free, Pro and Studio accounts can all create links (no plan check)", async () => {
      const { makeOwner: make } = await import("./publish-support");
      for (const plan of ["free", "pro", "studio"] as const) {
        const owner = await make(admin, `pl-${plan}`, undefined, plan);
        owners.push(owner);
        const result = await core.createPreviewLinkCore(deps(), owner.userId, owner.pageId);
        expect(result.ok, plan).toBe(true);
      }
    });

    it("never logs the token, the address or the hash", async () => {
      const spies = [
        vi.spyOn(console, "log").mockImplementation(() => undefined),
        vi.spyOn(console, "error").mockImplementation(() => undefined),
        vi.spyOn(console, "warn").mockImplementation(() => undefined),
        vi.spyOn(console, "info").mockImplementation(() => undefined),
      ];
      const result = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const token = tokenOf(result.url);
      // And a failing create (the database refuses a hash that is already taken).
      const rows = await linksOf(alice.pageId);
      await core.createPreviewLinkCore(deps({ newToken: () => token }), alice.userId, alice.pageId);
      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(rows[0]!.token_hash);
      expect(logged).not.toContain(result.url);
    });
  });

  describe("limits on write", () => {
    it("at five active links the sixth is preview_link_limit with the plain message, and nothing is created", async () => {
      for (let i = 0; i < 5; i++) {
        expect((await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId)).ok).toBe(
          true,
        );
      }
      const sixth = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      expect(sixth).toMatchObject({
        ok: false,
        reason: "preview_link_limit",
        message: "You have 5 active preview links. Turn one off to make another.",
      });
      expect(await linksOf(alice.pageId)).toHaveLength(5);
      // Another page of the same account has its own five.
      expect((await core.createPreviewLinkCore(deps(), bob.userId, bob.pageId)).ok).toBe(true);
    });

    it("turning a link off frees its slot; so does an expired link", async () => {
      const made = [];
      for (let i = 0; i < 5; i++) {
        const result = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
        if (result.ok) made.push(result);
      }
      expect(made).toHaveLength(5);
      expect(await core.revokePreviewLinkCore(deps(), alice.userId, made[0]!.id)).toEqual({
        ok: true,
      });
      expect((await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId)).ok).toBe(true);
      expect(await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId)).toMatchObject({
        reason: "preview_link_limit",
      });
      // The database clock decides: move one link's whole lifetime into the past.
      const now = Date.now();
      const { error } = await admin
        .from("preview_links")
        .update({
          created_at: new Date(now - 9 * 24 * 3600 * 1000).toISOString(),
          expires_at: new Date(now - 3 * 24 * 3600 * 1000).toISOString(),
        })
        .eq("id", made[1]!.id);
      expect(error).toBeNull();
      expect((await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId)).ok).toBe(true);
    });

    it("two simultaneous creates at 4 of 5 yield exactly one new row", async () => {
      for (let i = 0; i < 4; i++) {
        expect((await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId)).ok).toBe(
          true,
        );
      }
      const results = await Promise.all([
        core.createPreviewLinkCore(deps(), alice.userId, alice.pageId),
        core.createPreviewLinkCore(deps(), alice.userId, alice.pageId),
        core.createPreviewLinkCore(deps(), alice.userId, alice.pageId),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(
        results.filter((result) => !result.ok && result.reason === "preview_link_limit"),
      ).toHaveLength(2);
      expect(await linksOf(alice.pageId)).toHaveLength(5);
    });

    it("the limiter is rateLimit('preview-link:{userId}', 20, 3600); over it is 429 rate_limited and nothing is created", async () => {
      const limit = vi.fn(async () => ({ allowed: false, retryAfter: 30 }));
      const result = await core.createPreviewLinkCore(deps({ limit }), alice.userId, alice.pageId);
      expect(limit).toHaveBeenCalledWith(`preview-link:${alice.userId}`, 20, 3600);
      expect(result).toMatchObject({
        ok: false,
        reason: "rate_limited",
        status: 429,
        message: "You’ve created a lot of links. Try again in a while.",
      });
      expect(await linksOf(alice.pageId)).toHaveLength(0);
    });

    it("a different user is unaffected by another user's limit", async () => {
      const seen = new Map<string, number>();
      const limit = async (key: string, max: number) => {
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        return { allowed: count <= max, retryAfter: 1 };
      };
      for (let i = 0; i < 20; i++) {
        const result = await core.createPreviewLinkCore(
          deps({ limit }),
          alice.userId,
          alice.pageId,
        );
        // Keep the page under its own cap while the hourly count climbs.
        if (result.ok) {
          await admin
            .from("preview_links")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", result.id);
        }
      }
      const twenty1st = await core.createPreviewLinkCore(
        deps({ limit }),
        alice.userId,
        alice.pageId,
      );
      expect(twenty1st).toMatchObject({ ok: false, reason: "rate_limited", status: 429 });
      const other = await core.createPreviewLinkCore(deps({ limit }), bob.userId, bob.pageId);
      expect(other.ok).toBe(true);
    });

    it("a failing database is `failed` with the generic message, never an exception or a leak", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const broken = {
        from: () => {
          throw new Error("connection refused");
        },
      };
      const result = await core.createPreviewLinkCore(
        deps({ admin: broken as never }),
        alice.userId,
        alice.pageId,
      );
      expect(result).toMatchObject({
        ok: false,
        reason: "failed",
        status: 500,
        message: "Couldn’t create the link. Try again.",
      });
    });
  });

  describe("list", () => {
    it("returns the owner's active links newest first as {id, createdAt, expiresAt}, never a token or a hash", async () => {
      const a = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const b = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      const listed = await core.listPreviewLinksCore(deps(), alice.userId, alice.pageId);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.links.map((link) => link.id)).toEqual([b.id, a.id]);
      for (const link of listed.links) {
        expect(Object.keys(link).sort()).toEqual(["createdAt", "expiresAt", "id"]);
      }
      const json = JSON.stringify(listed);
      expect(json).not.toContain(tokenOf(a.url));
      expect(json).not.toContain(sha256(tokenOf(a.url)));
      expect(json).not.toContain(tokenOf(b.url));
    });

    it("leaves out turned off and expired links", async () => {
      const keep = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      const off = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      const old = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      if (!keep.ok || !off.ok || !old.ok) throw new Error("setup failed");
      await core.revokePreviewLinkCore(deps(), alice.userId, off.id);
      const now = Date.now();
      const moved = await admin
        .from("preview_links")
        .update({
          created_at: new Date(now - 9 * 24 * 3600 * 1000).toISOString(),
          expires_at: new Date(now - 3 * 24 * 3600 * 1000).toISOString(),
        })
        .eq("id", old.id);
      expect(moved.error).toBeNull();
      const listed = await core.listPreviewLinksCore(deps(), alice.userId, alice.pageId);
      expect(listed.ok && listed.links.map((link) => link.id)).toEqual([keep.id]);
    });

    it("another account's page is not_found, no session is unauthorized, a suspended owner can still read", async () => {
      await core.createPreviewLinkCore(deps(), bob.userId, bob.pageId);
      expect(await core.listPreviewLinksCore(deps(), alice.userId, bob.pageId)).toMatchObject({
        ok: false,
        reason: "not_found",
      });
      expect(await core.listPreviewLinksCore(deps(), null, alice.pageId)).toMatchObject({
        ok: false,
        reason: "unauthorized",
      });
      expect(await core.listPreviewLinksCore(deps(), alice.userId, "nope")).toMatchObject({
        ok: false,
        reason: "not_found",
      });
      const suspendedRead = await core.listPreviewLinksCore(
        deps({ isSuspended: async () => true }),
        alice.userId,
        alice.pageId,
      );
      expect(suspendedRead.ok).toBe(true);
    });
  });

  describe("turn off", () => {
    it("sets revoked_at on an active link of the caller's page, and repeating it is safe", async () => {
      const made = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      if (!made.ok) throw new Error("setup failed");
      expect(await core.revokePreviewLinkCore(deps(), alice.userId, made.id)).toEqual({ ok: true });
      const first = (await linksOf(alice.pageId))[0]!;
      expect(first.revoked_at).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(await core.revokePreviewLinkCore(deps(), alice.userId, made.id)).toEqual({ ok: true });
      expect((await linksOf(alice.pageId))[0]!.revoked_at).toBe(first.revoked_at);
    });

    it("another account's link, a random uuid and a malformed id are not_found and change nothing", async () => {
      const mine = await core.createPreviewLinkCore(deps(), bob.userId, bob.pageId);
      if (!mine.ok) throw new Error("setup failed");
      for (const id of [mine.id, "00000000-0000-4000-8000-0000000000fe", "x", "", "../y"]) {
        expect(await core.revokePreviewLinkCore(deps(), alice.userId, id), id).toMatchObject({
          ok: false,
          reason: "not_found",
        });
      }
      expect(await core.revokePreviewLinkCore(deps(), alice.userId, 7)).toMatchObject({
        reason: "not_found",
      });
      expect((await linksOf(bob.pageId))[0]!.revoked_at).toBeNull();
    });

    it("no session is unauthorized; a suspended owner may still turn a link off", async () => {
      const made = await core.createPreviewLinkCore(deps(), alice.userId, alice.pageId);
      if (!made.ok) throw new Error("setup failed");
      expect(await core.revokePreviewLinkCore(deps(), null, made.id)).toMatchObject({
        reason: "unauthorized",
      });
      expect(
        await core.revokePreviewLinkCore(
          deps({ isSuspended: async () => true }),
          alice.userId,
          made.id,
        ),
      ).toEqual({ ok: true });
    });
  });

  it("the refusal messages are the plain sentences of the dialog", () => {
    expect(messages.PREVIEW_LINK_MESSAGES.preview_link_limit).toBe(
      "You have 5 active preview links. Turn one off to make another.",
    );
    expect(messages.PREVIEW_LINK_MESSAGES.rate_limited).toBe(
      "You’ve created a lot of links. Try again in a while.",
    );
    expect(messages.PREVIEW_LINK_MESSAGES.unauthorized).toBe(
      "You’re signed out. Sign in again, then try again.",
    );
    expect(messages.PREVIEW_LINK_MESSAGES.failed).toBe("Couldn’t create the link. Try again.");
    for (const text of Object.values(messages.PREVIEW_LINK_MESSAGES)) {
      expect(text).not.toMatch(/!|please|successfully/i);
    }
  });
});
