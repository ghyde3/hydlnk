import { createClient } from "@supabase/supabase-js";
import type { BrowserContext, TestInfo } from "@playwright/test";
import { emptyDraft } from "@/lib/document";
import {
  adminClient,
  deleteUser,
  findUserId,
  moveSite,
  publishableKey,
  signInAs,
  supabaseUrl,
  type Plan,
} from "./auth";

/**
 * Test data and cleanup for the specs that create users and pages with the secret key. Every user
 * made here (or registered with trackUser / trackEmail) is removed again by cleanupUsers, so a spec
 * file ends with
 *
 *   test.afterAll(cleanupUsers);
 *
 * The tracker is module state, which is per Playwright worker: a worker runs one spec file at a time,
 * so a file's cleanup only ever sees that file's users.
 */

/** Random lowercase letters and digits (default 6). */
export function rand(length = 6): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + length)
    .padEnd(length, "0");
}

/** `zq-<label>-<random>`: a label that is safe in an email local part and in a handle. */
export const uniq = (label: string): string =>
  `zq-${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const desktopOnly = (info: TestInfo): boolean => info.project.name === "desktop";
export const phoneOnly = (info: TestInfo): boolean => info.project.name === "phone";

// ---------------------------------------------------------------------------------------------
// Users and cleanup
// ---------------------------------------------------------------------------------------------

const createdIds: string[] = [];
const createdEmails: string[] = [];

/** Remember a user id (made by a flow under test) for cleanupUsers. */
export function trackUser(id: string): void {
  createdIds.push(id);
}

/** Remember an address whose user a flow creates (signup, sign-in link): cleanupUsers removes it. */
export function trackEmail(email: string): void {
  createdEmails.push(email.toLowerCase());
}

/** Deletes every tracked user (their account and pages go with them). Best effort. */
export async function cleanupUsers(): Promise<void> {
  const ids = new Set(createdIds.splice(0));
  const wanted = new Set(createdEmails.splice(0));
  if (wanted.size > 0) {
    const admin = adminClient();
    // listUsers has no email filter: scan the pages once for all wanted addresses.
    for (let page = 1; page <= 20 && wanted.size > 0; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (!data) break;
      for (const user of data.users) {
        if (user.email && wanted.has(user.email.toLowerCase())) ids.add(user.id);
      }
      if (data.users.length < 200) break;
    }
  }
  await Promise.all([...ids].map((id) => deleteUser(id).catch(() => undefined)));
}

/** The auth user id for an address (remembered for cleanup), or undefined. */
export async function userIdByEmail(email: string): Promise<string | undefined> {
  const id = await findUserId(adminClient(), email);
  if (id) createdIds.push(id);
  return id;
}

export interface TestUser {
  id: string;
  email: string;
}

/** A fresh confirmed user (the signup trigger adds the accounts row), removed by cleanupUsers(). */
export async function makeUser(
  label: string,
  opts: { plan?: Plan; suspended?: boolean } = {},
): Promise<TestUser> {
  const admin = adminClient();
  const email = `zq-${label}-${rand()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  trackUser(data.user.id);
  const patch: Record<string, unknown> = {};
  // paid_plan, not plan: the database derives the effective plan from it (M13-07).
  if (opts.plan) patch.paid_plan = opts.plan;
  if (opts.suspended) patch.suspended_at = new Date().toISOString();
  if (Object.keys(patch).length > 0) {
    const update = await admin.from("accounts").update(patch).eq("id", data.user.id);
    if (update.error) throw new Error(`account update failed: ${update.error.message}`);
  }
  return { id: data.user.id, email };
}

/** signInAs, remembered for cleanup. */
export async function signIn(
  context: BrowserContext,
  email: string,
  opts: { handle?: string; plan?: Plan } = {},
) {
  const result = await signInAs(context, email, opts);
  trackUser(result.userId);
  return result;
}

export interface SignedInUser {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
}

/** Creates a user with one published page and signs `context` in as them (remembered for cleanup). */
export async function signedInUser(
  context: BrowserContext,
  opts: { label?: string; plan?: Plan; handle?: string; email?: string } = {},
): Promise<SignedInUser> {
  const tag = rand(5);
  const label = opts.label ?? "sh";
  const handle = opts.handle ?? `zq-${label}-${tag}`;
  const email = opts.email ?? `e2e-${label}-${tag}@example.com`;
  const signedIn = await signIn(context, email, { handle, plan: opts.plan });
  return { userId: signedIn.userId, email, handle, pageId: signedIn.pageId! };
}

/** A real access token for `email` (the secret key mints the link, the publishable key verifies it). */
export async function accessTokenFor(email: string): Promise<string> {
  const admin = adminClient();
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) throw new Error(`generateLink failed: ${link.error?.message}`);
  const anon = createClient(supabaseUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const verified = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  const token = verified.data.session?.access_token;
  if (verified.error || !token) throw new Error(`verifyOtp failed: ${verified.error?.message}`);
  return token;
}

// ---------------------------------------------------------------------------------------------
// Pages and plans (secret key, test setup only)
// ---------------------------------------------------------------------------------------------

export { moveSite };

/**
 * Publishes `doc` (a publish form with its blocks) on a moved site the way Publish does: Home's
 * entry gets the blocks, the pages row the design. For a test that wants the live page to change
 * "around" the validation; the site must have no sub-pages (publish_site is given none).
 */
export async function publishHome(pageId: string, doc: unknown, publishedAt?: string): Promise<void> {
  const admin = adminClient();
  const owner = await admin.from("pages").select("owner_id").eq("id", pageId).single();
  if (owner.error) throw new Error(`publishHome lookup failed: ${owner.error.message}`);
  // publish_site names exactly the live sub-page entries; each keeps the live form it has now.
  const subs = await admin
    .from("content_entries")
    .select("id, published, draft")
    .eq("site_id", pageId)
    .is("deleted_at", null)
    .neq("draft->>path", "/");
  if (subs.error) throw new Error(`publishHome sub-pages failed: ${subs.error.message}`);
  const done = await admin.rpc("publish_site", {
    p_page_id: pageId,
    p_owner_id: owner.data.owner_id,
    p_home: doc as never,
    p_sub_pages: subs.data.map((row) => ({ id: row.id, published: row.published })) as never,
    p_published_at: publishedAt ?? new Date().toISOString(),
  });
  if (done.error) throw new Error(`publish_site failed: ${done.error.message}`);
}

/**
 * Direct page insert: an empty draft, unpublished, unless `extra` says otherwise. The site is then
 * moved into page entries (Home's '/' entry), as a claimed site is; `{ move: false }` keeps the old layout.
 */
export async function insertPage(
  ownerId: string,
  handle: string,
  extra: Record<string, unknown> = {},
  opts: { move?: boolean } = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("pages")
    .insert({ owner_id: ownerId, handle, draft: emptyDraft(handle), ...extra })
    .select("id")
    .single();
  if (error) throw new Error(`insertPage(${handle}) failed: ${error.message}`);
  if (opts.move !== false) await moveSite(data.id as string);
  return data.id as string;
}

/** Adds a second (draft only) page for a user; copies the seeded demo page's draft document. */
export async function addPage(userId: string, handle: string): Promise<string> {
  const admin = adminClient();
  const mara = await admin.from("pages").select("draft").eq("handle", "mara").single();
  if (mara.error) throw new Error(`seed page missing: ${mara.error.message}`);
  const inserted = await admin
    .from("pages")
    .insert({ owner_id: userId, handle, draft: mara.data.draft })
    .select("id")
    .single();
  if (inserted.error) throw new Error(`addPage failed: ${inserted.error.message}`);
  await moveSite(inserted.data.id as string);
  return inserted.data.id as string;
}

export async function pagesOf(ownerId: string) {
  const { data, error } = await adminClient()
    .from("pages")
    .select("id, owner_id, handle, draft, published, published_at")
    .eq("owner_id", ownerId);
  if (error) throw new Error(`pagesOf failed: ${error.message}`);
  return data;
}

export async function pageCountForHandle(handle: string): Promise<number> {
  const { count, error } = await adminClient()
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("handle", handle);
  if (error) throw new Error(`count failed: ${error.message}`);
  return count ?? 0;
}

export async function setPlan(userId: string, plan: Plan): Promise<void> {
  const { error } = await adminClient()
    .from("accounts")
    .update({ paid_plan: plan })
    .eq("id", userId);
  if (error) throw new Error(`setPlan failed: ${error.message}`);
}

/**
 * published_at null (draft only) or now. On a moved site this goes through publish_site /
 * unpublish_site (Home's entry holds the blocks, the pages row the design), so the live page shows
 * the draft exactly; a site kept in the old layout (`{ move: false }`) is updated in place.
 */
export async function setPublished(pageId: string, published: boolean): Promise<void> {
  const admin = adminClient();
  const page = await admin.from("pages").select("owner_id, draft").eq("id", pageId).single();
  if (page.error) throw new Error(page.error.message);
  const entries = await admin
    .from("content_entries")
    .select("id, draft, published, content_types!inner(key)")
    .eq("site_id", pageId)
    .eq("content_types.key", "page")
    .is("deleted_at", null);
  if (entries.error) throw new Error(`setPublished lookup failed: ${entries.error.message}`);
  const isHome = (e: { draft: unknown; published: unknown }) =>
    (e.draft as { path?: string } | null)?.path === "/" ||
    (e.published as { path?: string } | null)?.path === "/";
  const home = entries.data.find(isHome);
  if (!home) {
    const { error } = await admin
      .from("pages")
      .update(
        published
          ? { published: page.data.draft, published_at: new Date().toISOString() }
          : { published: null, published_at: null },
      )
      .eq("id", pageId);
    if (error) throw new Error(`setPublished failed: ${error.message}`);
    return;
  }
  if (!published) {
    const done = await admin.rpc("unpublish_site", {
      p_page_id: pageId,
      p_owner_id: page.data.owner_id,
    });
    if (done.error) throw new Error(`unpublish_site failed: ${done.error.message}`);
    return;
  }
  // Sub-pages keep their live copy as it is; only Home (and the design) go live from the draft.
  const subPages = entries.data
    .filter((e) => !isHome(e))
    .map((e) => ({ id: e.id, published: e.published }));
  const blocks = (home.draft as { blocks?: unknown[] }).blocks ?? [];
  const done = await admin.rpc("publish_site", {
    p_page_id: pageId,
    p_owner_id: page.data.owner_id,
    p_home: { ...(page.data.draft as object), blocks } as never,
    p_sub_pages: subPages as never,
    p_published_at: new Date().toISOString(),
  });
  if (done.error) throw new Error(`publish_site failed: ${done.error.message}`);
}
