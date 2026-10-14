import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyDraft, type Block, type DraftDoc } from "@/lib/document";

/**
 * Shared setup for the publishing integration tests (M2-23, M2-25, M2-26...): they run against the
 * local Supabase stack with the secret key from .env.local, and are skipped when it is not there,
 * unless REQUIRE_SUPABASE=1 (then a missing stack fails the run).
 */

export function loadEnvLocal(): boolean {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !process.env[match[1]!])
        process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
    }
    return Boolean(process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return false;
  }
}

export async function stackIsUp(): Promise<{ run: boolean }> {
  const haveEnv = loadEnvLocal();
  let up = false;
  if (haveEnv) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
        signal: AbortSignal.timeout(2000),
      });
      up = res.ok;
    } catch {
      up = false;
    }
  }
  if (process.env.REQUIRE_SUPABASE === "1" && !(haveEnv && up)) {
    throw new Error(
      "REQUIRE_SUPABASE=1, but the local Supabase stack or .env.local is not available",
    );
  }
  return { run: haveEnv && up };
}

export const rand = (n = 6) =>
  Math.random()
    .toString(36)
    .slice(2, 2 + n)
    .padEnd(n, "0");

export interface TestOwner {
  userId: string;
  email: string;
  pageId: string;
  handle: string;
}

/** A confirmed user with a free account and one page holding `draft` (the secret key writes it). */
export async function makeOwner(
  admin: SupabaseClient,
  label: string,
  draft: (handle: string) => unknown = (handle) => emptyDraft(handle),
  plan: "free" | "pro" | "studio" = "free",
): Promise<TestOwner> {
  const tag = rand(6);
  const email = `zq-${label}-${tag}@example.com`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const userId = created.data.user.id;
  if (plan !== "free") {
    const { error } = await admin.from("accounts").update({ paid_plan: plan }).eq("id", userId);
    if (error) throw new Error(`plan: ${error.message}`);
  }
  const handle = `zq-${label}-${tag}`;
  const page = await admin
    .from("pages")
    .insert({ owner_id: userId, handle, draft: draft(handle) as never })
    .select("id")
    .single();
  if (page.error) throw new Error(`page: ${page.error.message}`);
  return { userId, email, pageId: page.data.id as string, handle };
}

/**
 * Move a site the way stage 1b does for a Free-to-Studio account: Home's blocks become the '/' page
 * entry (a copy), and the site row keeps the same document as its frozen copy. Opt-in, for tests of
 * code that reads Home from its entry (Publish); makeOwner alone gives the pre-move layout.
 */
export async function moveHome(admin: SupabaseClient, pageId: string): Promise<string> {
  const row = await admin.from("pages").select("draft").eq("id", pageId).single();
  if (row.error) throw new Error(`moveHome: ${row.error.message}`);
  const blocks = (row.data.draft as { blocks?: unknown } | null)?.blocks ?? [];
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", pageId)
    .eq("key", "page")
    .single();
  if (type.error) throw new Error(`moveHome: ${type.error.message}`);
  const made = await admin
    .from("content_entries")
    .insert({
      site_id: pageId,
      type_id: type.data.id,
      draft: { path: "/", title: "", description: "", blocks } as never,
    })
    .select("id")
    .single();
  if (made.error) throw new Error(`moveHome: ${made.error.message}`);
  return made.data.id as string;
}

/**
 * Save a whole page document the way the editor now does (stage 1b): everything but `blocks` goes to
 * `pages.draft` (whose frozen blocks stay untouched, or the guard refuses with HL013), and `blocks` to
 * Home's page entry, created when the site has none. A document without `blocks` leaves Home's blocks as
 * they are. Returns the first error, shaped like a Supabase result.
 */
export async function setPageDraft(
  admin: SupabaseClient,
  pageId: string,
  doc: unknown,
): Promise<{ error: { message: string; code?: string } | null }> {
  const { blocks, ...design } = (doc ?? {}) as { blocks?: unknown } & Record<string, unknown>;
  const current = await admin.from("pages").select("draft").eq("id", pageId).single();
  if (current.error) return { error: current.error };
  const frozen = (current.data.draft as { blocks?: unknown } | null)?.blocks ?? [];
  const saved = await admin
    .from("pages")
    .update({ draft: { ...design, blocks: frozen } as never })
    .eq("id", pageId);
  if (saved.error) return { error: saved.error };
  if (blocks === undefined) return { error: null };
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", pageId)
    .eq("key", "page")
    .single();
  if (type.error) return { error: type.error };
  const entry = { path: "/", title: "", description: "", blocks };
  const home = await admin
    .from("content_entries")
    .select("id")
    .eq("site_id", pageId)
    .eq("type_id", type.data.id)
    .eq("draft->>path", "/")
    .maybeSingle();
  if (home.error) return { error: home.error };
  const written = home.data
    ? await admin
        .from("content_entries")
        .update({ draft: entry as never })
        .eq("id", home.data.id)
    : await admin
        .from("content_entries")
        .insert({ site_id: pageId, type_id: type.data.id, draft: entry as never });
  return { error: written.error };
}

export async function removeOwners(admin: SupabaseClient, owners: TestOwner[]): Promise<void> {
  await Promise.all(
    owners.map((o) => admin.auth.admin.deleteUser(o.userId).catch(() => undefined)),
  );
}

/** A complete, publishable draft; `blocks` replace the default one link. */
export function draftOf(
  name: string,
  blocks: Block[] = [
    {
      id: "lnk-aaaaaaaa",
      type: "link",
      visible: true,
      label: "Book",
      url: "https://example.com/book",
    },
  ],
  extra: Partial<DraftDoc> = {},
): DraftDoc {
  return {
    version: 1,
    rev: 1,
    profile: { name, bio: "A bio.", photo: null },
    theme: { ref: null, overrides: {} },
    blocks,
    ...extra,
  };
}

export async function publishedOf(admin: SupabaseClient, pageId: string) {
  const { data, error } = await admin
    .from("pages")
    .select("published, published_at")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return data as { published: unknown; published_at: string | null };
}
