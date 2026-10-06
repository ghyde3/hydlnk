import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptySubPageDraft } from "@/lib/document";
import { draftOf, makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => undefined }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M13-02, M13-05 and M13-11 against the local Supabase: the account read (one query path, any id is
 * just another account), the audit log read (newest first, filtered, read only), the draft view's
 * loader (the share renderer's own data, no writes) and the one audit write, `logDraftView`.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("admin account, audit and draft view reads (local Supabase)", () => {
  let admin: SupabaseClient;
  let accounts: typeof import("@/lib/admin/account-queries");
  let drafts: typeof import("@/lib/admin/draft-view");
  const owners: TestOwner[] = [];
  const auditIds: number[] = [];
  const fakeAdminId = "99999999-8888-4777-8666-555555555555";

  const owner = async (label: string, plan: "free" | "pro" | "studio" = "free") => {
    const made = await makeOwner(admin, label, (handle) => draftOf(`Draft ${handle}`), plan);
    owners.push(made);
    return made;
  };
  const auditRows = async (accountId: string, action?: string) => {
    let query = admin
      .from("admin_audit")
      .select("id, action, detail, admin_id")
      .eq("account_id", accountId);
    if (action) query = query.eq("action", action);
    const { data, error } = await query.order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    accounts = await import("@/lib/admin/account-queries");
    drafts = await import("@/lib/admin/draft-view");
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("getAccountDetail: the account's facts, its site, and nothing of another account", async () => {
    const a = await owner("acc-a", "pro");
    const b = await owner("acc-b");
    await admin
      .from("domains")
      .insert({ page_id: a.pageId, hostname: `a-${a.handle}.example.test`, status: "pending" });

    const detail = await accounts.getAccountDetail(a.userId, admin as never);
    expect(detail).not.toBeNull();
    expect(detail!.email).toBe(a.email);
    expect(detail!.plan).toBe("pro");
    expect(detail!.suspendedAt).toBeNull();
    expect(detail!.lastSignInAt === null || typeof detail!.lastSignInAt === "string").toBe(true);
    expect(detail!.sites.map((s) => s.handle)).toEqual([a.handle]);
    expect(detail!.sites[0]!.domains.map((d) => d.status)).toEqual(["pending"]);
    expect(JSON.stringify(detail)).not.toContain(b.handle);
    expect(JSON.stringify(detail)).not.toContain(b.email);

    const other = await accounts.getAccountDetail(b.userId, admin as never);
    expect(other!.email).toBe(b.email);
    expect(other!.sites.map((s) => s.handle)).toEqual([b.handle]);
  });

  it("getAccountDetail: no row for an unknown or malformed id, and suspension shows in the sites' liveness", async () => {
    expect(
      await accounts.getAccountDetail("00000000-0000-4000-8000-00000000dead", admin as never),
    ).toBeNull();
    expect(await accounts.getAccountDetail("not-an-id", admin as never)).toBeNull();
    expect(await accounts.getAccountDetail("' or 1=1 --", admin as never)).toBeNull();

    const a = await owner("acc-susp");
    await admin
      .from("pages")
      .update({ published: draftOf("x") as never, published_at: new Date().toISOString() })
      .eq("id", a.pageId);
    let detail = await accounts.getAccountDetail(a.userId, admin as never);
    expect(detail!.sites[0]!.live).toBe(true);
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    detail = await accounts.getAccountDetail(a.userId, admin as never);
    expect(detail!.suspendedAt).not.toBeNull();
    expect(detail!.sites[0]!.live).toBe(false);
    expect(detail!.sites[0]!.published).toBe(true);
  });

  it("listAudit: newest first, filtered by account and by action, one more than a page tells hasMore", async () => {
    const a = await owner("aud-a");
    const b = await owner("aud-b");
    const insert = async (accountId: string, action: string) => {
      const { data, error } = await admin
        .from("admin_audit")
        .insert({ admin_id: fakeAdminId, action, account_id: accountId, detail: { n: action } })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      auditIds.push(data.id as number);
      return data.id as number;
    };
    const first = await insert(a.userId, "suspend");
    const second = await insert(a.userId, "view_draft");
    await insert(b.userId, "suspend");

    const all = await accounts.listAudit(
      { account: a.userId, action: null, page: 1 },
      admin as never,
    );
    expect(all.rows.map((r) => r.id)).toEqual([second, first]);
    expect(all.hasMore).toBe(false);
    const filtered = await accounts.listAudit(
      { account: a.userId, action: "suspend", page: 1 },
      admin as never,
    );
    expect(filtered.rows.map((r) => r.id)).toEqual([first]);
    const byAction = await accounts.listAudit(
      { account: null, action: "view_draft", page: 1 },
      admin as never,
    );
    expect(byAction.rows.every((r) => r.action === "view_draft")).toBe(true);
    expect(byAction.rows.some((r) => r.id === second)).toBe(true);
    // Another account's rows never leak into this account's list.
    expect(all.rows.every((r) => r.accountId === a.userId)).toBe(true);
    // The account page reads the same rows.
    const detail = await accounts.getAccountDetail(a.userId, admin as never);
    expect(detail!.audit.map((r) => r.id)).toEqual([second, first]);
  });

  it("logDraftView appends exactly one view_draft row with the admin, the owner, the page and the path", async () => {
    const a = await owner("log-a");
    await accounts.logDraftView(admin as never, {
      adminId: fakeAdminId,
      accountId: a.userId,
      pageId: a.pageId,
      path: "",
    });
    await accounts.logDraftView(admin as never, {
      adminId: fakeAdminId,
      accountId: a.userId,
      pageId: a.pageId,
      path: "items",
    });
    const rows = await auditRows(a.userId, "view_draft");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.detail).toEqual({ page_id: a.pageId, path: null });
    expect(rows[1]!.detail).toEqual({ page_id: a.pageId, path: "items" });
    expect(rows.every((r) => r.admin_id === fakeAdminId)).toBe(true);
  });

  it("loadAdminDraftView shows the draft (Home and a page), reads nothing it need not and writes nothing", async () => {
    const a = await owner("dv-a", "pro");
    const sub = await admin
      .from("site_pages")
      .insert({
        page_id: a.pageId,
        draft: emptySubPageDraft("items", "Items") as never,
      })
      .select("id")
      .single();
    expect(sub.error).toBeNull();
    const before = await admin
      .from("pages")
      .select("draft, updated_at, published")
      .eq("id", a.pageId)
      .single();
    const auditBefore = (await auditRows(a.userId)).length;

    const home = await drafts.loadAdminDraftView(admin as never, a.pageId, "");
    expect(home.kind).toBe("active");
    if (home.kind !== "active") return;
    expect(home.handle).toBe(a.handle);
    expect(home.ownerId).toBe(a.userId);
    expect(home.preview.doc.profile.name).toBe(`Draft ${a.handle}`);
    expect(home.preview.plan).toBe("pro");
    expect(home.pages).toEqual([{ path: "items", title: "Items" }]);

    const page = await drafts.loadAdminDraftView(admin as never, a.pageId, "items");
    expect(page.kind === "active" && page.preview.subPage?.title).toBe("Items");
    // Links of the page's menu point back at this view, never at a tenant host.
    expect(JSON.stringify(page.kind === "active" ? page.preview.site : null)).not.toContain(
      "localhost",
    );

    expect((await drafts.loadAdminDraftView(admin as never, a.pageId, "nope")).kind).toBe(
      "missing",
    );
    expect((await drafts.loadAdminDraftView(admin as never, a.pageId, "a/b")).kind).toBe("missing");
    expect((await drafts.loadAdminDraftView(admin as never, "not-an-id", "")).kind).toBe("missing");
    expect(
      (await drafts.loadAdminDraftView(admin as never, "00000000-0000-4000-8000-00000000dead", ""))
        .kind,
    ).toBe("missing");

    const after = await admin
      .from("pages")
      .select("draft, updated_at, published")
      .eq("id", a.pageId)
      .single();
    expect(after.data).toEqual(before.data);
    // The loader itself logs nothing: the page writes the row, once per opening.
    expect((await auditRows(a.userId)).length).toBe(auditBefore);
  });

  it("a suspended owner's draft can still be viewed for support", async () => {
    const a = await owner("dv-susp");
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    expect((await drafts.loadAdminDraftView(admin as never, a.pageId, "")).kind).toBe("active");
  });
});

afterAll(async () => {
  if (!run) return;
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
  // The audit table is append-only for everyone but the secret key: remove this file's own rows.
  await admin.from("admin_audit").delete().eq("admin_id", "99999999-8888-4777-8666-555555555555");
});
