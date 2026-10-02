import "server-only";
import { cookies } from "next/headers";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { PENDING_HANDLE_COOKIE, PENDING_HANDLE_METADATA_KEY, pickPendingHandle } from "./pending";

/**
 * The handle the signed-in user chose on /signup, if one is still waiting to be claimed: from the
 * user's metadata (email link) or the hl-pending-handle cookie (Google). Metadata is read with
 * getUser() (the auth server, not a possibly stale token) so a handle already processed and
 * cleared never comes back. Anything that is not a valid normalized handle reads as none.
 */
export async function readPendingHandle(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  const cookieStore = await cookies();
  return pickPendingHandle({
    metadata: data.user?.user_metadata?.[PENDING_HANDLE_METADATA_KEY],
    cookie: cookieStore.get(PENDING_HANDLE_COOKIE)?.value,
  });
}

/** Drops the metadata carrier once the pending handle has been processed (claimed or refused). */
export async function clearPendingMetadata(userId: string): Promise<void> {
  const { error } = await createAdminSupabase().auth.admin.updateUserById(userId, {
    user_metadata: { [PENDING_HANDLE_METADATA_KEY]: null },
  });
  if (error) console.error("[handles] clearing the pending handle failed", error.message);
}
