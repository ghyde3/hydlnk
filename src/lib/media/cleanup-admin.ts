import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  cleanupOwnerMedia,
  isOwnedMediaPath,
  type CleanupDeps,
  type CleanupResult,
} from "./cleanup";
import { MEDIA_BUCKET } from "./limits";

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
    async listQueue(ownerId, limit) {
      const { data, error } = await admin
        .from("image_cleanup_queue")
        .select("path")
        .eq("owner_id", ownerId)
        .order("queued_at", { ascending: true })
        .limit(limit);
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

/** Works the owner's queue off. `userId` must be the verified session user (or the page owner). */
export function cleanupMediaFor(userId: string, admin?: SupabaseClient): Promise<CleanupResult> {
  return cleanupOwnerMedia(userId, adminCleanupDeps(admin));
}

/**
 * `cleanupMediaFor` for callers that must not fail because of it (the Publish action, an upload
 * that is being refused for lack of room): a failure is logged and the queue stays for the next run.
 */
export async function cleanupMediaQuietly(
  userId: string,
  admin?: SupabaseClient,
): Promise<CleanupResult | null> {
  try {
    return await cleanupMediaFor(userId, admin);
  } catch (error) {
    console.error("[media] cleanup failed", error);
    return null;
  }
}

/**
 * Takes one path off the owner's queue: the upload route calls it when the same bytes are uploaded
 * again, so a cleanup that runs before the draft is saved cannot delete the object being reused.
 */
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
