import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  draftOf,
  makeOwner,
  publishedOf,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M5-08 / M5-09 server half against the local Supabase: Publish refuses a suspended owner with
 * `account_suspended` and writes nothing, an unsuspend lets it through, and the request-time checks
 * the tracking routes will use (`isPageOffline`) and the write doors use (`isAccountSuspended`)
 * read the account fresh.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M5-08 / M5-09 suspended owners (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  let suspension: typeof import("@/lib/admin/suspension");
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??= "localhost:3000";
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    core = await import("@/lib/publish/core");
    suspension = await import("@/lib/admin/suspension");
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  const setSuspended = async (id: string, on: boolean) => {
    const { error } = await admin
      .from("accounts")
      .update({ suspended_at: on ? new Date().toISOString() : null })
      .eq("id", id);
    expect(error).toBeNull();
  };

  it("M5-09 Publish refuses a suspended owner (account_suspended), writes nothing, and works again after the unsuspend", async () => {
    const o = await makeOwner(admin, "pub", (handle) => draftOf(handle));
    owners.push(o);
    const deps = { admin: admin as never, mediaExists: async () => true };

    await setSuspended(o.userId, true);
    const refused = await core.publishPageCore({ pageId: o.pageId, userId: o.userId }, deps);
    expect(refused).toMatchObject({ ok: false, reason: "account_suspended", errors: [] });
    expect((await publishedOf(admin, o.pageId)).published).toBeNull();

    await setSuspended(o.userId, false);
    const allowed = await core.publishPageCore({ pageId: o.pageId, userId: o.userId }, deps);
    expect(allowed.ok).toBe(true);
    expect((await publishedOf(admin, o.pageId)).published).not.toBeNull();
  });

  it("M5-09 a suspended owner cannot republish over a live page: the stored document stays as it was", async () => {
    const o = await makeOwner(admin, "re", (handle) => draftOf(handle));
    owners.push(o);
    const deps = { admin: admin as never, mediaExists: async () => true };
    expect((await core.publishPageCore({ pageId: o.pageId, userId: o.userId }, deps)).ok).toBe(
      true,
    );
    const live = await publishedOf(admin, o.pageId);

    await admin
      .from("pages")
      .update({ draft: draftOf("Changed") })
      .eq("id", o.pageId);
    await setSuspended(o.userId, true);
    expect(await core.publishPageCore({ pageId: o.pageId, userId: o.userId }, deps)).toMatchObject({
      ok: false,
      reason: "account_suspended",
    });
    expect(await publishedOf(admin, o.pageId)).toEqual(live);
  });

  it("M5-09 someone else's page is still `forbidden` for a suspended caller (the suspension check says nothing about other accounts)", async () => {
    const mine = await makeOwner(admin, "mine");
    const theirs = await makeOwner(admin, "theirs");
    owners.push(mine, theirs);
    await setSuspended(mine.userId, true);
    const result = await core.publishPageCore(
      { pageId: theirs.pageId, userId: mine.userId },
      { admin: admin as never, mediaExists: async () => true },
    );
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("M5-08 isAccountSuspended and isPageOffline read the account fresh at every call", async () => {
    const o = await makeOwner(admin, "off");
    owners.push(o);
    expect(await suspension.isAccountSuspended(o.userId)).toBe(false);
    expect(await suspension.isPageOffline(o.pageId)).toBe(false);
    await setSuspended(o.userId, true);
    expect(await suspension.isAccountSuspended(o.userId)).toBe(true);
    expect(await suspension.isPageOffline(o.pageId)).toBe(true);
    await setSuspended(o.userId, false);
    expect(await suspension.isPageOffline(o.pageId)).toBe(false);
  });

  it("M5-08 an unknown page or account reads as offline: nothing is served or recorded for it", async () => {
    const nobody = "00000000-0000-4000-8000-0000000000ee";
    expect(await suspension.isPageOffline(nobody)).toBe(true);
    expect(await suspension.isAccountSuspended(nobody)).toBe(true);
  });
});
