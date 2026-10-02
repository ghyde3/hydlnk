import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPlanId } from "@/lib/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { MEDIA_BUCKET } from "./limits";
import type { UploadQuota } from "./upload";

/**
 * The real upload quota (M4-31): the plan and the suspension flag come from `accounts` (secret key,
 * never from the request), the stored bytes from `account_upload_bytes(uid)`, which sums the objects
 * actually in the `page-media` bucket under `{uid}/`. `userId` must be the verified session user.
 *
 * A database error throws: the route answers 500 and nothing is stored, so the cap never fails open.
 */
export function adminUploadQuota(
  userId: string,
  admin: SupabaseClient = createAdminSupabase() as unknown as SupabaseClient,
): UploadQuota {
  return {
    async read() {
      const [account, bytes] = await Promise.all([
        admin.from("accounts").select("plan, suspended_at").eq("id", userId).maybeSingle(),
        admin.rpc("account_upload_bytes", { p_uid: userId }),
      ]);
      if (account.error) throw new Error(`Account lookup failed: ${account.error.message}`);
      if (bytes.error) throw new Error(`Upload total failed: ${bytes.error.message}`);
      if (!account.data) return null;
      return {
        plan: toPlanId(account.data.plan),
        usedBytes: Number(bytes.data ?? 0),
        suspended: account.data.suspended_at != null,
      };
    },
    async discard(path) {
      const { error } = await admin.storage.from(MEDIA_BUCKET).remove([path]);
      if (error) throw new Error(`Removing ${path} failed: ${error.message}`);
    },
  };
}
