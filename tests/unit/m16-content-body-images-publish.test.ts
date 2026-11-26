// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { run } = await stackIsUp();
// After the env is loaded: these modules read the public env when first imported.
const { createEntryWithClient, updateEntryWithClient } = await import("@/lib/content/entries-core");
const { publishEntryWithClient } = await import("@/lib/content/publish-core");
const { storageUrl } = run
  ? await import("@/lib/media/url")
  : { storageUrl: (path: string) => path };

/**
 * M16-04, M16-17: Publish takes an image in a post body only when it is the owner's own upload and
 * the file exists. A remote image is refused at Publish, never at a draft save (PLAN known item).
 */
describe.skipIf(!run)("images in a post body at publish (local Supabase)", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];
  const uploaded: string[] = [];
  let a: TestOwner;
  let b: TestOwner;
  let slug = 0;
  const actor = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });

  async function upload(owner: TestOwner, name: string): Promise<string> {
    const path = `${owner.userId}/${name}.webp`;
    const { error } = await admin.storage
      .from("page-media")
      .upload(path, Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "), {
        contentType: "image/webp",
        upsert: true,
      });
    if (error) throw new Error(`upload: ${error.message}`);
    uploaded.push(path);
    return path;
  }

  beforeAll(async () => {
    a = await makeOwner(admin as never, "bi-a");
    b = await makeOwner(admin as never, "bi-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
  });
  afterAll(async () => {
    if (uploaded.length > 0) await admin.storage.from("page-media").remove(uploaded);
    await removeOwners(admin as never, owners);
  });

  const post = async (body: string) => {
    slug += 1;
    const made = await createEntryWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "post",
      draft: { title: "Images", slug: `zq-bi-${slug}`, body },
    });
    if (!made.ok) throw new Error(`create failed: ${made.error} ${made.message}`);
    return made;
  };
  const publish = (id: string, expectedRev = 1) =>
    publishEntryWithClient(admin, { actor: actor(a), entryId: id, expectedRev });
  const published = async (id: string) =>
    (await admin.from("content_entries").select("published").eq("id", id).single()).data!.published;

  it("a remote image is saved in a draft and refused at Publish with the uploads message", async () => {
    const made = await post("![x](https://evil.example/pixel.png)");
    const saved = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "Images", slug: "zq-bi-remote", body: "![y](https://evil.example/2.png)" },
    });
    expect(saved).toMatchObject({ ok: true, rev: 2 });
    const out = await publish(made.id, 2);
    expect(out).toMatchObject({ ok: false, error: "invalid", status: 422 });
    expect(out.ok ? [] : out.issues).toEqual([
      { path: "body", message: "Use an image from your uploads." },
    ]);
    expect(await published(made.id)).toBeNull();
  });

  it("another user's upload is refused, although the file exists", async () => {
    const theirs = await upload(b, "img-00000000b001");
    const made = await post(`![x](${storageUrl(theirs)})`);
    const out = await publish(made.id);
    expect(out).toMatchObject({ ok: false, error: "invalid" });
    expect(out.ok ? [] : out.issues).toEqual([
      { path: "body", message: "That image isn’t in your uploads. Upload it again." },
    ]);
    expect(await published(made.id)).toBeNull();
  });

  it("the owner's own address of a file that does not exist is refused", async () => {
    const made = await post(`![x](${storageUrl(`${a.userId}/img-00000000dead.webp`)})`);
    const out = await publish(made.id);
    expect(out).toMatchObject({ ok: false, error: "invalid" });
    expect(out.ok ? [] : out.issues?.[0]?.path).toBe("body");
    expect(await published(made.id)).toBeNull();
  });

  it("the owner's own upload is published, in a table and beside the featured image", async () => {
    const own = await upload(a, "img-00000000a001");
    const second = await upload(a, "img-00000000a002");
    const body = `![x](${storageUrl(own)})\n\n| a |\n|---|\n| ![t](${storageUrl(second)}) |`;
    const made = await post(body);
    const out = await publish(made.id);
    expect(out).toMatchObject({ ok: true, rev: 2 });
    expect(await published(made.id)).toMatchObject({ body });
  });

  it("one foreign image among the owner's own still refuses the publish", async () => {
    const own = await upload(a, "img-00000000a003");
    const made = await post(`![x](${storageUrl(own)})\n\n![y](https://evil.example/y.png)`);
    expect(await publish(made.id)).toMatchObject({ ok: false, error: "invalid" });
    expect(await published(made.id)).toBeNull();
  });
});
