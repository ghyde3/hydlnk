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
    const { error } = await admin.from("accounts").update({ plan }).eq("id", userId);
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
