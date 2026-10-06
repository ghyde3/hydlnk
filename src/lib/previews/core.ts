import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { PREVIEW_LINK_MESSAGES, PREVIEW_LINK_STATUS } from "./messages";
import { generatePreviewToken, hashPreviewToken } from "./token";
import type {
  CreatePreviewLinkResult,
  ListPreviewLinksResult,
  PreviewLinkFailure,
  PreviewLinkRefusal,
  RevokePreviewLinkResult,
} from "./types";

/**
 * The logic behind the preview-link Server Actions (M6-09), written against injected dependencies so
 * tests drive it without Next.js; production code calls the actions in "./actions", which supply the
 * secret-key client, the session and the real rate limiter. `userId` MUST be the verified session
 * user, never request input.
 *
 * Every call checks the page (or the link's page) belongs to `userId` itself: the secret key skips
 * RLS, so this is the access rule. A page or link of another account, a random id and a malformed id
 * all answer `not_found` and change nothing. The token is built here, hashed here and returned once;
 * it is never logged, never stored and never part of an error.
 */

export interface PreviewDeps {
  /** The secret-key client. */
  admin: SupabaseClient<Database>;
  /** Is this account suspended right now (read fresh)? A failed read throws. */
  isSuspended: (userId: string) => Promise<boolean>;
  /** `rateLimit(key, limit, windowSeconds)`. */
  limit: (
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<{ allowed: boolean; retryAfter: number }>;
  /** `http://app.localhost:3000`: where the share route lives. */
  appOrigin: string;
  /** Test seam: a token generator (production uses the CSPRNG). */
  newToken?: () => string;
}

/** Creates per hour per account, then 429 `rate_limited`. */
export const PREVIEW_LINK_CREATES_PER_HOUR = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(reason: PreviewLinkFailure): PreviewLinkRefusal {
  return {
    ok: false,
    reason,
    status: PREVIEW_LINK_STATUS[reason],
    message: PREVIEW_LINK_MESSAGES[reason],
  };
}

/** Logs what went wrong without a token, a hash or an address in it. */
function logFailure(action: string, error: { code?: string; message: string } | Error): void {
  const code = "code" in error && error.code ? ` ${error.code}` : "";
  console.error(`[previews] ${action} failed:${code} ${error.message}`);
}

/** Whether `userId` owns `pageId`; null for no such page (the caller answers not_found). */
async function ownsPage(admin: SupabaseClient<Database>, userId: string, pageId: string) {
  if (!UUID.test(pageId)) return false;
  const { data, error } = await admin
    .from("pages")
    .select("id, owner_id")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Reading the page failed: ${error.message}`);
  return data !== null && data.owner_id === userId;
}

export async function createPreviewLinkCore(
  deps: PreviewDeps,
  userId: string | null,
  pageId: unknown,
): Promise<CreatePreviewLinkResult> {
  if (!userId) return refuse("unauthorized");
  if (typeof pageId !== "string") return refuse("not_found");
  try {
    if (!(await ownsPage(deps.admin, userId, pageId))) return refuse("not_found");
    // A suspended owner (M5-09) cannot create links; reads and turning links off stay allowed.
    if (await deps.isSuspended(userId)) return refuse("account_suspended");

    const verdict = await deps.limit(
      `preview-link:${userId}`,
      PREVIEW_LINK_CREATES_PER_HOUR,
      60 * 60,
    );
    if (!verdict.allowed) return refuse("rate_limited");

    const token = (deps.newToken ?? generatePreviewToken)();
    // `expires_at` is the database default (now() + 7 days), never the caller's value.
    const { data, error } = await deps.admin
      .from("preview_links")
      .insert({ page_id: pageId, token_hash: hashPreviewToken(token) })
      .select("id, expires_at")
      .single();
    if (error) {
      // HL006: the page already has 5 active links (the trigger counts by the database clock).
      if (error.code === "HL006") return refuse("preview_link_limit");
      logFailure("create", error);
      return refuse("failed");
    }
    return {
      ok: true,
      id: data.id,
      url: `${deps.appOrigin}/share/${token}`,
      expiresAt: data.expires_at,
    };
  } catch (error) {
    logFailure("create", error instanceof Error ? error : new Error("unknown error"));
    return refuse("failed");
  }
}

export async function listPreviewLinksCore(
  deps: PreviewDeps,
  userId: string | null,
  pageId: unknown,
): Promise<ListPreviewLinksResult> {
  if (!userId) return refuse("unauthorized");
  if (typeof pageId !== "string") return refuse("not_found");
  try {
    if (!(await ownsPage(deps.admin, userId, pageId))) return refuse("not_found");
    const { data, error } = await deps.admin
      .from("preview_links")
      .select("id, created_at, expires_at")
      .eq("page_id", pageId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Reading the links failed: ${error.message}`);
    return {
      ok: true,
      links: data.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      })),
    };
  } catch (error) {
    logFailure("list", error instanceof Error ? error : new Error("unknown error"));
    return refuse("failed");
  }
}

export async function revokePreviewLinkCore(
  deps: PreviewDeps,
  userId: string | null,
  linkId: unknown,
): Promise<RevokePreviewLinkResult> {
  if (!userId) return refuse("unauthorized");
  if (typeof linkId !== "string" || !UUID.test(linkId)) return refuse("not_found");
  try {
    const found = await deps.admin
      .from("preview_links")
      .select("id, pages!inner(owner_id)")
      .eq("id", linkId)
      .maybeSingle();
    if (found.error) throw new Error(`Reading the link failed: ${found.error.message}`);
    if (!found.data || found.data.pages.owner_id !== userId) return refuse("not_found");

    // Only a link that is still on gets a time: turning it off twice leaves the first time.
    const { error } = await deps.admin
      .from("preview_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", linkId)
      .is("revoked_at", null);
    if (error) throw new Error(`Turning the link off failed: ${error.message}`);
    return { ok: true };
  } catch (error) {
    logFailure("revoke", error instanceof Error ? error : new Error("unknown error"));
    return refuse("failed");
  }
}
