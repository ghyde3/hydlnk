/**
 * Pages for `pnpm lighthouse` (M5-21): four published tenant pages made from the seeded demo page
 * (every block type), so the audit covers more than `mara`:
 *
 *   lh-ivory  Ivory theme, Pro (no badge)
 *   lh-smoke  Smoke theme, Pro (no badge)
 *   lh-free   Noir theme, Free ("Made with HYDLNK" badge)
 *   lh-media  Ivory theme, Free, with a profile photo and a background image in Storage
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
}

export const FIXTURES: Fixture[] = [
  { name: "ivory", handle: "lh-ivory" },
  { name: "smoke", handle: "lh-smoke" },
  { name: "free-badge", handle: "lh-free" },
  { name: "avatar-bg", handle: "lh-media" },
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
    must(
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
    );
  }
  return FIXTURES;
}

async function removeStale(): Promise<void> {
  const admin = adminClient();
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
