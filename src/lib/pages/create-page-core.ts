import type { SupabaseClient } from "@supabase/supabase-js";
import { claimHandleWithClient, type ClaimError } from "@/lib/handles/claim-core";
import { normalizeHandle } from "@/lib/handles/rules";
import { describeHandleStatus, type HandleStatus } from "@/lib/handles/status";
import { pageLimitMessage, toPlanId } from "@/lib/limits";
import { DEFAULT_PAGE_NAME, defaultPageName } from "@/lib/pages/name";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Create another page for a signed-in account (M4-18), written against an injected secret-key
 * client so tests drive it without Next.js; production code calls `createPage` from "./create-page".
 *
 * It is the handle claim of Milestone 1 (`claimHandleWithClient`): the same normalization, rules,
 * reserved list, uniqueness and empty draft, and the database does the enforcing. The page limit is
 * the BEFORE INSERT trigger from the init migration (HL001), which locks the account row, so two
 * simultaneous creates at 2 of 3 yield exactly one new row; this layer only turns its refusal into
 * the plan's message. `userId` MUST be the verified session user, never request input.
 */

export type CreatePageError = ClaimError;

export type CreatePageResult =
  | { ok: true; pageId: string; handle: string }
  | { ok: false; status: number; error: CreatePageError; message: string };

/** HTTP status per failure: 403 for a limit or a blocked account, 409 taken, 422 an unusable handle. */
export const CREATE_PAGE_STATUS: Record<CreatePageError, number> = {
  short: 422,
  too_long: 422,
  invalid: 422,
  reserved: 422,
  taken: 409,
  page_limit: 403,
  no_account: 403,
  suspended: 403,
};

export const CREATE_FAILED_MESSAGE = "Couldn’t create that site. Try again.";
export const CREATE_SUSPENDED_MESSAGE = "This account can’t create sites.";

async function limitMessage(admin: SupabaseClient<Database>, userId: string): Promise<string> {
  const [account, pages] = await Promise.all([
    admin.from("accounts").select("plan").eq("id", userId).maybeSingle(),
    admin.from("pages").select("id", { count: "exact", head: true }).eq("owner_id", userId),
  ]);
  if (account.error) throw new Error(`Account lookup failed: ${account.error.message}`);
  if (pages.error) throw new Error(`Page count failed: ${pages.error.message}`);
  return pageLimitMessage(toPlanId(account.data?.plan), pages.count ?? 0);
}

/**
 * Names the page just created (M6-13): the account's first page is "Main site"; the next ones become "Site 2" and "Site 3" (the owner's site count after the insert). A
 * request body never names a page: this is the only place a created page gets its name. A failure
 * here is logged and ignored, because the page exists and "Main site" is a fine name for it.
 */
async function nameNewPage(
  admin: SupabaseClient<Database>,
  userId: string,
  pageId: string,
): Promise<void> {
  try {
    const count = await admin
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId);
    if (count.error) throw new Error(count.error.message);
    const name = defaultPageName(count.count ?? 1);
    if (name === DEFAULT_PAGE_NAME) return;
    const update = await admin.from("pages").update({ name }).eq("id", pageId);
    if (update.error) throw new Error(update.error.message);
  } catch (error) {
    console.error(
      "[pages] naming the new page failed",
      error instanceof Error ? error.message : "",
    );
  }
}

export async function createPageWithClient(
  admin: SupabaseClient<Database>,
  userId: string,
  rawHandle: string,
): Promise<CreatePageResult> {
  const result = await claimHandleWithClient(admin, userId, rawHandle);
  if (result.ok) {
    await nameNewPage(admin, userId, result.pageId);
    return { ok: true, pageId: result.pageId, handle: result.handle };
  }

  const error = result.error;
  const status = CREATE_PAGE_STATUS[error];
  switch (error) {
    case "page_limit":
      return { ok: false, status, error, message: await limitMessage(admin, userId) };
    case "suspended":
    case "no_account":
      return { ok: false, status, error, message: CREATE_SUSPENDED_MESSAGE };
    default:
      return {
        ok: false,
        status,
        error,
        message: describeHandleStatus(error as HandleStatus, normalizeHandle(rawHandle)).message,
      };
  }
}
