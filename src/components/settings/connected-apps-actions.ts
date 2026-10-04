"use server";

import { getSessionUser } from "@/lib/auth/session";
import { revokeConnectedAppFor, type RevokeAppResult } from "@/lib/oauth/grants";
import { defaultOauthStore } from "@/lib/oauth/store-supabase";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Revoke on the Connected apps card (M10-18). A Server Action, so POST only; the user is the verified
 * session user and never a form field. The checks are in `revokeConnectedAppFor`.
 */
export async function revokeConnectedApp(grantId: string): Promise<RevokeAppResult> {
  const user = await getSessionUser();
  return revokeConnectedAppFor(user, grantId, {
    store: defaultOauthStore(),
    limit: (key, limit, window) => rateLimit(key, limit, window),
  });
}
