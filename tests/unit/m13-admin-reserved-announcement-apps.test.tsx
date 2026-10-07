import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addReservedHandleAction,
  blockAppAction,
  clearAnnouncementAction,
  removeReservedHandleAction,
  setAnnouncementAction,
  unblockAppAction,
} from "@/lib/admin/actions";
import { executeAdminAction } from "@/lib/admin/execute";
import type { Principal } from "@/lib/admin/principal";
import type { AdminAction, AdminDeps } from "@/lib/admin/types";
import { AnnouncementBannerView } from "@/components/app/announcement-banner-view";
import { dismiss, isDismissed } from "@/lib/announcements/dismissal";
import { isActiveAt, validateAnnouncement } from "@/lib/announcements/rules";
import { makeOwner, rand, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M13-08 (reserved handles), M13-09 (the announcement) and M13-10 (revoke and restore an app): the
 * admin actions with the secret-key client against the local Supabase stack, and the pure rules (the
 * announcement's time window, escaping and per-browser dismissal) with no stack at all. The guard
 * (401 and 403 before anything runs) is in admin-actions-guard.test.ts, which walks the registry.
 */

const { run } = await stackIsUp();

const ADMIN_ID = "11111111-2222-4333-8444-555555555555";
const ADMIN: Principal = { kind: "user", id: ADMIN_ID, email: "admin@example.test", admin: true };

describe("M13-09 the announcement rules", () => {
  const NOW = new Date("2026-10-06T12:00:00Z");
  const ok = (over: Record<string, unknown> = {}) =>
    validateAnnouncement(
      { message: "Maintenance tonight", ends_at: "2026-10-07T12:00:00Z", ...over },
      NOW,
    );

  it("accepts a message, trims it, and keeps a blank start as null (now)", () => {
    expect(ok({ message: "  Hello  " })).toMatchObject({
      ok: true,
      value: { message: "Hello", link: null, startsAt: null, endsAt: "2026-10-07T12:00:00.000Z" },
    });
  });

  it.each([
    ["an empty message", { message: "   " }],
    ["201 characters", { message: "x".repeat(201) }],
    ["a control character", { message: "a\nb" }],
    ["an http link", { link: "http://example.com" }],
    ["a javascript link", { link: "javascript:alert(1)" }],
    ["a link with a space", { link: "https://exa mple.com" }],
    ["a link with credentials", { link: "https://u:p@example.com" }],
    ["an end in the past", { ends_at: "2026-10-06T11:00:00Z" }],
    ["an end before the start", { starts_at: "2026-10-08T00:00:00Z" }],
    ["an end that is not a time", { ends_at: "tomorrow" }],
    ["a start that is not a time", { starts_at: "soon" }],
  ])("refuses %s", (_name, over) => {
    expect(ok(over)).toMatchObject({ ok: false });
  });

  it("accepts exactly 200 characters and an https link", () => {
    expect(ok({ message: "x".repeat(200), link: "https://example.com/news" })).toMatchObject({
      ok: true,
      value: { link: "https://example.com/news" },
    });
  });

  it("the window is start inclusive, end exclusive", () => {
    const window = { starts_at: "2026-10-06T12:00:00Z", ends_at: "2026-10-06T13:00:00Z" };
    const at = (iso: string) => isActiveAt(window, Date.parse(iso));
    expect(at("2026-10-06T11:59:59Z")).toBe(false);
    expect(at("2026-10-06T12:00:00Z")).toBe(true);
    expect(at("2026-10-06T12:59:59Z")).toBe(true);
    expect(at("2026-10-06T13:00:00Z")).toBe(false);
  });
});

describe("M13-09 escaping and dismissal", () => {
  const announcement = {
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    message: '<img src=x onerror="alert(1)"> & <script>alert(2)</script>',
    link: "https://example.com/?a=1&b=<2>",
    startsAt: "2026-10-06T12:00:00Z",
    endsAt: "2099-01-01T00:00:00Z",
  };

  it("draws the message as text, never as HTML, and the link as an https anchor", () => {
    const html = renderToStaticMarkup(<AnnouncementBannerView announcement={announcement} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&lt;2&gt;"');
  });

  it("never draws a link that is not https", () => {
    const html = renderToStaticMarkup(
      <AnnouncementBannerView announcement={{ ...announcement, link: "javascript:alert(1)" }} />,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });

  it("dismissal is keyed by the announcement id, so a new message shows again", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(isDismissed("one", storage)).toBe(false);
    dismiss("one", storage);
    expect(isDismissed("one", storage)).toBe(true);
    expect(isDismissed("two", storage)).toBe(false);
  });

  it("storage that is missing or throws never breaks the banner", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(isDismissed("one", broken)).toBe(false);
    expect(() => dismiss("one", broken)).not.toThrow();
    expect(isDismissed("one", null)).toBe(false);
    expect(() => dismiss("one", null)).not.toThrow();
  });
});

describe.skipIf(!run)("M13-08 to M13-10 admin actions (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];
  const reserved: string[] = [];
  const clients: string[] = [];

  const deps = (): AdminDeps => ({
    db: admin as never,
    invalidateAccount: async () => 0,
    invalidateHandles: () => undefined,
    isProtectedAccount: async () => false,
    now: () => new Date(),
  });
  const call = (action: AdminAction, input: unknown) =>
    executeAdminAction(action, ADMIN, input, deps);

  const audit = async (action: string, key: string, value: string) =>
    (
      await admin
        .from("admin_audit")
        .select("admin_id, action, detail")
        .eq("action", action)
        .eq(`detail->>${key}`, value)
        .order("id")
    ).data ?? [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  afterAll(async () => {
    // The audit log is append-only: its rows stay. The rest is put back.
    await admin.from("announcements").delete().gte("ends_at", "1970-01-01");
    for (const handle of reserved)
      await admin.rpc("admin_remove_reserved_handle", { p_handle: handle });
    // Restoring clears the return hosts a block recorded (oauth_blocked_hosts has no other way out).
    for (const id of clients) await admin.rpc("admin_unblock_oauth_client", { p_client_id: id });
    for (const id of clients) await admin.from("oauth_clients").delete().eq("client_id", id);
    await removeOwners(admin, owners);
  });

  const freshHandle = () => {
    const handle = `zq-rsv-${rand(8)}`.slice(0, 28);
    reserved.push(handle);
    return handle;
  };

  describe("reserved handles", () => {
    it("adds a handle: kind admin, who added it, one audit row; a second add is a 409 that writes nothing", async () => {
      const handle = freshHandle();
      const first = await call(addReservedHandleAction, {
        handle: ` ${handle.toUpperCase()} `,
        reason: "brand",
      });
      expect(first).toMatchObject({
        ok: true,
        status: 200,
        data: { changed: true, handle, holder: null },
      });
      const stored = await admin.from("reserved_handles").select("*").eq("handle", handle).single();
      expect(stored.data).toMatchObject({ kind: "admin", added_by: ADMIN_ID, reason: "brand" });
      expect(await audit("reserve_handle", "handle", handle)).toHaveLength(1);

      const second = await call(addReservedHandleAction, { handle, reason: "again" });
      expect(second).toMatchObject({ ok: false, status: 409, error: "already_reserved" });
      expect(await audit("reserve_handle", "handle", handle)).toHaveLength(1);
    });

    it.each([
      ["too short", { handle: "ab" }],
      ["a leading hyphen", { handle: "-abc" }],
      ["upper-case symbols", { handle: "a b c" }],
      ["31 characters", { handle: "a".repeat(31) }],
      ["a reason over 200 characters", { handle: "zq-longreason", reason: "x".repeat(201) }],
    ])("refuses %s with a 400 and reserves nothing", async (_name, input) => {
      const before = (
        await admin.from("reserved_handles").select("handle", { count: "exact", head: true })
      ).count;
      expect(await call(addReservedHandleAction, input)).toMatchObject({ ok: false, status: 400 });
      const after = (
        await admin.from("reserved_handles").select("handle", { count: "exact", head: true })
      ).count;
      expect(after).toBe(before);
    });

    it("a handle someone already holds: reserved, the holder is named, and the page is untouched", async () => {
      const owner = await makeOwner(admin, "rsvheld");
      owners.push(owner);
      reserved.push(owner.handle);
      const result = await call(addReservedHandleAction, { handle: owner.handle, reason: "brand" });
      expect(result).toMatchObject({
        ok: true,
        data: { changed: true, holder: { pageId: owner.pageId, email: owner.email } },
      });
      const page = await admin
        .from("pages")
        .select("handle, owner_id")
        .eq("id", owner.pageId)
        .single();
      expect(page.data).toEqual({ handle: owner.handle, owner_id: owner.userId });
    });

    it("a reserved handle is refused for a new page and for a rename (the signup rule)", async () => {
      const handle = freshHandle();
      await call(addReservedHandleAction, { handle, reason: "brand" });
      const owner = await makeOwner(admin, "rsvnew");
      owners.push(owner);
      const rename = await admin.from("pages").update({ handle }).eq("id", owner.pageId);
      expect(rename.error?.message ?? "").toMatch(/reserved|HL004/i);
      const insert = await admin
        .from("pages")
        .insert({ owner_id: owner.userId, handle, draft: { version: 1 } });
      expect(insert.error).not.toBeNull();
    });

    it("removes one added handle with one audit row; removing again is changed false and writes nothing", async () => {
      const handle = freshHandle();
      await call(addReservedHandleAction, { handle, reason: "brand" });
      const gone = await call(removeReservedHandleAction, { handle });
      expect(gone).toMatchObject({ ok: true, data: { changed: true, handle } });
      expect(
        (await admin.from("reserved_handles").select("handle").eq("handle", handle)).data,
      ).toEqual([]);
      expect(await audit("unreserve_handle", "handle", handle)).toHaveLength(1);
      const again = await call(removeReservedHandleAction, { handle });
      expect(again).toMatchObject({ ok: true, data: { changed: false } });
      expect(await audit("unreserve_handle", "handle", handle)).toHaveLength(1);
    });

    it("a platform name is locked: 409, still reserved, nothing audited", async () => {
      const before = await audit("unreserve_handle", "handle", "www");
      const result = await call(removeReservedHandleAction, { handle: "www" });
      expect(result).toMatchObject({ ok: false, status: 409, error: "locked" });
      expect(
        (await admin.from("reserved_handles").select("kind").eq("handle", "www").single()).data,
      ).toEqual({ kind: "system" });
      expect(await audit("unreserve_handle", "handle", "www")).toHaveLength(before.length);
    });

    it("a retry writes the audit row an earlier call died before writing", async () => {
      const handle = freshHandle();
      // The state changed (the entry exists, with its author) but no audit row was ever written.
      await admin.rpc("admin_add_reserved_handle", {
        p_handle: handle,
        p_reason: "lost",
        p_admin: ADMIN_ID,
      });
      const retry = await call(addReservedHandleAction, { handle, reason: "again" });
      expect(retry).toMatchObject({ ok: false, status: 409 });
      const rows = await audit("reserve_handle", "handle", handle);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        admin_id: ADMIN_ID,
        detail: { retried: true, reason: "lost" },
      });
      // And a third call, which finds the row there, writes nothing.
      await call(addReservedHandleAction, { handle, reason: "again" });
      expect(await audit("reserve_handle", "handle", handle)).toHaveLength(1);
    });
  });

  describe("announcement", () => {
    const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

    it("sets one message with a window, writes an audit row, and a new one replaces it", async () => {
      const first = await call(setAnnouncementAction, {
        message: "First <b>message</b>",
        link: "https://example.com/a",
        ends_at: future(2),
      });
      expect(first).toMatchObject({ ok: true, data: { changed: true, id: expect.any(String) } });
      const id = (first as unknown as { data: { id: string } }).data.id;
      const row = await admin.from("announcements").select("*").eq("id", id).single();
      expect(row.data).toMatchObject({
        message: "First <b>message</b>",
        link: "https://example.com/a",
        created_by: ADMIN_ID,
      });
      expect(await audit("set_announcement", "id", id)).toHaveLength(1);

      const second = await call(setAnnouncementAction, { message: "Second", ends_at: future(3) });
      expect(second).toMatchObject({ ok: true });
      const active = await admin
        .from("announcements")
        .select("id, message, ends_at")
        .gt("ends_at", new Date().toISOString());
      expect(active.data).toHaveLength(1);
      expect(active.data![0]!.message).toBe("Second");
    });

    it("a clear that died before its audit row is repaired by the retry, once", async () => {
      const set = await call(setAnnouncementAction, {
        message: "Half cleared",
        ends_at: future(2),
      });
      const id = (set as unknown as { data: { id: string } }).data.id;
      // The earlier call: the announcement ended, the audit row never written.
      expect((await admin.rpc("admin_clear_announcement")).error).toBeNull();
      expect(await audit("clear_announcement", "id", id)).toHaveLength(0);

      expect(await call(clearAnnouncementAction, { id })).toMatchObject({
        ok: true,
        data: { changed: false },
      });
      const rows = await audit("clear_announcement", "id", id);
      expect(rows).toHaveLength(1);
      expect(await call(clearAnnouncementAction, { id })).toMatchObject({ ok: true });
      expect(await audit("clear_announcement", "id", id)).toHaveLength(1);
    });

    it.each([
      ["no message", { message: "", ends_at: "2099-01-01T00:00:00Z" }],
      [
        "a message over 200 characters",
        { message: "x".repeat(201), ends_at: "2099-01-01T00:00:00Z" },
      ],
      [
        "an http link",
        { message: "Hi", link: "http://example.com", ends_at: "2099-01-01T00:00:00Z" },
      ],
      ["an end in the past", { message: "Hi", ends_at: "2020-01-01T00:00:00Z" }],
    ])("refuses %s with a 400 and changes nothing", async (_name, input) => {
      const before = (
        await admin.from("announcements").select("id", { count: "exact", head: true })
      ).count;
      expect(await call(setAnnouncementAction, input)).toMatchObject({ ok: false, status: 400 });
      expect(
        (await admin.from("announcements").select("id", { count: "exact", head: true })).count,
      ).toBe(before);
    });

    it("clears the announcement, audits it, and clearing again is changed false", async () => {
      const set = await call(setAnnouncementAction, { message: "To clear", ends_at: future(2) });
      const id = (set as unknown as { data: { id: string } }).data.id;
      expect(await call(clearAnnouncementAction, { id })).toMatchObject({
        ok: true,
        data: { changed: true },
      });
      expect(
        (await admin.from("announcements").select("id").gt("ends_at", new Date().toISOString()))
          .data,
      ).toEqual([]);
      expect(await audit("clear_announcement", "id", id)).toHaveLength(1);
      expect(await call(clearAnnouncementAction, { id })).toMatchObject({
        ok: true,
        data: { changed: false },
      });
      expect(await audit("clear_announcement", "id", id)).toHaveLength(1);
      expect(
        await call(clearAnnouncementAction, { id: "00000000-0000-4000-8000-00000000dead" }),
      ).toMatchObject({ ok: false, status: 404 });
    });
  });

  describe("connected apps", () => {
    async function newClient() {
      const id = `hlc_${Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
      clients.push(id);
      const inserted = await admin.from("oauth_clients").insert({
        client_id: id,
        kind: "dcr",
        client_name: "Blockable",
        redirect_uris: ["https://a.example/cb"],
      });
      expect(inserted.error).toBeNull();
      return id;
    }
    const blockedAt = async (id: string) =>
      (
        await admin
          .from("oauth_clients")
          .select("blocked_at, blocked_by, blocked_reason")
          .eq("client_id", id)
          .single()
      ).data;

    it("revokes an app for everyone (needs a reason), audits it once, and a second revoke changes nothing", async () => {
      const id = await newClient();
      expect(await call(blockAppAction, { client_id: id, reason: "  " })).toMatchObject({
        ok: false,
        status: 400,
      });
      expect(await call(blockAppAction, { client_id: id, reason: "x".repeat(501) })).toMatchObject({
        ok: false,
        status: 400,
      });
      expect((await blockedAt(id))?.blocked_at).toBeNull();

      const result = await call(blockAppAction, { client_id: id, reason: "abuse" });
      expect(result).toMatchObject({ ok: true, data: { changed: true } });
      expect(await blockedAt(id)).toMatchObject({ blocked_by: ADMIN_ID, blocked_reason: "abuse" });
      expect((await blockedAt(id))?.blocked_at).not.toBeNull();
      expect(await audit("block_app", "client_id", id)).toHaveLength(1);

      expect(await call(blockAppAction, { client_id: id, reason: "again" })).toMatchObject({
        ok: true,
        data: { changed: false },
      });
      expect(await audit("block_app", "client_id", id)).toHaveLength(1);
    });

    it("remembers the return hosts of a blocked app (never loopback, never claude.ai) until it is restored", async () => {
      const host = `zq-${rand(8)}.example.test`;
      const id = await newClient();
      const set = await admin
        .from("oauth_clients")
        .update({
          redirect_uris: [`https://${host}/cb`, "http://localhost:8123/cb", "https://claude.ai/x"],
        })
        .eq("client_id", id);
      expect(set.error).toBeNull();
      const hostBlocked = async (h: string) =>
        (await admin.rpc("oauth_host_blocked", { p_hosts: [h] })).data;

      expect(await hostBlocked(host)).toBe(false);
      await call(blockAppAction, { client_id: id, reason: "abuse" });
      expect(await hostBlocked(host)).toBe(true);
      expect(await hostBlocked(host.toUpperCase())).toBe(true);
      expect(await hostBlocked("claude.ai")).toBe(false);
      expect(await hostBlocked("localhost")).toBe(false);

      await call(unblockAppAction, { client_id: id });
      expect(await hostBlocked(host)).toBe(false);
    });

    it("restores it: blocked_at cleared, one audit row, and restoring again changes nothing", async () => {
      const id = await newClient();
      await call(blockAppAction, { client_id: id, reason: "abuse" });
      expect(await call(unblockAppAction, { client_id: id })).toMatchObject({
        ok: true,
        data: { changed: true },
      });
      expect((await blockedAt(id))?.blocked_at).toBeNull();
      expect(await audit("unblock_app", "client_id", id)).toHaveLength(1);
      expect(await call(unblockAppAction, { client_id: id })).toMatchObject({
        ok: true,
        data: { changed: false },
      });
      expect(await audit("unblock_app", "client_id", id)).toHaveLength(1);
    });

    it("an app that does not exist is a 404 for both actions", async () => {
      const missing = `hlc_${"f".repeat(32)}`;
      expect(await call(blockAppAction, { client_id: missing, reason: "abuse" })).toMatchObject({
        ok: false,
        status: 404,
      });
      expect(await call(unblockAppAction, { client_id: missing })).toMatchObject({
        ok: false,
        status: 404,
      });
    });

    it("a retry writes the audit row of a block whose first call died before writing it", async () => {
      const id = await newClient();
      // The block is in place (as admin_block_oauth_client leaves it) with no audit row.
      await admin
        .from("oauth_clients")
        .update({
          blocked_at: new Date().toISOString(),
          blocked_by: ADMIN_ID,
          blocked_reason: "lost",
        })
        .eq("client_id", id);
      expect(await call(blockAppAction, { client_id: id, reason: "lost" })).toMatchObject({
        ok: true,
        data: { changed: false },
      });
      const rows = await audit("block_app", "client_id", id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.detail).toMatchObject({ retried: true });
    });
  });
});
