import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { resumeOauthRequest } from "@/lib/oauth/resume";
import { sharedSiteRows } from "@/lib/access/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { toMemberRole, type MemberRole } from "@/lib/team/constants";
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

const SHARED_STATES = ["active", "paused_plan", "paused_owner", "suspended_self"] as const;

/** A site shared with the user (Wave F): listed in the switcher, selectable only while `active`. */
export interface SharedSite {
  id: string;
  handle: string;
  name: string;
  role: MemberRole;
  state: (typeof SHARED_STATES)[number];
  ownerId: string;
  /** The owner's sign-in address, shown so the member knows whose site it is. */
  ownerEmail: string | null;
}

/**
 * The signed-in user's OWN pages, oldest first, read with their own session. Since Wave F the pages
 * policy also returns sites shared with the user, so the owner filter here is what keeps this list
 * (settings, the page limit, delete account) to their own rows (T19). Cached per request.
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
export async function requireAppUser(): Promise<{
  user: SessionUser;
  pages: AppPage[];
  shared: SharedSite[];
  sharedPages: AppPage[];
}> {
  const user = await requireUser();
  const [pages, { shared, sharedPages }] = await Promise.all([
    listOwnPages(user.id),
    listSharedSites(user.id),
  ]);
  // An account with no site of its own works on a site shared with it (G11); with neither it claims.
  if (pages.length === 0 && sharedPages.length === 0) redirect("/claim");
  return { user, pages, shared, sharedPages };
}

/**
 * The sites shared with the user (Wave F, C1): the rule's own list (`list_shared_sites`, paused ones
 * included, for the switcher) and, for the active ones, their page rows read with the user's session
 * under RLS (what the policies let them read, so a paused or removed site is never a row here).
 * Computed per request, never cached across requests.
 */
export const listSharedSites = cache(
  async (userId: string): Promise<{ shared: SharedSite[]; sharedPages: AppPage[] }> => {
    const shared: SharedSite[] = (await sharedSiteRows(userId)).flatMap((row) => {
      const role = toMemberRole(row.role);
      if (!role) return [];
      return [
        {
          id: row.site_id,
          handle: row.handle,
          name: row.name,
          role,
          state: SHARED_STATES.find((state) => state === row.state) ?? "paused_plan",
          ownerId: row.owner_id,
          ownerEmail: row.owner_email ?? null,
        },
      ];
    });
    const active = shared.filter((site) => site.state === "active").map((site) => site.id);
    if (active.length === 0) return { shared, sharedPages: [] };
    const supabase = await createServerSupabase();
    const rows = await supabase
      .from("pages")
      .select("id, handle, name, published_at, created_at, updated_at")
      .in("id", active)
      .order("created_at", { ascending: true });
    if (rows.error) throw new Error(`Loading the shared sites failed: ${rows.error.message}`);
    return { shared, sharedPages: rows.data };
  },
);

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
  const [pages, { sharedPages }] = await Promise.all([
    listOwnPages(user.id),
    listSharedSites(user.id),
  ]);
  // Wave L (M10-12): a person who came here to sign in for an app's connection goes back to its
  // consent screen. An account with no page claims one first, and the claim resumes the request.
  if (pages.length > 0) await resumeOauthRequest(user.id);
  // An account with only shared sites works there (G11); /claim stays open to it.
  redirect(pages.length > 0 || sharedPages.length > 0 ? "/editor" : "/claim");
}
