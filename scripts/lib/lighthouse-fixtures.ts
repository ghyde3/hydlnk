/**
 * Pages for `pnpm lighthouse` (M5-21): four published tenant pages made from the seeded demo page
 * (every block type), so the audit covers more than `mara`:
 *
 *   lh-ivory  Ivory theme, Pro (no badge)
 *   lh-smoke  Smoke theme, Pro (no badge)
 *   lh-free   Noir theme, Free ("Made with HYDLNK" badge)
 *   lh-media  Ivory theme, Free, with a profile photo and a background image in Storage
 *   lh-blog   Ivory theme, Pro, with the blog on (Wave B, M16-04, M16-05): audited at `/blog` (an
 *             archive of 12 posts, the first with a featured image) and at `/blog/lh-post-1` (a post
 *             with a featured image, an image in its body, a list, a quote, code and a table)
 *
 * Each gets its own user (the Free plan allows one page). Everything is made with the secret key
 * against the local stack and removed again by `removeFixtures`. Never run against production.
 */
import sharp from "sharp";
import { adminClient, deleteUser, supabaseUrl } from "../../tests/e2e/fixtures/auth";

const IVORY = "00000000-0000-4000-8000-000000000002";
const SMOKE = "00000000-0000-4000-8000-000000000003";
const BUCKET = "page-media";

export interface Fixture {
  name: string;
  handle: string;
  /** The path audited on the handle's host; "/" when absent. */
  path?: string;
}

const BLOG_HANDLE = "lh-blog";

export const FIXTURES: Fixture[] = [
  { name: "ivory", handle: "lh-ivory" },
  { name: "smoke", handle: "lh-smoke" },
  { name: "free-badge", handle: "lh-free" },
  { name: "avatar-bg", handle: "lh-media" },
  { name: "blog-archive", handle: BLOG_HANDLE, path: "/blog" },
  { name: "blog-post", handle: BLOG_HANDLE, path: "/blog/lh-post-1" },
];

type Doc = Record<string, unknown> & { profile: Record<string, unknown> };

/** A copy of the document without its menu (the fixtures have no sub-pages). */
function withoutNav(doc: Doc): Doc {
  const copy = { ...doc };
  delete copy.nav;
  return copy;
}

const userIds: string[] = [];

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) throw new Error(`${what}: ${result.error?.message}`);
  return result.data;
}

async function themeTokens(id: string): Promise<Record<string, unknown>> {
  const row = must(
    await adminClient().from("themes").select("tokens").eq("id", id).single(),
    "theme lookup",
  );
  return (row as unknown as { tokens: Record<string, unknown> }).tokens;
}

async function upload(path: string, image: Buffer): Promise<void> {
  const { error } = await adminClient()
    .storage.from(BUCKET)
    .upload(path, image, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

async function makeOwner(handle: string, plan: "free" | "pro"): Promise<string> {
  const admin = adminClient();
  const created = await admin.auth.admin.createUser({
    email: `zq-${handle}@example.com`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const id = created.data.user.id;
  userIds.push(id);
  if (plan !== "free") {
    const patch = await admin.from("accounts").update({ paid_plan: plan }).eq("id", id);
    if (patch.error) throw new Error(`plan: ${patch.error.message}`);
  }
  return id;
}

/** Removes any lh-* users left by an earlier run, then makes the pages. */
export async function createFixtures(): Promise<Fixture[]> {
  await removeStale();
  const admin = adminClient();
  const mara = must(
    await admin.from("pages").select("draft, published").eq("handle", "mara").single(),
    "the seeded page 'mara' (run scripts/init.sh)",
  ) as { draft: Doc; published: Doc };

  const specs: Array<{ f: Fixture; plan: "free" | "pro"; theme: string }> = [
    { f: FIXTURES[0]!, plan: "pro", theme: IVORY },
    { f: FIXTURES[1]!, plan: "pro", theme: SMOKE },
    { f: FIXTURES[2]!, plan: "free", theme: "00000000-0000-4000-8000-000000000001" },
    { f: FIXTURES[3]!, plan: "free", theme: IVORY },
  ];

  specs.push({ f: FIXTURES[4]!, plan: "pro", theme: IVORY });

  for (const { f, plan, theme } of specs) {
    const owner = await makeOwner(f.handle, plan);
    const tokens = { ...(await themeTokens(theme)) };
    const profile = { ...mara.published.profile };
    if (f.handle === "lh-media") {
      const avatar = `${owner}/lh-avatar-0001.webp`;
      const bg = `${owner}/lh-bg-00000001.webp`;
      await upload(
        avatar,
        await sharp({ create: { width: 400, height: 400, channels: 3, background: "#b08968" } })
          .webp()
          .toBuffer(),
      );
      const gradient = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8dcc8"/><stop offset="1" stop-color="#cdb99a"/></linearGradient></defs><rect width="1440" height="900" fill="url(#g)"/></svg>`,
      );
      await upload(bg, await sharp(gradient).webp({ quality: 60 }).toBuffer());
      profile.photo = { path: avatar, width: 400, height: 400 };
      tokens.bgType = "image";
      tokens.bgImage = `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${bg}`;
      tokens.overlayOpacity = 0.35;
    }
    const published = {
      ...withoutNav(mara.published),
      profile,
      theme: { ref: theme, overrides: {} },
      tokens,
    };
    const draft = { ...withoutNav(mara.draft), profile, theme: { ref: theme, overrides: {} } };
    const page = must(
      await admin
        .from("pages")
        .insert({
          owner_id: owner,
          handle: f.handle,
          draft,
          published,
          published_at: new Date().toISOString(),
        })
        .select("id")
        .single(),
      `insert ${f.handle}`,
    ) as { id: string };
    if (f.handle === BLOG_HANDLE) await makeBlog(page.id, owner);
  }
  return FIXTURES;
}

const POST_BODY = (image: string) =>
  [
    "The first paragraph of the post, long enough to wrap over a few lines on a phone so the audit measures real reading text and not a single short line.",
    "## A heading in the body",
    "- one thing\n- another thing\n- a third thing",
    "> A short quote from somebody.",
    `![A photo from the studio](${image})`,
    '```\nconst greeting = "hello";\n```',
    "| Day | Hours |\n|---|---|\n| Monday | 9 to 5 |\n| Tuesday | 9 to 5 |",
    "A closing paragraph with a [link](https://example.com/) in it.",
  ].join("\n\n");

/**
 * Turns the fixture site's blog on and publishes 12 posts through the real `publish_entry` (the
 * writer's own path): post 1 is the newest and has a featured image and an image in its body.
 */
async function makeBlog(siteId: string, owner: string): Promise<void> {
  const admin = adminClient();
  const type = must(
    await admin
      .from("content_types")
      .update({ enabled: true })
      .eq("site_id", siteId)
      .eq("key", "post")
      .select("id")
      .single(),
    "turning the blog on",
  ) as { id: string };
  const featured = `${owner}/lh-featured-01.webp`;
  const inline = `${owner}/lh-inline-0001.webp`;
  const picture = (color: string) =>
    sharp({ create: { width: 1200, height: 675, channels: 3, background: color } })
      .webp({ quality: 60 })
      .toBuffer();
  await upload(featured, await picture("#c9b08a"));
  await upload(inline, await picture("#8a9cb0"));
  const stored = (path: string) => `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}`;
  for (let n = 12; n >= 1; n -= 1) {
    const document = {
      title: `Notes from the studio, part ${n}`,
      slug: `lh-post-${n}`,
      excerpt: `A short summary of part ${n}, as an archive card shows it.`,
      body: n === 1 ? POST_BODY(stored(inline)) : `Part ${n} of the notes.`,
      ...(n === 1 ? { featuredImage: { path: featured, width: 1200, height: 675 } } : {}),
    };
    const entry = must(
      await admin
        .from("content_entries")
        .insert({ site_id: siteId, type_id: type.id, draft: document as never })
        .select("id, rev")
        .single(),
      `insert post ${n}`,
    ) as { id: string; rev: number };
    const published = await admin.rpc("publish_entry", {
      p_entry_id: entry.id,
      p_owner_id: owner,
      p_expected_rev: Number(entry.rev),
      p_published: document as never,
      p_published_at: new Date(Date.now() - n * 86_400_000).toISOString(),
    });
    if (published.error) throw new Error(`publish post ${n}: ${published.error.message}`);
  }
}

async function removeStale(): Promise<void> {
  const admin = adminClient();
  // One user per handle (the two blog targets share a site).
  const wanted = new Set(FIXTURES.map((f) => `zq-${f.handle}@example.com`));
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (!data) break;
    for (const user of data.users) {
      if (user.email && wanted.has(user.email)) await deleteUser(user.id).catch(() => undefined);
    }
    if (data.users.length < 200) break;
  }
}

/** Deletes the fixture users (their pages go with them) and their Storage files. */
export async function removeFixtures(): Promise<void> {
  const admin = adminClient();
  for (const id of userIds.splice(0)) {
    const files = await admin.storage.from(BUCKET).list(id);
    const names = (files.data ?? []).map((file) => `${id}/${file.name}`);
    if (names.length > 0) await admin.storage.from(BUCKET).remove(names);
    await deleteUser(id).catch(() => undefined);
  }
}
