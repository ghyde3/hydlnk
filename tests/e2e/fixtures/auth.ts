import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { url } from "../helpers";

/**
 * The one auth fixture for every spec (M1-04). Sibling modules: http.ts (raw requests, cookies,
 * PostgREST as a user), data.ts (test users, pages and cleanup), mailpit.ts (the local inbox) and
 * a11y.ts (axe).
 *
 * Sign-in helpers for signed-in specs. Nothing here reads the inbox: the sign-in link is
 * generated with the secret key (auth admin generateLink) and opened through the real
 * /auth/callback, so the session cookies come from the same code path a user's link takes.
 *
 *   const { userId, handle } = await signInAs(context, "zq-foo-1@example.com", { handle: "zq-foo-1" });
 *   await page.goto(url("app", "/editor"));
 */

let envCache: Record<string, string> | undefined;

/** Local keys: process.env wins, .env.local (written by scripts/init.sh) fills the rest. Never log them. */
function readEnv(name: string): string {
  if (process.env[name]) return process.env[name]!;
  if (!envCache) {
    envCache = {};
    try {
      const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match) envCache[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
      }
    } catch {
      // fall through to the error below
    }
  }
  const value = envCache[name];
  if (!value) throw new Error(`${name} is not set (process.env or .env.local)`);
  return value;
}

export const supabaseUrl = (): string => readEnv("NEXT_PUBLIC_SUPABASE_URL");
export const publishableKey = (): string => readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

/** supabase-js client acting as a signed-in user (publishable key plus their JWT): RLS applies. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl(), publishableKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Secret-key supabase-js client for test setup and assertions. Bypasses RLS. */
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), readEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type Plan = "free" | "pro" | "studio";

export interface SignedIn {
  userId: string;
  email: string;
  handle?: string;
  pageId?: string;
}

/** Looks a user up by email through the admin API (listUsers has no email filter). */
export async function findUserId(
  admin: SupabaseClient,
  email: string,
): Promise<string | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

async function ensureUser(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (data?.user) return data.user.id;
  // Already registered: createUser fails with email_exists. Anything else is a real error.
  if (error && !/already|exists|registered/i.test(`${error.code ?? ""} ${error.message}`)) {
    throw new Error(`createUser(${email}) failed: ${error.message}`);
  }
  const id = await findUserId(admin, email);
  if (!id) throw new Error(`user ${email} neither created nor found`);
  return id;
}

/**
 * Creates `handle` as a published page owned by `userId` (secret key, like the real claim flow
 * will), copying the seeded demo page's documents so the tenant page renders. Reuses the user's own
 * page when it already exists. Returns the page id.
 */
async function ensurePage(admin: SupabaseClient, userId: string, handle: string): Promise<string> {
  const existing = await admin
    .from("pages")
    .select("id, owner_id")
    .eq("handle", handle)
    .maybeSingle();
  if (existing.error) throw new Error(`pages lookup failed: ${existing.error.message}`);
  if (existing.data) {
    if (existing.data.owner_id !== userId)
      throw new Error(`handle ${handle} belongs to another user`);
    return existing.data.id as string;
  }
  const mara = await admin
    .from("pages")
    .select("draft, published, published_at")
    .eq("handle", "mara")
    .single();
  if (mara.error) throw new Error(`seed page 'mara' missing: ${mara.error.message}`);
  const rename = (doc: unknown) => {
    const copy = JSON.parse(JSON.stringify(doc));
    copy.profile.displayName = handle;
    return copy;
  };
  const inserted = await admin
    .from("pages")
    .insert({
      owner_id: userId,
      handle,
      draft: rename(mara.data.draft),
      published: rename(mara.data.published),
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(`creating page ${handle} failed: ${inserted.error.message}`);
  return inserted.data.id as string;
}

/**
 * Creates the user if needed, optionally sets the plan and creates a published page, then signs
 * `context` in by opening a freshly generated link through http://app.localhost:3000/auth/callback.
 * Resolves when the host-only auth cookie is in the context.
 */
export async function signInAs(
  context: BrowserContext,
  email: string,
  opts: { handle?: string; plan?: Plan } = {},
): Promise<SignedIn> {
  const admin = adminClient();
  const userId = await ensureUser(admin, email);

  // The signup trigger makes the row; the upsert covers a deleted one. Plan only when asked, so a
  // later sign-in never resets what a test set.
  const account = await admin
    .from("accounts")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (account.error) throw new Error(`accounts upsert failed: ${account.error.message}`);
  if (opts.plan) {
    const { error } = await admin.from("accounts").update({ plan: opts.plan }).eq("id", userId);
    if (error) throw new Error(`setting plan failed: ${error.message}`);
  }
  const pageId = opts.handle ? await ensurePage(admin, userId, opts.handle) : undefined;

  // Generating a link replaces the user's previous one, so two workers signing in as the same
  // address at once (phone and desktop projects) can invalidate each other's link. Retry with a
  // fresh link until the session cookie lands.
  for (let attempt = 1; ; attempt++) {
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const hashedToken = link.data?.properties?.hashed_token;
    if (link.error || !hashedToken) throw new Error(`generateLink failed: ${link.error?.message}`);

    await openCallback(context, hashedToken);
    const cookies = await context.cookies(url("app"));
    if (cookies.some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) break;
    if (attempt >= 5)
      throw new Error("signInAs: the callback set no sb- auth cookie on app.localhost");
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 500));
  }
  return { userId, email, handle: opts.handle, pageId };
}

/** Opens /auth/callback?token_hash=... in `context` and stops once the session cookie is set. */
export async function openCallback(
  context: BrowserContext,
  hashedToken: string,
  type = "email",
): Promise<void> {
  const target = url(
    "app",
    `/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=${type}`,
  );
  // A browser page, not context.request: Node's resolver does not reliably map *.localhost to
  // loopback, Chromium does. The redirect chain is cut short once the cookie is stored.
  const page = await context.newPage();
  try {
    await page.route("**/*", async (route) => {
      const requested = new URL(route.request().url());
      // Everything after the callback itself (the "/" gate and onward) is irrelevant here.
      if (requested.host === "app.localhost:3000" && requested.pathname !== "/auth/callback") {
        await route.fulfill({ status: 200, contentType: "text/plain", body: "signed in" });
      } else {
        await route.continue();
      }
    });
    await page.goto(target, { waitUntil: "commit" });
  } finally {
    await page.close();
  }
}

/** Generates a fresh sign-in token hash for `email` (creating the user), without opening it. */
export async function generateTokenHash(
  email: string,
): Promise<{ userId: string; hashedToken: string }> {
  const admin = adminClient();
  const userId = await ensureUser(admin, email);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashedToken = link.data?.properties?.hashed_token;
  if (link.error || !hashedToken) throw new Error(`generateLink failed: ${link.error?.message}`);
  return { userId, hashedToken };
}

/** Deletes a test user (and, by cascade, the accounts row and pages). Best effort. */
export async function deleteUser(userId: string): Promise<void> {
  await adminClient().auth.admin.deleteUser(userId);
}
