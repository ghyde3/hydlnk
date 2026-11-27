import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makePng } from "../e2e/m2/publish-helpers";
import {
  draftOf,
  makeOwner,
  rand,
  removeOwners,
  stackIsUp,
  type TestOwner,
  ownerRun,
  pastUndo,
} from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * S3 (M19-05, A31), end to end with real Storage: an upload is queued for the M5-14 cleanup the moment
 * it is stored (`queueNewUpload`, in the OWNER's folder). While its grace runs the cleanup does not
 * see it; once a draft names it the trigger takes it off the queue for good; an upload nothing names
 * is deleted by the first cleanup after the grace (here the grace is ended with `requeue_media`, the
 * queue's own "now" write), so a member's unused uploads never fill the owner's quota for good.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("S3 every new upload is queued for the cleanup (local Supabase)", () => {
  let admin: SupabaseClient;
  let cleanup: typeof import("@/lib/media/cleanup-admin");
  const owners: TestOwner[] = [];
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    cleanup = await import("@/lib/media/cleanup-admin");
  });
  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    await removeOwners(admin, owners);
  });

  const store = async (o: TestOwner) => {
    const path = `${o.userId}/img-${rand(12)}.webp`;
    const { error } = await admin.storage
      .from("page-media")
      .upload(path, makePng(8, 8), { contentType: "image/webp" });
    expect(error).toBeNull();
    objects.push(path);
    await cleanup.queueNewUpload(o.userId, path, admin);
    return path;
  };
  const exists = async (path: string) =>
    (await admin.storage.from("page-media").exists(path)).data === true;
  const queued = async (o: TestOwner) =>
    ((await admin.from("image_cleanup_queue").select("path").eq("owner_id", o.userId)).data ?? []).map(
      (row) => row.path as string,
    );
  const endGrace = async (o: TestOwner, paths: string[]) => {
    const { error } = await admin.rpc("requeue_media", { p_owner: o.userId, p_paths: paths });
    expect(error).toBeNull();
  };

  it("an unused upload waits out its grace, then the cleanup deletes it; a used one leaves the queue", async () => {
    const o = await makeOwner(admin, "s3up", () => draftOf("Up"), "studio");
    owners.push(o);
    const unused = await store(o);
    const used = await store(o);
    expect((await queued(o)).sort()).toEqual([unused, used].sort());

    // In the grace: a cleanup run (a save, a Publish, a full quota) sees neither.
    expect(await cleanup.cleanupMediaFor(ownerRun(o.userId), pastUndo(admin))).toEqual({ deleted: [], kept: [], discarded: [] });
    expect(await exists(unused)).toBe(true);

    // The editor saves the reference: the draft trigger takes `used` off the queue.
    const page = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    const draft = page.data!.draft as { blocks: unknown[] };
    const saved = await admin
      .from("pages")
      .update({
        draft: {
          ...draft,
          blocks: [...draft.blocks, { id: "s3-img-0001", type: "image", visible: true, image: { path: used, width: 8, height: 8 } }],
        } as never,
      })
      .eq("id", o.pageId);
    expect(saved.error).toBeNull();
    expect(await queued(o)).toEqual([unused]);

    // The grace is over: the unused upload goes, the used one stays.
    await endGrace(o, [unused]);
    expect(await cleanup.cleanupMediaFor(ownerRun(o.userId), pastUndo(admin))).toMatchObject({ deleted: [unused], kept: [] });
    expect(await exists(unused)).toBe(false);
    expect(await exists(used)).toBe(true);
    expect(await queued(o)).toEqual([]);
  });

  it("the same bytes uploaded again never make a waiting row visible sooner", async () => {
    const o = await makeOwner(admin, "s3again", () => draftOf("Again"), "pro");
    owners.push(o);
    const path = await store(o);
    await endGrace(o, [path]);
    // Uploaded again (the route queues before it answers): the grace starts over.
    await cleanup.queueNewUpload(o.userId, path, admin);
    expect(await cleanup.cleanupMediaFor(ownerRun(o.userId), pastUndo(admin))).toEqual({ deleted: [], kept: [], discarded: [] });
    expect(await exists(path)).toBe(true);
  });

  it("a path outside the owner's folder is never queued", async () => {
    const o = await makeOwner(admin, "s3x", () => draftOf("X"), "pro");
    owners.push(o);
    await cleanup.queueNewUpload(o.userId, `00000000-0000-4000-8000-000000000001/img-${rand(12)}.webp`, admin);
    expect(await queued(o)).toEqual([]);
  });
});
