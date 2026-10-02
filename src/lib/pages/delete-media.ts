import "server-only";
import { MEDIA_BUCKET as BUCKET } from "@/lib/media/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Removes every object under `{userId}/` in the `page-media` bucket (M4-34), the secret key being
 * the only thing that can: no client has a policy on this bucket. Uploads are flat
 * (`{uid}/{uuid}.{ext}`), but folders are walked too. `userId` is the verified session user. Throws
 * when a list or remove call fails, so the caller can stop before the account is deleted.
 */
export async function removeAccountMedia(userId: string): Promise<void> {
  const bucket = createAdminSupabase().storage.from(BUCKET);

  async function collect(prefix: string, depth: number): Promise<string[]> {
    const paths: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`Listing ${BUCKET} failed: ${error.message}`);
      for (const entry of data ?? []) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id === null && depth < 4) paths.push(...(await collect(path, depth + 1)));
        else if (entry.id !== null) paths.push(path);
      }
      if ((data?.length ?? 0) < 1000) return paths;
    }
  }

  const paths = await collect(userId, 0);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket.remove(paths.slice(i, i + 100));
    if (error) throw new Error(`Removing from ${BUCKET} failed: ${error.message}`);
  }
}
