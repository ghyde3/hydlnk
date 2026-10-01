"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendSignInLink, type SendLinkResult } from "./magic-link";

/** Log in: email me a sign-in link. Validates on the server too; see sendSignInLink. */
export async function requestSignInLink(email: string): Promise<SendLinkResult> {
  return sendSignInLink(email);
}

/**
 * Sign out (M1-21). A Server Action, so it is always a POST and a cross-site link or image cannot
 * trigger it. `scope: "local"` revokes this device's session server-side (its refresh token stops
 * working) without signing the user out of their other devices. Signed-out callers just land on
 * /login. Next.js 16 attaches no cookies to the redirect itself, so the cleared auth cookies set
 * by the Supabase client ride on this action's response.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    // The cookies are cleared by the client even when the revoke call fails.
    console.error("[auth] sign out failed", error);
  }
  redirect("/login");
}
