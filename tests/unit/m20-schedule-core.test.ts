// @vitest-environment node
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { LOCAL_DB_CONTAINER } from "../../scripts/lib/local-db";
import { makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

/**
 * M20-07, M20-08, M20-09, M20-11 against the local stack: the content writer's schedule, cancel and
 * read; the Publish gate in check mode at scheduling; the whole tick (`runSchedules`: the real worker,
 * the real writer and Publish page gate in fire mode, the real SQL) with only the cache expiry
 * stubbed; the refusals at fire time; and two overlapping claims in two real database sessions.
 *
 * Time is moved the only honest way: a row is scheduled for a minute ahead (the database refuses
 * anything sooner), then its `run_at` is moved into the past with the secret key, as an outage or a
 * late tick would leave it. No test sleeps for a minute.
 */

const invalidatePage = vi.hoisted(() => vi.fn());
const invalidateEntry = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage, invalidateEntry }));
vi.mock("@/lib/storage/exists", () => ({}));
const adminMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => adminMock.current }));

const { run } = await stackIsUp();
const {
  scheduleEntryWithClient,
  cancelScheduleWithClient,
  listSchedulesWithClient,
  createEntryWithClient,
  publishEntryWithClient,
  trashEntryWithClient,
} = await import("@/lib/content");
const { getEntryWithClient, listEntriesWithClient } = await import("@/lib/content/query-core");
const { runSchedules } = await import("@/lib/schedule/run");

type Admin = SupabaseClient<Database>;
const MINUTE = 60_000;
const ahead = (minutes: number) =>
  new Date(Math.ceil((Date.now() + minutes * MINUTE) / MINUTE) * MINUTE).toISOString().slice(0, 16) +
  ":00Z";
const mediaExists = async () => true;

describe.skipIf(!run)("M20 scheduling through the content writer and the worker", () => {
  const admin = run
    ? createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
        auth: { persistSession: false },
      })
    : (undefined as unknown as Admin);
  const owners: TestOwner[] = [];
  let pro: TestOwner;
  let free: TestOwner;
  let other: TestOwner;
  const actor = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });

  const post = async (draft: Record<string, unknown>, o = pro) => {
    const made = await createEntryWithClient(admin, { actor: actor(o), siteId: o.pageId, typeKey: "post", draft });
    if (!made.ok) throw new Error(`create failed: ${made.error}`);
    return made as unknown as { id: string; rev: number };
  };
  const page = async (draft: Record<string, unknown>, o = pro) => {
    const made = await createEntryWithClient(admin, { actor: actor(o), siteId: o.pageId, typeKey: "page", draft });
    if (!made.ok) throw new Error(`create page failed: ${made.error}`);
    return made as unknown as { id: string; rev: number };
  };
  const entry = async (id: string) =>
    (await admin.from("content_entries").select("*").eq("id", id).single()).data!;
  const schedules = async (id: string) =>
    (await admin.from("content_schedules").select("*").eq("entry_id", id).order("created_at")).data!;
  /** Time passes: every pending row of the entry is now due, `minutes` ago. */
  const due = async (id: string, minutes = 2) => {
    const at = new Date(Math.floor((Date.now() - minutes * MINUTE) / MINUTE) * MINUTE).toISOString();
    const { error } = await admin.from("content_schedules").update({ run_at: at }).eq("entry_id", id).eq("status", "pending");
    if (error) throw new Error(error.message);
  };
  const schedule = (o: TestOwner, entryId: string, expectedRev: number, runAt = ahead(5), action: "publish" | "unpublish" = "publish") =>
    scheduleEntryWithClient(admin, { actor: actor(o), entryId, expectedRev, action, runAt }, { mediaExists });

  beforeAll(async () => {
    adminMock.current = admin;
    pro = await makeOwner(admin as never, "m20-pro", undefined, "pro");
    free = await makeOwner(admin as never, "m20-free");
    other = await makeOwner(admin as never, "m20-other", undefined, "pro");
    owners.push(pro, free, other);
    for (const o of owners) await enablePost(admin, o.pageId);
    // Pro's site is live with a Home entry, so its pages can be published one by one.
    await moveHome(admin as never, pro.pageId);
    const live = await admin
      .from("pages")
      .update({ published: { version: 1, profile: { name: "P", bio: "", photo: null }, blocks: [] } as never, published_at: new Date().toISOString() })
      .eq("id", pro.pageId);
    if (live.error) throw new Error(live.error.message);
  });
  beforeEach(() => {
    invalidatePage.mockReset();
    invalidateEntry.mockReset();
  });
  afterAll(async () => {
    await admin.from("blocked_domains").delete().eq("domain", "m20-blocked.example");
    await removeOwners(admin as never, owners);
  });

  // -----------------------------------------------------------------------------------------------
  // M20-07 scheduling, refusals
  // -----------------------------------------------------------------------------------------------

  it("M20-07 scheduling a post stores the draft at that rev and changes nothing live", async () => {
    const made = await post({ title: "Later", slug: "later", body: "Hello" });
    const out = await schedule(pro, made.id, made.rev);
    expect(out).toMatchObject({ ok: true, schedule: { action: "publish", status: "pending", scheduledRev: made.rev } });
    const row = await entry(made.id);
    expect(row.published).toBeNull();
    expect(row.rev).toBe(made.rev);
    expect(row.scheduled_at).not.toBeNull();
    expect((await schedules(made.id))[0]!.snapshot).toMatchObject({ title: "Later" });
    expect(invalidateEntry).not.toHaveBeenCalled();
    expect(invalidatePage).not.toHaveBeenCalled();
  });

  it("M20-07 another user's entry answers the same not-found as a missing one", async () => {
    const mine = await post({ title: "Mine", slug: "mine" });
    const theirs = await schedule(other, mine.id, mine.rev);
    const missing = await schedule(other, "00000000-0000-4000-8000-00000000dead", 1);
    expect(theirs).toEqual(missing);
    expect(theirs).toMatchObject({ ok: false, error: "not_found", status: 404 });
    expect(await cancelScheduleWithClient(admin, { actor: actor(other), entryId: mine.id, expectedRev: mine.rev, action: "publish" })).toMatchObject({ error: "not_found" });
    expect(await listSchedulesWithClient(admin, { actor: actor(other), entryId: mine.id })).toMatchObject({ error: "not_found" });
  });

  it("M20-07 a stale rev is a conflict with the current rev, for schedule and cancel", async () => {
    const made = await post({ title: "Stale", slug: "stale" });
    expect(await schedule(pro, made.id, made.rev + 3)).toMatchObject({ error: "conflict", currentRev: made.rev });
    await schedule(pro, made.id, made.rev);
    expect(await cancelScheduleWithClient(admin, { actor: actor(pro), entryId: made.id, expectedRev: made.rev + 1, action: "publish" })).toMatchObject({ error: "conflict", currentRev: made.rev });
  });

  it("M20-07 a draft that fails Publish is refused at scheduling with typed issues", async () => {
    const untitled = await post({ slug: "untitled" });
    const refused = await schedule(pro, untitled.id, untitled.rev);
    expect(refused).toMatchObject({ ok: false, error: "invalid" });
    expect((refused as { issues?: unknown[] }).issues?.length).toBeGreaterThan(0);

    const unsafe = await post({ title: "Bad", slug: "bad-link", body: "[x](javascript:alert(1))" });
    expect(await schedule(pro, unsafe.id, unsafe.rev)).toMatchObject({ ok: false, error: "invalid" });

    // The own-image check: a page block that places another user's upload.
    const foreign = await page({
      path: "theirs",
      title: "Theirs",
      description: "",
      blocks: [{ id: "img-theirs01", type: "image", visible: true, alt: "x", url: "", image: { path: `${other.userId}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.webp`, width: 400, height: 400 } }],
    });
    const notMine = await schedule(pro, foreign.id, foreign.rev);
    expect(notMine).toMatchObject({ ok: false, error: "invalid" });
    expect((notMine as { publishErrors?: Array<{ blockId: string }> }).publishErrors?.[0]?.blockId).toBe("img-theirs01");

    await admin.from("blocked_domains").insert({ domain: "m20-blocked.example", reason: "test" });
    const blocked = await post({ title: "Blocked", slug: "blocked", body: "[x](https://m20-blocked.example/a)" }).catch(() => null);
    // The draft trigger refuses a blocked link on save; when it is saved earlier, Schedule refuses it.
    if (blocked) expect(await schedule(pro, blocked.id, blocked.rev)).toMatchObject({ ok: false, error: "blocked_link" });
    await admin.from("blocked_domains").delete().eq("domain", "m20-blocked.example");
    expect((await schedules(untitled.id)).length + (await schedules(unsafe.id)).length).toBe(0);
  });

  it("M20-07 a page draft that fails the page gate is refused with the gate's own errors", async () => {
    const bad = await page({ path: "broken", title: "Broken", description: "", blocks: [{ id: "lnk-nolabel1", type: "link", visible: true, label: "", url: "https://example.com/" }] });
    const refused = await schedule(pro, bad.id, bad.rev);
    expect(refused).toMatchObject({ ok: false, error: "invalid" });
    expect((refused as { publishErrors?: unknown[] }).publishErrors?.[0]).toMatchObject({ blockId: "lnk-nolabel1" });
  });

  it("M20-07 times: a past time and one off the minute are refused; Home cannot be scheduled to unpublish", async () => {
    const made = await post({ title: "Times", slug: "times" });
    expect(await schedule(pro, made.id, made.rev, "2020-01-01T00:00:00Z")).toMatchObject({ error: "schedule_time" });
    expect(await schedule(pro, made.id, made.rev, "2030-01-01T00:00:30Z")).toMatchObject({ error: "schedule_time" });
    const home = (await admin.from("content_entries").select("id, rev").eq("site_id", pro.pageId).eq("draft->>path", "/").single()).data!;
    expect(await schedule(pro, home.id, Number(home.rev), ahead(5), "unpublish")).toMatchObject({ error: "invalid", message: "Home can’t be scheduled to unpublish." });
  });

  it("M20-11 Free: scheduling is refused with HL017's schedule_plan; a suspended account is refused", async () => {
    const made = await post({ title: "Free", slug: "free" }, free);
    expect(await schedule(free, made.id, made.rev)).toMatchObject({ ok: false, error: "schedule_plan", status: 403 });
    await admin.from("accounts").update({ suspended_at: new Date().toISOString() }).eq("id", free.userId);
    expect(await schedule(free, made.id, made.rev)).toMatchObject({ error: "account_suspended" });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", free.userId);
  });

  it("M20-11 HL018: the site's 51st pending schedule is refused with the limit message", async () => {
    const extra = await post({ title: "Cap", slug: "cap" }, other);
    const fillers = [];
    for (let i = 0; i < 50; i += 1) fillers.push(await post({ title: `F${i}`, slug: `f-${i}` }, other));
    const rows = fillers.map((f) => ({ site_id: other.pageId, entry_id: f.id, action: "publish", run_at: ahead(30), scheduled_rev: 1, snapshot: { title: "x" }, source: "editor", created_by: other.userId }));
    const inserted = await admin.from("content_schedules").insert(rows as never);
    expect(inserted.error).toBeNull();
    const refused = await schedule(other, extra.id, extra.rev);
    expect(refused).toMatchObject({ ok: false, error: "schedule_limit" });
    expect((refused as { message: string }).message).toContain("50 scheduled changes");
    await admin.from("content_schedules").delete().eq("site_id", other.pageId);
  });

  // -----------------------------------------------------------------------------------------------
  // M20-07 cancel, reschedule, races with a hand publish and a trash
  // -----------------------------------------------------------------------------------------------

  it("M20-07 reschedule replaces the time and snapshot; cancel removes it; the list shows the summary and the filter", async () => {
    const made = await post({ title: "Move me", slug: "move-me" });
    await schedule(pro, made.id, made.rev, ahead(10));
    const second = ahead(20);
    await schedule(pro, made.id, made.rev, second);
    const listed = await listEntriesWithClient(admin, { actor: actor(pro), siteId: pro.pageId, typeKey: "post", status: "scheduled" });
    expect(listed.ok && listed.items.map((item) => item.id)).toContain(made.id);
    expect(listed.ok && listed.items.every((item) => item.schedule.publishAt !== null)).toBe(true);
    const read = await getEntryWithClient(admin, { actor: actor(pro), entryId: made.id });
    expect(read.ok && read.schedule).toMatchObject({ publishAt: new Date(second).toISOString(), scheduledRev: made.rev, failed: null });
    expect(await cancelScheduleWithClient(admin, { actor: actor(pro), entryId: made.id, expectedRev: made.rev, action: "publish" })).toMatchObject({ ok: true, canceled: true });
    const after = await listEntriesWithClient(admin, { actor: actor(pro), siteId: pro.pageId, typeKey: "post", status: "scheduled" });
    expect(after.ok && after.items.map((item) => item.id)).not.toContain(made.id);
    const listedSchedules = await listSchedulesWithClient(admin, { actor: actor(pro), entryId: made.id });
    expect(listedSchedules.ok && listedSchedules.schedules).toEqual([expect.objectContaining({ status: "canceled", resultCode: "canceled" })]);
  });

  it("M20-07 a hand publish and a trash cancel the pending publish in the same transaction", async () => {
    const byHand = await post({ title: "By hand", slug: "by-hand" });
    await schedule(pro, byHand.id, byHand.rev);
    const published = await publishEntryWithClient(admin, { actor: actor(pro), entryId: byHand.id, expectedRev: byHand.rev });
    expect(published.ok).toBe(true);
    expect((await schedules(byHand.id))[0]).toMatchObject({ status: "canceled", result_code: "published_by_hand" });
    const trashed = await post({ title: "Trash", slug: "trash-me" });
    await schedule(pro, trashed.id, trashed.rev);
    await trashEntryWithClient(admin, { actor: actor(pro), entryId: trashed.id, expectedRev: trashed.rev });
    expect((await schedules(trashed.id))[0]).toMatchObject({ status: "canceled", result_code: "trashed" });
  });

  // -----------------------------------------------------------------------------------------------
  // M20-08, M20-09 the whole tick
  // -----------------------------------------------------------------------------------------------

  it("M20-08 a due post goes live with published_at = the scheduled time, the draft untouched, the cache expired; a second tick does nothing", async () => {
    const made = await post({ title: "Fires", slug: "fires", body: "Body" });
    await schedule(pro, made.id, made.rev);
    // An edit after scheduling stays in the draft: the snapshot is what goes live.
    const edited = await admin.from("content_entries").update({ draft: { title: "Edited later", slug: "fires", body: "Body" } as never }).eq("id", made.id);
    expect(edited.error).toBeNull();
    await due(made.id);
    const runAt = (await schedules(made.id))[0]!.run_at;
    const first = await runSchedules();
    expect(first.published).toBeGreaterThanOrEqual(1);
    const row = await entry(made.id);
    expect(row.published).toMatchObject({ title: "Fires" });
    expect((row.draft as { title: string }).title).toBe("Edited later");
    expect(Date.parse(row.published_at!)).toBe(Date.parse(runAt));
    expect(row.rev).toBe(made.rev + 1);
    expect(row.scheduled_at).toBeNull();
    expect(invalidateEntry).toHaveBeenCalledWith(expect.objectContaining({ entryId: made.id, typeKey: "post" }));
    const revision = await admin.from("content_entry_revisions").select("source").eq("entry_id", made.id).eq("was_published", true).single();
    expect(revision.data?.source).toBe("system");
    await runSchedules();
    expect((await entry(made.id)).rev).toBe(made.rev + 1);
    expect((await schedules(made.id)).map((s) => s.status)).toEqual(["done"]);
  });

  it("M20-08 a page fires through the Publish page gate and expires the site", async () => {
    const made = await page({ path: "launch", title: "Launch", description: "", blocks: [{ id: "lnk-launch01", type: "link", visible: true, label: "Go", url: "https://example.com/go" }] });
    expect(await schedule(pro, made.id, made.rev)).toMatchObject({ ok: true });
    await due(made.id);
    await runSchedules();
    const row = await entry(made.id);
    expect(row.published).toMatchObject({ path: "launch", blocks: [expect.objectContaining({ id: "lnk-launch01" })] });
    expect(invalidatePage).toHaveBeenCalledWith(pro.pageId);
  });

  it("M20-08 the snapshot now holds a blocked link, a javascript: link or another user's image: failed with that code, nothing published", async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["blocked", { title: "B", slug: "snap-blocked", body: "[x](https://m20-blocked.example/a)" }, "blocked_link"],
      ["scheme", { title: "S", slug: "snap-scheme", body: "[x](javascript:alert(1))" }, "invalid"],
      ["image", { title: "I", slug: "snap-image", body: `![a](${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/page-media/${other.userId}/x.webp)` }, "invalid"],
    ];
    await admin.from("blocked_domains").insert({ domain: "m20-blocked.example", reason: "test" });
    try {
      for (const [, snapshot, code] of cases) {
        const made = await post({ title: "Fine", slug: String(snapshot.slug) });
        await schedule(pro, made.id, made.rev);
        // What a stored snapshot could hold if a rule changed after it was taken (a domain blocked later).
        await admin.from("content_schedules").update({ snapshot: snapshot as never }).eq("entry_id", made.id).eq("status", "pending");
        await due(made.id);
        await runSchedules();
        expect((await entry(made.id)).published, code).toBeNull();
        expect((await schedules(made.id))[0], code).toMatchObject({ status: "failed", result_code: code, snapshot: null });
      }
    } finally {
      await admin.from("blocked_domains").delete().eq("domain", "m20-blocked.example");
    }
  });

  it("M20-08 a downgrade before the fire: failed plan; a suspension: failed account_suspended; neither revives later", async () => {
    const down = await post({ title: "Down", slug: "down" }, other);
    await schedule(other, down.id, down.rev);
    await due(down.id);
    await admin.from("accounts").update({ paid_plan: "free" }).eq("id", other.userId);
    await runSchedules();
    expect((await schedules(down.id))[0]).toMatchObject({ status: "failed", result_code: "plan" });
    await admin.from("accounts").update({ paid_plan: "pro" }).eq("id", other.userId);
    await runSchedules();
    expect((await entry(down.id)).published).toBeNull();

    const held = await post({ title: "Held", slug: "held" }, other);
    await schedule(other, held.id, held.rev);
    await due(held.id);
    await admin.from("accounts").update({ suspended_at: new Date().toISOString() }).eq("id", other.userId);
    await runSchedules();
    await admin.from("accounts").update({ suspended_at: null }).eq("id", other.userId);
    await runSchedules();
    expect((await schedules(held.id))[0]).toMatchObject({ status: "failed", result_code: "account_suspended" });
    expect((await entry(held.id)).published).toBeNull();
    const summary = await getEntryWithClient(admin, { actor: actor(other), entryId: held.id });
    expect(summary.ok && summary.schedule.failed).toBe("account_suspended");
  });

  it("M20-08 a publish more than 24 hours late fails as missed; a scheduled unpublish runs however late", async () => {
    const late = await post({ title: "Late", slug: "late" });
    await schedule(pro, late.id, late.rev);
    await due(late.id, 25 * 60);
    await runSchedules();
    expect((await schedules(late.id))[0]).toMatchObject({ status: "failed", result_code: "missed" });

    const down = await post({ title: "Down later", slug: "down-later" });
    await publishEntryWithClient(admin, { actor: actor(pro), entryId: down.id, expectedRev: down.rev });
    const live = await entry(down.id);
    expect(await schedule(pro, down.id, live.rev, ahead(5), "unpublish")).toMatchObject({ ok: true });
    await due(down.id, 3 * 24 * 60);
    await runSchedules();
    const after = await entry(down.id);
    expect(after.published).toBeNull();
    expect((after.draft as { title: string }).title).toBe("Down later");
    expect((await schedules(down.id))[0]).toMatchObject({ status: "done", action: "unpublish" });
  });

  it("M20-08 two overlapping claims in two database sessions never return the same row (skip locked)", async () => {
    const made = [];
    for (let i = 0; i < 4; i += 1) {
      const p = await post({ title: `C${i}`, slug: `concurrent-${i}` });
      await schedule(pro, p.id, p.rev);
      await due(p.id);
      made.push(p.id);
    }
    const psql = (sql: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn("docker", ["exec", "-i", LOCAL_DB_CONTAINER, "psql", "-U", "postgres", "-At", "-q", "-v", "ON_ERROR_STOP=1"]);
        let out = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`psql ${code}`))));
        child.stdin.end(sql);
      });
    const claim = (sleep: number) =>
      psql(`begin; select c.id from public.claim_due_schedules(2) c; select pg_sleep(${sleep}); rollback;`);
    // The first session holds its rows (and their row locks) while the second claims.
    const [first, second] = await Promise.all([claim(2), new Promise<string>((r) => setTimeout(() => r(claim(0)), 500))]);
    const a = first.split("\n").filter((line) => /^[0-9a-f-]{36}$/.test(line));
    const b = second.split("\n").filter((line) => /^[0-9a-f-]{36}$/.test(line));
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    // Both rolled back: the rows are still due, and the next tick publishes each once.
    await runSchedules();
    for (const id of made) expect((await entry(id)).published).not.toBeNull();
  }, 30_000);
});
