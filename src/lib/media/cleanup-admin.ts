import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  cleanupOwnerMedia,
  cleanupScopeFor,
  isOwnedMediaPath,
  type CleanupAccess,
  type CleanupDeps,
  type CleanupResult,
} from "./cleanup";
import { MEDIA_BUCKET, UPLOAD_UNUSED_GRACE_SECONDS } from "./limits";

/**
 * The real dependencies of the cleanup (M5-14): the secret key reads `image_cleanup_queue`, asks
 * `media_paths_in_use` what is still referenced, and removes objects through the Storage API (a
 * SQL delete on storage.objects would leave the file behind). Both tables and the function are
 * server-only: no client role can read the queue, call the function or delete an object.
 */
export function adminCleanupDeps(
  admin: SupabaseClient = createAdminSupabase() as unknown as SupabaseClient,
): CleanupDeps {
  return {
    async listQueue(ownerId, limit, scope) {
      let query = admin
        .from("image_cleanup_queue")
        .select("path")
        .eq("owner_id", ownerId)
        // A new upload waits out its grace (queue_new_upload, S3) before the cleanup may see it.
        .lte("queued_at", (scope?.before ?? new Date()).toISOString());
      // A member's or the system's call: only what this site's writes queued (cleanupScopeFor).
      if (scope?.siteId) query = query.eq("site_id", scope.siteId);
      const { data, error } = await query.order("queued_at", { ascending: true }).limit(limit);
      if (error) throw new Error(`Reading the media queue failed: ${error.message}`);
      return (data ?? []).map((row: { path: string }) => row.path);
    },
    async inUse(ownerId, paths) {
      const { data, error } = await admin.rpc("media_paths_in_use", {
        p_uid: ownerId,
        p_paths: paths,
      });
      if (error) throw new Error(`Checking media references failed: ${error.message}`);
      return Array.isArray(data) ? (data as string[]) : [];
    },
    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths);
      if (error) throw new Error(`Removing media failed: ${error.message}`);
    },
    async requeue(ownerId, paths) {
      if (paths.length === 0) return;
      // One statement (service_role may not update the queue itself): the rows keep their place in
      // the table and only move to the back, so a failure cannot lose any.
      const { error } = await admin.rpc("requeue_media", { p_owner: ownerId, p_paths: paths });
      if (error) throw new Error(`Re-queueing media failed: ${error.message}`);
    },
    async dequeue(ownerId, paths) {
      if (paths.length === 0) return;
      const { error } = await admin
        .from("image_cleanup_queue")
        .delete()
        .eq("owner_id", ownerId)
        .in("path", paths);
      if (error) throw new Error(`Clearing the media queue failed: ${error.message}`);
    },
  };
}

/**
 * THE entry point of the media cleanup (team access re-review, finding 1): every caller (the cleanup
 * route, an upload that needs room, a Publish by hand or by schedule, an MCP write) passes who is
 * acting on which owner's site, and the scope is derived here, never by the caller: the owner's own
 * call works the whole queue, a member's or a scheduled one only the site's rows, and every one only
 * rows queued more than the Undo window ago. `access` must come from the verified session user (or
 * token user) and the access helper. `now` exists for tests (a static test keeps src/ from passing it).
 */
export function cleanupMediaFor(
  access: CleanupAccess,
  options: { admin?: SupabaseClient; now?: Date } = {},
): Promise<CleanupResult> {
  const scope = cleanupScopeFor(access, options.now);
  if (!scope) return Promise.resolve({ deleted: [], kept: [], discarded: [] });
  return cleanupOwnerMedia(access.ownerId, adminCleanupDeps(options.admin), scope);
}

/**
 * `cleanupMediaFor` for callers that must not fail because of it (a Publish, an MCP write): a failure
 * is logged and the queue stays for the next run.
 */
export async function cleanupMediaQuietly(
  access: CleanupAccess,
  options: { admin?: SupabaseClient } = {},
): Promise<CleanupResult | null> {
  try {
    return await cleanupMediaFor(access, options);
  } catch (error) {
    console.error("[media] cleanup failed", error);
    return null;
  }
}

/**
 * Takes one path off the owner's queue: the upload route calls it when the same bytes are uploaded
 * again, so a cleanup that runs before the draft is saved cannot delete the object being reused.
 */
/**
 * Queues a path the upload route just answered (S3): `queue_new_upload` dates the row
 * UPLOAD_UNUSED_GRACE_SECONDS ahead, so the cleanup deletes the image only if no document names it
 * by then. The path must be the owner's own (the table's check says so too).
 */
export async function queueNewUpload(
  ownerId: string,
  path: string,
  admin: SupabaseClient = createAdminSupabase() as unknown as SupabaseClient,
  /** The site the upload is for: its row is that site's, so a member's cleanup of the site sees it. */
  siteId: string | null = null,
): Promise<void> {
  if (!isOwnedMediaPath(ownerId, path)) return;
  const { error } = await admin.rpc(
    "queue_new_upload",
    siteId
      ? { p_owner: ownerId, p_path: path, p_grace_seconds: UPLOAD_UNUSED_GRACE_SECONDS, p_site: siteId }
      : { p_owner: ownerId, p_path: path, p_grace_seconds: UPLOAD_UNUSED_GRACE_SECONDS },
  );
  if (error) throw new Error(`Queueing the upload failed: ${error.message}`);
}

export async function unqueueMediaPath(
  userId: string,
  path: string,
  admin: SupabaseClient = createAdminSupabase() as unknown as SupabaseClient,
): Promise<void> {
  if (!isOwnedMediaPath(userId, path)) return;
  const { error } = await admin
    .from("image_cleanup_queue")
    .delete()
    .eq("owner_id", userId)
    .eq("path", path);
  if (error) throw new Error(`Clearing the media queue failed: ${error.message}`);
}
