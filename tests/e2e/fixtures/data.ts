import { createClient } from "@supabase/supabase-js";
import type { BrowserContext, TestInfo } from "@playwright/test";
import { emptyDraft } from "@/lib/document";
import {
  adminClient,
  deleteUser,
  findUserId,
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
  if (opts.plan) patch.plan = opts.plan;
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

/** Direct page insert: an empty draft, unpublished, unless `extra` says otherwise. */
export async function insertPage(
  ownerId: string,
  handle: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("pages")
    .insert({ owner_id: ownerId, handle, draft: emptyDraft(handle), ...extra })
    .select("id")
    .single();
  if (error) throw new Error(`insertPage(${handle}) failed: ${error.message}`);
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
  const { error } = await adminClient().from("accounts").update({ plan }).eq("id", userId);
  if (error) throw new Error(`setPlan failed: ${error.message}`);
}

/** published_at null (draft only) or now. */
export async function setPublished(pageId: string, published: boolean): Promise<void> {
  const admin = adminClient();
  const page = await admin.from("pages").select("draft").eq("id", pageId).single();
  if (page.error) throw new Error(page.error.message);
  const { error } = await admin
    .from("pages")
    .update(
      published
        ? { published: page.data.draft, published_at: new Date().toISOString() }
        : { published: null, published_at: null },
    )
    .eq("id", pageId);
  if (error) throw new Error(`setPublished failed: ${error.message}`);
}
