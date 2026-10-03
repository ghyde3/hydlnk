import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSessionUser, requireUser, type SessionUser } from "./session";

/** The columns every signed-in screen needs from a page row; the editor loads `draft` itself. */
export interface AppPage {
  id: string;
  handle: string;
  /** `pages.name`: the page's private name (M6-13), "Main page" until its owner renames it. */
  name: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The signed-in user's pages, oldest first, read with their own session under RLS (the policy,
 * not this query, is what limits it to their rows). Cached per request.
 */
const listOwnPages = cache(async (userId: string): Promise<AppPage[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("pages")
    .select("id, handle, name, published_at, created_at, updated_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Loading the signed-in user's pages failed: ${error.message}`);
  return data;
});

/**
 * Gate for every signed-in app screen (/editor, /design, /analytics, /domains, /settings), called
 * from their layouts. Signed out goes to /login; signed in without a page goes to /claim. Neither
 * redirect carries a return-URL parameter. The accounts row is self-healed on the way (requireUser).
 *
 * Do not call it from /claim (it would redirect to itself) or from /login and /signup: those use
 * requireClaimUser() and redirectIfSignedIn(). Keep a `loading.tsx` out of the segments above the
 * caller, or the redirect arrives as a streamed 200 with a meta refresh instead of a 307.
 */
export async function requireAppUser(): Promise<{ user: SessionUser; pages: AppPage[] }> {
  const user = await requireUser();
  const pages = await listOwnPages(user.id);
  if (pages.length === 0) redirect("/claim");
  return { user, pages };
}

/**
 * Gate for /claim: signed out goes to /login; an account that already has a page goes to /editor.
 * Returns the user when they still need to claim a handle.
 */
export async function requireClaimUser(): Promise<SessionUser> {
  const user = await requireUser();
  const pages = await listOwnPages(user.id);
  if (pages.length > 0) redirect("/editor");
  return user;
}

/**
 * Gate for /login and /signup: a signed-in visitor has nothing to do there. Goes to /editor, or to
 * /claim when the account has no page yet. Signed-out visitors fall through. `?next=`,
 * `?redirect_to=` and `?return_to=` are never read.
 */
export async function redirectIfSignedIn(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const pages = await listOwnPages(user.id);
  redirect(pages.length > 0 ? "/editor" : "/claim");
}
