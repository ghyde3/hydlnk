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
} from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M11-04 step 5, end to end with real Storage (the SQL half is supabase/tests/database/175): deleting
 * a sub-page queues the images it named; the M5-14 cleanup then removes the object nothing else uses
 * and keeps the one another page of the site still names.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M11-04 deleting a sub-page and the media cleanup (local Supabase)", () => {
  let admin: SupabaseClient;
  let cleanup: typeof import("@/lib/media/cleanup-admin");
  let subPages: typeof import("@/lib/site-pages/sub-pages-core");
  const owners: TestOwner[] = [];
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    cleanup = await import("@/lib/media/cleanup-admin");
    subPages = await import("@/lib/site-pages/sub-pages-core");
  });
  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    await removeOwners(admin, owners);
  });

  const upload = async (o: TestOwner) => {
    const path = `${o.userId}/avatar-${rand(12)}.webp`;
    const { error } = await admin.storage
      .from("page-media")
      .upload(path, makePng(8, 8), { contentType: "image/webp" });
    expect(error).toBeNull();
    objects.push(path);
    return path;
  };
  const exists = async (path: string) =>
    (await admin.storage.from("page-media").exists(path)).data === true;
  const imageBlock = (id: string, path: string) => ({
    id,
    type: "image",
    visible: true,
    image: { path, width: 400, height: 400 },
  });
  const addSub = async (o: TestOwner, title: string, path: string, blocks: unknown[]) => {
    const { data, error } = await admin
      .from("site_pages")
      .insert({ page_id: o.pageId, draft: { path, title, description: "", blocks } })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  const queued = async (o: TestOwner) =>
    ((await admin.from("image_cleanup_queue").select("path").eq("owner_id", o.userId)).data ?? [])
      .map((row) => row.path as string)
      .sort();

  it("the image only the deleted page used is queued and removed; the one another page still uses is kept", async () => {
    const o = await makeOwner(admin, "mc1", () => draftOf("Alpha"), "pro");
    owners.push(o);
    const onlyHere = await upload(o);
    const shared = await upload(o);
    const doomed = await addSub(o, "Gallery", "gallery", [
      imageBlock("g-img-000001", onlyHere),
      imageBlock("g-img-000002", shared),
    ]);
    await addSub(o, "Shop", "shop", [imageBlock("s-img-000001", shared)]);
    expect(await queued(o)).toEqual([]);

    const deleted = await subPages.deleteSubPageWithClient(admin as never, {
      userId: o.userId,
      siteId: o.pageId,
      subPageId: doomed,
    });
    expect(deleted).toMatchObject({ ok: true });
    // Both images the page named are queued by the delete.
    expect(await queued(o)).toEqual([onlyHere, shared].sort());

    const result = await cleanup.cleanupMediaFor(o.userId, admin);
    expect(result.deleted).toEqual([onlyHere]);
    expect(result.kept).toEqual([shared]);
    expect(await exists(onlyHere)).toBe(false);
    expect(await exists(shared)).toBe(true);
    // The removed one leaves the queue; the kept one stays queued until nothing names it.
    expect(await queued(o)).toEqual([shared]);
  });
});
