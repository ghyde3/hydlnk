import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import {
  accessTokenFor,
  addPage,
  cleanupUsers,
  desktopOnly,
  rand,
  signedInUser,
} from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { pageRow } from "../m2/editor-helpers";
import { rawBuffer } from "../m2/publish-helpers";
import {
  APP_HOST,
  BUCKET,
  MIB,
  makePngImage,
  objectExists,
  objectNames,
  removeFolders,
  sessionCookie,
  uploadMedia,
  uploaded,
  usedBytes,
  type Uploaded,
} from "./images-helpers";

/**
 * M5-14: replaced and removed images are deleted when nothing references them. The drafts are saved
 * the way the browser saves them (a PATCH with the user's token and the publishable key, under RLS),
 * the database triggers queue what a save dropped, and POST /api/media/cleanup (what the editor
 * calls after a save and the Publish action calls after updateTag) works the queue off with the
 * secret key. "Publish" is the secret-key write that core.ts makes. Unit twins:
 * tests/unit/media-cleanup.test.ts, supabase/tests/database/102-media.test.sql.
 */

test.describe.configure({ timeout: 150_000 });

const owners: string[] = [];
const themeIds: string[] = [];

test.afterAll(async () => {
  if (themeIds.length > 0) await adminClient().from("themes").delete().in("id", themeIds);
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});

type Me = Awaited<ReturnType<typeof user>>;

async function user(
  context: BrowserContext,
  label: string,
  plan: "free" | "pro" | "studio" = "free",
) {
  const made = await signedInUser(context, { label, plan });
  owners.push(made.userId);
  return { ...made, cookie: await sessionCookie(context), token: await accessTokenFor(made.email) };
}

/** A distinct small image (distinct colour), uploaded through the route. */
async function put(
  me: Me,
  kind: "avatar" | "background" | "content",
  n: number,
): Promise<Uploaded> {
  const color: [number, number, number] = [
    (n * 61 + 20) % 256,
    (n * 109 + 70) % 256,
    (n * 37 + 140) % 256,
  ];
  const res = await uploadMedia(await makePngImage({ width: 240, height: 180, color }), {
    kind,
    cookie: me.cookie,
    contentType: "image/png",
  });
  return uploaded(res);
}

const ref = (image: Uploaded) => ({ path: image.path, width: image.width, height: image.height });

/** Saves the draft as the browser does: the user's token, the publishable key, RLS decides. */
async function saveDraft(me: Me, pageId: string, edit: (draft: Draft) => void): Promise<void> {
  const draft = structuredClone((await pageRow(pageId)).draft) as Draft;
  edit(draft);
  const res = await restAs(me.token, `/pages?id=eq.${pageId}`, {
    method: "PATCH",
    body: { draft },
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  expect((res.body as unknown[]).length).toBe(1);
}

type Draft = {
  profile: { photo: unknown };
  blocks: unknown[];
  theme: { ref: string | null; overrides: Record<string, unknown> };
  [key: string]: unknown;
};

/** What core.ts does at Publish: the secret key copies the draft into `published`. */
async function publish(pageId: string): Promise<void> {
  const row = await pageRow(pageId);
  const { error } = await adminClient()
    .from("pages")
    .update({ published: row.draft, published_at: new Date().toISOString() })
    .eq("id", pageId);
  expect(error).toBeNull();
}

const cleanup = (cookie: string | undefined, headers: Record<string, string> = {}) =>
  rawBuffer(APP_HOST, "/api/media/cleanup", { method: "POST", cookie, headers });

async function queued(userId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from("image_cleanup_queue")
    .select("path")
    .eq("owner_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { path: string }) => row.path);
}

const publicUrl = (path: string) => `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}`;
const live = async (path: string) => (await fetch(publicUrl(path))).status === 200;

async function runCleanup(me: Me): Promise<{ deleted: number; kept: number }> {
  const res = await cleanup(me.cookie);
  expect(res.status, res.text).toBe(200);
  return JSON.parse(res.text) as { deleted: number; kept: number };
}

test.describe("M5-14 a draft save that drops an image", () => {
  test("M5-14 replacing the avatar deletes the old object once the draft no longer references it; the new one stays; the stored total drops", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "cr");
    // Never published: the draft is the only document that references the images.
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", me.pageId);

    const a = await put(me, "avatar", 1);
    await saveDraft(me, me.pageId, (d) => (d.profile.photo = ref(a)));
    expect(await queued(me.userId)).toEqual([]);

    const b = await put(me, "avatar", 2);
    await saveDraft(me, me.pageId, (d) => (d.profile.photo = ref(b)));
    expect(await queued(me.userId)).toEqual([a.path]); // the trigger queued the dropped path
    expect(await objectExists(a.path)).toBe(true); // nothing is deleted until the cleanup runs
    const withBoth = await usedBytes(me.userId);

    expect(await runCleanup(me)).toEqual({ deleted: 1, kept: 0 });
    expect(await objectExists(a.path)).toBe(false);
    expect(await objectExists(b.path)).toBe(true);
    expect(await live(b.path)).toBe(true);
    expect(await queued(me.userId)).toEqual([]);
    expect(await usedBytes(me.userId)).toBeLessThan(withBoth); // A's bytes are gone
    expect(await objectNames(me.userId)).toEqual([b.path.split("/")[1]]);

    // Remove: the photo cleared, the object goes.
    await saveDraft(me, me.pageId, (d) => (d.profile.photo = null));
    expect(await runCleanup(me)).toEqual({ deleted: 1, kept: 0 });
    expect(await objectNames(me.userId)).toEqual([]);
    expect(await usedBytes(me.userId)).toBe(0);
    // Running again finds nothing.
    expect(await runCleanup(me)).toEqual({ deleted: 0, kept: 0 });
    await context.close();
  });

  test("M5-14 deleting an image block or a card image, and replacing a background, are cleaned up the same way", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "cb");
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", me.pageId);
    const img = await put(me, "content", 3);
    const card = await put(me, "content", 4);
    const bg1 = await put(me, "background", 5);
    const bg2 = await put(me, "background", 6);
    await saveDraft(me, me.pageId, (d) => {
      d.blocks = [
        { id: "b1", type: "image", image: ref(img), alt: "x" },
        { id: "b2", type: "card", image: ref(card), title: "t", url: "https://example.com" },
      ];
      d.theme = { ...d.theme, overrides: { bgType: "image", bgImage: publicUrl(bg1.path) } };
    });
    // Delete the image block, remove the card image, replace the background.
    await saveDraft(me, me.pageId, (d) => {
      d.blocks = [{ id: "b2", type: "card", image: null, title: "t", url: "https://example.com" }];
      d.theme = { ...d.theme, overrides: { bgType: "image", bgImage: publicUrl(bg2.path) } };
    });
    expect((await queued(me.userId)).sort()).toEqual([img.path, card.path, bg1.path].sort());
    expect(await runCleanup(me)).toEqual({ deleted: 3, kept: 0 });
    expect(await objectNames(me.userId)).toEqual([bg2.path.split("/")[1]]);
    await context.close();
  });

  test("M5-14 the Undo path: an image that comes back into the draft before the cleanup runs is not deleted", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "cu");
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", me.pageId);
    const img = await put(me, "content", 7);
    const block = { id: "bu", type: "image", image: ref(img), alt: "x" };
    await saveDraft(me, me.pageId, (d) => (d.blocks = [block]));
    await saveDraft(me, me.pageId, (d) => (d.blocks = [])); // delete the block
    expect(await queued(me.userId)).toEqual([img.path]);
    await saveDraft(me, me.pageId, (d) => (d.blocks = [block])); // Undo
    expect(await queued(me.userId)).toEqual([]); // the save that brought it back took it off the queue
    expect(await runCleanup(me)).toEqual({ deleted: 0, kept: 0 });
    expect(await objectExists(img.path)).toBe(true);
    await context.close();
  });
});

test.describe("M5-14 the published page keeps what it shows until Publish", () => {
  test("M5-14 an object the live page references survives a draft that drops it (the object stays 200), and the first Publish that drops it deletes it", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "pb");
    const a = await put(me, "background", 8);
    const b = await put(me, "background", 9);

    // Draft and published both reference A: it stays.
    await saveDraft(
      me,
      me.pageId,
      (d) => (d.theme = { ...d.theme, overrides: { bgType: "image", bgImage: publicUrl(a.path) } }),
    );
    await publish(me.pageId);
    expect(await runCleanup(me)).toEqual({ deleted: 0, kept: 0 });
    expect(await live(a.path)).toBe(true);

    // The owner replaces the background in the draft: A is still what the live page shows.
    await saveDraft(
      me,
      me.pageId,
      (d) => (d.theme = { ...d.theme, overrides: { bgType: "image", bgImage: publicUrl(b.path) } }),
    );
    expect(await queued(me.userId)).toEqual([]); // not queued: the published document still names it
    expect(await runCleanup(me)).toEqual({ deleted: 0, kept: 0 });
    expect(await live(a.path)).toBe(true);
    expect(await live(b.path)).toBe(true);

    // Publish: the live page now shows B, so A is nothing's, and the Publish action's cleanup deletes it.
    await publish(me.pageId);
    expect(await queued(me.userId)).toEqual([a.path]);
    expect(await live(a.path)).toBe(true); // still there until the cleanup runs after updateTag
    expect(await runCleanup(me)).toEqual({ deleted: 1, kept: 0 });
    expect(await objectExists(a.path)).toBe(false);
    expect(await live(b.path)).toBe(true);
    await context.close();
  });

  test("M5-14 a queued path the published document still names is kept by the cleanup itself (the check is made at deletion time)", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "pk");
    const a = await put(me, "avatar", 10);
    // Published names A. A queue row for it exists anyway (planted with the secret key, as a stale row would be).
    await saveDraft(me, me.pageId, (d) => (d.profile.photo = ref(a)));
    await publish(me.pageId);
    await saveDraft(me, me.pageId, (d) => (d.profile.photo = null));
    const { error } = await adminClient()
      .from("image_cleanup_queue")
      .insert({ path: a.path, owner_id: me.userId });
    expect(error).toBeNull();
    expect(await runCleanup(me)).toEqual({ deleted: 0, kept: 1 });
    expect(await objectExists(a.path)).toBe(true);
    expect(await queued(me.userId)).toEqual([a.path]); // stays queued for the Publish that drops it
    await context.close();
  });
});

test.describe("M5-14 never deletes an image any draft, published page or theme still uses", () => {
  test("M5-14 a second page's draft and a saved theme's background each keep an object alive; it goes once the last reference is gone", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "mr", "pro");
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", me.pageId);
    const secondId = await addPage(me.userId, `zq-mr2-${rand(5)}`);
    const shared = await put(me, "content", 11);
    const themed = await put(me, "background", 12);

    // `shared`: on page one and page two. `themed`: page one's background and a saved theme's.
    await saveDraft(me, me.pageId, (d) => {
      d.blocks = [{ id: "s1", type: "image", image: ref(shared), alt: "x" }];
      d.theme = { ...d.theme, overrides: { bgType: "image", bgImage: publicUrl(themed.path) } };
    });
    await saveDraft(
      me,
      secondId,
      (d) => (d.blocks = [{ id: "s2", type: "image", image: ref(shared), alt: "x" }]),
    );
    const theme = await restAs(me.token, "/themes", {
      method: "POST",
      body: {
        owner_id: me.userId,
        name: `T ${rand(4)}`,
        tokens: { bgType: "image", bgImage: publicUrl(themed.path) },
      },
    });
    expect(theme.status, JSON.stringify(theme.body)).toBeLessThan(300);
    const themeId = (theme.body as { id: string }[])[0]!.id;
    themeIds.push(themeId);

    // Page one drops both.
    await saveDraft(me, me.pageId, (d) => {
      d.blocks = [];
      d.theme = { ...d.theme, overrides: {} };
    });
    expect((await queued(me.userId)).sort()).toEqual([shared.path, themed.path].sort());
    expect(await runCleanup(me)).toEqual({ deleted: 0, kept: 2 });
    expect(await objectExists(shared.path)).toBe(true);
    expect(await objectExists(themed.path)).toBe(true);

    // Page two drops `shared`: now only the theme holds `themed`.
    await saveDraft(me, secondId, (d) => (d.blocks = []));
    expect(await runCleanup(me)).toEqual({ deleted: 1, kept: 1 });
    expect(await objectExists(shared.path)).toBe(false);
    expect(await objectExists(themed.path)).toBe(true);

    // The theme is deleted: the last reference goes.
    const del = await restAs(me.token, `/themes?id=eq.${themeId}`, { method: "DELETE" });
    expect(del.status).toBeLessThan(300);
    expect(await runCleanup(me)).toEqual({ deleted: 1, kept: 0 });
    expect(await objectExists(themed.path)).toBe(false);
    expect(await objectNames(me.userId)).toEqual([]);

    // Deleting a page queues what it held.
    const last = await put(me, "content", 13);
    await saveDraft(
      me,
      secondId,
      (d) => (d.blocks = [{ id: "s3", type: "image", image: ref(last), alt: "x" }]),
    );
    const gone = await adminClient().from("pages").delete().eq("id", secondId);
    expect(gone.error).toBeNull();
    expect(await queued(me.userId)).toEqual([last.path]);
    expect(await runCleanup(me)).toEqual({ deleted: 1, kept: 0 });
    await context.close();
  });
});

test.describe("M5-14 another user's objects are never touched", () => {
  test("M5-14 naming another user's object in a draft and dropping it queues nothing, and the cleanup leaves it alone", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await user(contextA, "oa");
    const b = await user(contextB, "ob");
    const theirs = await put(a, "avatar", 14);
    await saveDraft(a, a.pageId, (d) => (d.profile.photo = ref(theirs)));
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", a.pageId);

    // B writes A's path into B's draft (RLS lets a user write any JSON there) and takes it out again.
    await saveDraft(b, b.pageId, (d) => (d.profile.photo = ref(theirs)));
    await saveDraft(b, b.pageId, (d) => (d.profile.photo = null));
    expect(await queued(b.userId)).toEqual([]);
    expect(await runCleanup(b)).toEqual({ deleted: 0, kept: 0 });
    expect(await objectExists(theirs.path)).toBe(true);

    // The database refuses a queue row that names another folder, whoever writes it...
    const planted = await adminClient()
      .from("image_cleanup_queue")
      .insert({ path: theirs.path, owner_id: b.userId });
    expect(planted.error?.code).toBe("23514");
    // ...and a row that stays inside B's folder but climbs out of it is discarded without a Storage call.
    const traversal = `${b.userId}/../${a.userId}/${theirs.path.split("/")[1]}`;
    const climbing = await adminClient()
      .from("image_cleanup_queue")
      .insert({ path: traversal, owner_id: b.userId });
    expect(climbing.error).toBeNull();
    expect(await runCleanup(b)).toEqual({ deleted: 0, kept: 0 });
    expect(await queued(b.userId)).toEqual([]); // discarded from the queue
    expect(await objectExists(theirs.path)).toBe(true);
    expect(await live(theirs.path)).toBe(true);

    // A's own cleanup is unaffected by any of it: A's image is still in A's draft.
    expect(await runCleanup(a)).toEqual({ deleted: 0, kept: 0 });
    expect(await objectExists(theirs.path)).toBe(true);
    await contextA.close();
    await contextB.close();
  });

  test("M5-14 the route needs a session, ignores any body or query, and refuses a cross-origin request", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const otherContext = await browser.newContext();
    const me = await user(context, "ra");
    const other = await user(otherContext, "rb");
    const theirs = await put(other, "avatar", 15);
    await saveDraft(other, other.pageId, (d) => (d.profile.photo = ref(theirs)));
    await saveDraft(other, other.pageId, (d) => (d.profile.photo = null));
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", other.pageId);

    expect((await cleanup(undefined)).status).toBe(401);
    expect((await cleanup(me.cookie, { origin: "http://evil.example" })).status).toBe(403);
    // Me asking for the other user's queue: ignored, the session user is the only input.
    const res = await rawBuffer(
      APP_HOST,
      `/api/media/cleanup?owner=${other.userId}&path=${encodeURIComponent(theirs.path)}`,
      {
        method: "POST",
        cookie: me.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: other.userId, owner_id: other.userId, paths: [theirs.path] }),
      },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ deleted: 0, kept: 0 });
    expect(await objectExists(theirs.path)).toBe(true);
    expect(await queued(other.userId)).toEqual([theirs.path]); // still waiting for its owner's cleanup
    expect(await runCleanup(other)).toEqual({ deleted: 1, kept: 0 });
    // GET is not a method of the route.
    expect((await rawBuffer(APP_HOST, "/api/media/cleanup", { cookie: me.cookie })).status).toBe(
      405,
    );
    await context.close();
    await otherContext.close();
  });
});

test.describe("M5-14 freed bytes lower the stored total (M4-31)", () => {
  /** An object under the user's folder that a draft can reference (random bytes, a hash-style name). */
  async function bigObject(userId: string, bytes: number): Promise<string> {
    const path = `${userId}/img-${randomBytes(16).toString("hex")}.webp`;
    const { error } = await adminClient()
      .storage.from(BUCKET)
      .upload(path, randomBytes(bytes), { contentType: "image/webp" });
    if (error) throw new Error(`seed failed: ${error.message}`);
    return path;
  }
  async function filler(userId: string, bytes: number): Promise<void> {
    for (let left = bytes, i = 0; left > 0; i++) {
      const size = Math.min(left, 4 * MIB);
      const { error } = await adminClient()
        .storage.from(BUCKET)
        .upload(`${userId}/seed-${rand(6)}-${i}.png`, Buffer.alloc(size), {
          contentType: "image/png",
        });
      if (error) throw new Error(`seed failed: ${error.message}`);
      left -= size;
    }
  }

  const noise = () => makePngImage({ width: 1200, height: 800, noise: true });

  test("M5-14 a Free account near its cap: replacing a 3 MB image frees room and the upload that was refused is accepted", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const probeContext = await browser.newContext();
    const probe = await user(probeContext, "fp");
    const image = await noise();
    uploaded(
      await uploadMedia(image, { kind: "content", cookie: probe.cookie, contentType: "image/png" }),
    );
    const stored = await usedBytes(probe.userId); // what the upload costs once converted
    expect(stored).toBeGreaterThan(50 * 1024);

    const context = await browser.newContext();
    const me = await user(context, "fr");
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", me.pageId);
    const cap = 10 * MIB;
    const room = Math.floor(stored / 2); // less than the upload needs
    const big = await bigObject(me.userId, 3 * MIB);
    await filler(me.userId, cap - room - 3 * MIB);
    await saveDraft(
      me,
      me.pageId,
      (d) => (d.profile.photo = { path: big, width: 800, height: 600 }),
    );
    expect(await usedBytes(me.userId)).toBe(cap - room);

    // The image is replaced in the draft: the 3 MB object is queued, still stored.
    await saveDraft(me, me.pageId, (d) => (d.profile.photo = null));
    expect(await queued(me.userId)).toEqual([big]);
    expect(await usedBytes(me.userId)).toBe(cap - room);

    // The upload would not fit; the route lets go of the replaced image first, then stores it.
    const res = await uploadMedia(image, {
      kind: "content",
      cookie: me.cookie,
      contentType: "image/png",
    });
    expect(res.status, res.text).toBe(200);
    expect(await objectExists(big)).toBe(false);
    expect(await usedBytes(me.userId)).toBe(cap - room - 3 * MIB + stored); // the total dropped by 3 MB, then took the upload
    expect(await queued(me.userId)).toEqual([]);
    await probeContext.close();
    await context.close();
  });

  test("M5-14 the same account is still refused while the replaced image is what the live page shows", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const probeContext = await browser.newContext();
    const probe = await user(probeContext, "fq");
    const image = await noise();
    uploaded(
      await uploadMedia(image, { kind: "content", cookie: probe.cookie, contentType: "image/png" }),
    );
    const stored = await usedBytes(probe.userId);

    const context = await browser.newContext();
    const me = await user(context, "fl");
    const cap = 10 * MIB;
    const room = Math.floor(stored / 2);
    const big = await bigObject(me.userId, 3 * MIB);
    await filler(me.userId, cap - room - 3 * MIB);
    await saveDraft(
      me,
      me.pageId,
      (d) => (d.profile.photo = { path: big, width: 800, height: 600 }),
    );
    await publish(me.pageId); // the live page shows it
    await saveDraft(me, me.pageId, (d) => (d.profile.photo = null));

    const res = await uploadMedia(image, {
      kind: "content",
      cookie: me.cookie,
      contentType: "image/png",
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.text).error).toBe("upload_quota");
    expect(await objectExists(big)).toBe(true); // never deleted from under the live page
    expect(await live(big)).toBe(true);
    expect(await usedBytes(me.userId)).toBe(cap - room);
    await probeContext.close();
    await context.close();
  });
});

test.describe("M5-14 no client can delete, replace or call anything of this", () => {
  test("M5-14 with the publishable key a direct DELETE, upsert or list of a page-media object is rejected; the queue, the cleanup function and the rate-limit function are closed to anon and authenticated", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "ca");
    const mine = await put(me, "avatar", 16);
    const objectUrl = `${supabaseUrl()}/storage/v1/object/${BUCKET}/${mine.path}`;
    const headers = { apikey: publishableKey(), Authorization: `Bearer ${me.token}` };
    const bytes = new Uint8Array(randomBytes(64));

    const del = await fetch(objectUrl, { method: "DELETE", headers });
    expect([400, 401, 403, 404]).toContain(del.status);
    const batchDel = await fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [mine.path] }),
    });
    expect(batchDel.status === 200 ? ((await batchDel.json()) as unknown[]).length : 0).toBe(0);
    const upsert = await fetch(objectUrl, {
      method: "PUT",
      headers: { ...headers, "content-type": "image/webp", "x-upsert": "true" },
      body: bytes,
    });
    expect([400, 401, 403, 404]).toContain(upsert.status);
    const list = await fetch(`${supabaseUrl()}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ prefix: me.userId, limit: 10 }),
    });
    expect(list.status === 200 ? ((await list.json()) as unknown[]).length : 0).toBe(0);
    expect(await objectExists(mine.path)).toBe(true);
    expect(await live(mine.path)).toBe(true);

    // PostgREST: the queue table and the functions, as the user and as anonymous.
    for (const auth of [{ ...headers }, { apikey: publishableKey() }] as Record<string, string>[]) {
      const select = await fetch(`${supabaseUrl()}/rest/v1/image_cleanup_queue?select=path`, {
        headers: auth,
      });
      expect([401, 403, 404]).toContain(select.status);
      const insert = await fetch(`${supabaseUrl()}/rest/v1/image_cleanup_queue`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ path: mine.path, owner_id: me.userId }),
      });
      expect([401, 403, 404]).toContain(insert.status);
      const hits = await fetch(`${supabaseUrl()}/rest/v1/image_upload_hits?select=owner_id`, {
        headers: auth,
      });
      expect([401, 403, 404]).toContain(hits.status);
      for (const [fn, args] of [
        ["media_paths_in_use", { p_uid: me.userId, p_paths: [mine.path] }],
        ["media_upload_rate_hit", { p_uid: me.userId, p_limit: 1, p_window_seconds: 60 }],
        ["media_image_paths", { p_doc: {} }],
      ] as const) {
        const call = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify(args),
        });
        expect(call.status, fn).toBeGreaterThanOrEqual(400);
      }
    }
    expect(await queued(me.userId)).toEqual([]);
    await context.close();
  });
});
