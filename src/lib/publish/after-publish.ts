import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import { pageTag } from "./tags";

/**
 * The one step after a page publish that stands, by hand (Publish all changes, Publish page, Publish
 * design: src/lib/publish/actions.ts) or by schedule (src/lib/schedule/run.ts): the site's tag (Home,
 * every sub-page, the index), then the owner's media queue, since the publish may have dropped the
 * last reference to an image the live page used to show (M5-14). `expire` is how the caller's context
 * expires a tag: `updateTag` in a Server Action, the awaited expiry in the schedule route. A failed
 * expiry throws before the cleanup runs; the cleanup itself never throws.
 */
export async function afterPagePublished(
  input: { siteId: string; ownerId: string | null; admin?: SupabaseClient },
  expire: (tag: string) => void | Promise<void>,
): Promise<void> {
  // Tags are case-sensitive and page ids are stored lower case.
  await expire(pageTag(input.siteId.toLowerCase()));
  if (!input.ownerId) return;
  // The caller's own client when it has one (the schedule route), else the cleanup's default.
  if (input.admin) await cleanupMediaQuietly(input.ownerId, input.admin);
  else await cleanupMediaQuietly(input.ownerId);
}
