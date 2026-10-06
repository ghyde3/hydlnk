import "server-only";
import { revalidateTag, updateTag } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { handleTag, pageTag } from "./tags";

/**
 * Expires the cached public page of every page an account owns (M2-28). The one function the Stripe
 * webhook (Milestone 4: a plan changed, so the badge changes) and admin suspend (Milestone 5) call;
 * nothing else should reach for `revalidateTag` on page tags. Callable from Server Actions and
 * Route Handlers (`updateTag` is Server Actions only, and Publish uses that).
 *
 * `{ expire: 0 }`: nothing stale is served, the next request regenerates the page at once.
 * Returns how many pages were invalidated. Throws when the pages cannot be listed, so a caller
 * (a webhook) can fail and be retried instead of leaving a stale badge or a suspended page live.
 */
export async function invalidateAccountPages(accountId: string): Promise<number> {
  const { data, error } = await createAdminSupabase()
    .from("pages")
    .select("id")
    .eq("owner_id", accountId);
  if (error) throw new Error(`Listing the pages of account ${accountId} failed: ${error.message}`);
  // Every page is attempted even when one throws, then the first failure is raised: a webhook can
  // retry, and one bad page cannot leave the rest of the account's pages cached.
  let failure: unknown = null;
  for (const page of data ?? []) {
    try {
      revalidateTag(pageTag(page.id), { expire: 0 });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return data?.length ?? 0;
}

/**
 * Expires what the cache holds for one page (its public read, its page and OG image, and the custom
 * domain its metadata names): adding, verifying, re-pointing or removing a custom domain calls it
 * (src/lib/domains). Immediate expiry, from Server Actions and Route Handlers alike.
 */
export function invalidatePage(pageId: string): void {
  revalidateTag(pageTag(pageId), { expire: 0 });
}

/**
 * Expires the cached 404 of a handle (a handle that was just claimed, or whose page was deleted),
 * so the placeholder or the 404 shows at once instead of after `MISSING_REVALIDATE_SECONDS`.
 * Callable from Server Actions and Route Handlers.
 */
export function invalidateHandle(handle: string): void {
  revalidateTag(handleTag(handle), { expire: 0 });
}

/**
 * Expires what the cache holds for one page that was just deleted (M4-19): its tag (so the stored
 * page and OG image are dropped) and its handle's cached 404. The Route Handler counterpart of
 * `expireDeletedPages`: `revalidateTag` with immediate expiry, because `updateTag` is Server
 * Actions only. Call it after the delete has succeeded. Throws when the cache API does.
 */
export function expireDeletedPage(page: { id: string; handle: string }): void {
  revalidateTag(pageTag(page.id), { expire: 0 });
  invalidateHandle(page.handle);
}

/**
 * Expires what the cache holds for pages that were just deleted: each page's tag (so the stored
 * page and OG image are dropped) and each handle's cached 404. Server Actions only, because
 * `updateTag` is: account deletion is the one caller. Call it after the delete has succeeded, so a
 * request that regenerates the page in between cannot put a deleted page back into the cache.
 */
export function expireDeletedPages(pages: ReadonlyArray<{ id: string; handle: string }>): void {
  let failure: unknown = null;
  for (const page of pages) {
    try {
      updateTag(pageTag(page.id));
      invalidateHandle(page.handle);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
