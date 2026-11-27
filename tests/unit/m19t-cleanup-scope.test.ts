// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makePng } from "../e2e/m2/publish-helpers";
import { rand, removeOwners, stackIsUp } from "./publish-support";
import { fixtureUsers, teamFixture, type TeamFixture } from "./m19t-team-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * Team access attack pass, finding 1 (M19-05, M19-06), end to end with real Storage and the real
 * route: the owner removes an image on their second site S2; at once an EDITOR of site S calls
 * POST /api/media/cleanup with `x-hl-site: S`. The image survives (it is S2's row, and inside the
 * owner's Undo window), so the owner's Undo still finds it. A member's call deletes only S's own rows
 * queued more than the Undo window ago; the owner's own call keeps working the whole queue.
 */
const m = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => m.user }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));

const { run } = await stackIsUp();

describe.skipIf(!run)("finding 1: a member's cleanup works only its site's rows past the Undo window (local Supabase)", () => {
  let admin: SupabaseClient;
  let f: TeamFixture;
  let route: typeof import("@/app/(editor)/app/api/media/cleanup/route");
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    f = await teamFixture(admin, "m19cs");
    route = await import("@/app/(editor)/app/api/media/cleanup/route");
  });
  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    if (f) await removeOwners(admin, fixtureUsers(f));
  });

  /** An image of the owner's folder, on `siteId`'s draft, then removed from it (the trigger queues it). */
  const dropFrom = async (siteId: string) => {
    const path = `${f.owner.userId}/img-${rand(12)}.webp`;
    const stored = await admin.storage.from("page-media").upload(path, makePng(8, 8), { contentType: "image/webp" });
    expect(stored.error).toBeNull();
    objects.push(path);
    const row = await admin.from("pages").select("draft").eq("id", siteId).single();
    const draft = row.data!.draft as { blocks: unknown[] };
    const block = { id: `cs-${rand(8)}`, type: "image", visible: true, image: { path, width: 8, height: 8 } };
    expect((await admin.from("pages").update({ draft: { ...draft, blocks: [...draft.blocks, block] } }).eq("id", siteId)).error).toBeNull();
    expect((await admin.from("pages").update({ draft }).eq("id", siteId)).error).toBeNull();
    return path;
  };
  const exists = async (path: string) => (await admin.storage.from("page-media").exists(path)).data === true;
  const cleanupAs = async (userId: string, site: string) => {
    m.user = { id: userId };
    const res = await route.POST(
      new NextRequest("http://app.localhost:3000/api/media/cleanup", { method: "POST", headers: { "x-hl-site": site } }),
    );
    expect(res.status).toBe(200);
    return (await res.json()) as { deleted: number; kept: number };
  };
  /** Moves a queued row's time back past the Undo window (service_role may insert, not update). */
  const age = async (path: string, siteId: string) => {
    expect((await admin.from("image_cleanup_queue").delete().eq("path", path)).error).toBeNull();
    const back = new Date(Date.now() - 60_000).toISOString();
    expect(
      (await admin.from("image_cleanup_queue").insert({ path, owner_id: f.owner.userId, site_id: siteId, queued_at: back })).error,
    ).toBeNull();
  };

  it("the attacker's repro: the owner removes an image on S2, the editor of S cleans up at once, the image stays", async () => {
    const onS2 = await dropFrom(f.s2);
    expect(await cleanupAs(f.editor.userId, f.owner.pageId)).toEqual({ deleted: 0, kept: 0 });
    expect(await exists(onS2)).toBe(true);
    // Even past the Undo window, S2's row is not the editor's to work off.
    await age(onS2, f.s2);
    expect(await cleanupAs(f.editor.userId, f.owner.pageId)).toEqual({ deleted: 0, kept: 0 });
    expect(await exists(onS2)).toBe(true);
    // The owner's own call works the whole queue, as before.
    expect((await cleanupAs(f.owner.userId, f.owner.pageId)).deleted).toBe(1);
    expect(await exists(onS2)).toBe(false);
  });

  it("on its own site a member's call waits out the Undo window, then deletes the unused image", async () => {
    const onS = await dropFrom(f.owner.pageId);
    expect(await cleanupAs(f.editor.userId, f.owner.pageId)).toEqual({ deleted: 0, kept: 0 });
    expect(await exists(onS)).toBe(true);
    await age(onS, f.owner.pageId);
    expect(await cleanupAs(f.editor.userId, f.owner.pageId)).toEqual({ deleted: 1, kept: 0 });
    expect(await exists(onS)).toBe(false);
  });
});
