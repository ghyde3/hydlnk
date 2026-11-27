import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { siteAccessFor } from "@/lib/access/server";
import { requireAppUser, type AppPage, type SharedSite } from "@/lib/auth/gate";
import { createServerSupabase } from "@/lib/supabase/server";
import type { SiteRole } from "@/lib/team/constants";
import { getCurrentPage } from "./current";
import { PLAN_INFO, toPlan, type Plan } from "./plans";

/** What the signed-in user may do on the current site (Wave F, from the one access helper). */
export interface CurrentAccess {
  role: SiteRole;
  isOwner: boolean;
  /** The site's owner: the media folder, the theme scope and every limit are theirs. */
  ownerId: string;
  canEdit: boolean;
  canPublish: boolean;
}

export interface AppContext {
  user: { id: string; email: string };
  /** The user's OWN pages (settings, the page limit, delete account). */
  pages: AppPage[];
  /** Sites shared with the user (Wave F), paused ones included; the switcher lists them. */
  shared: SharedSite[];
  current: AppPage & { access: CurrentAccess };
  /** The user's own plan (billing, their own limits). */
  plan: Plan;
  /** The current site OWNER's plan: every limit and feature of work on the current site. */
  sitePlan: Plan;
  /** The owner's sign-in address on a shared current site, null on an own site. */
  ownerEmail: string | null;
  pageLimit: number;
  /** `accounts.suspended_at` is set (M5-09): the banner shows and writes are disabled. */
  suspended: boolean;
}

/**
 * Where the current site's notification emails go (the form block's "Email me each message",
 * M17-07): its OWNER's sign-in address, which on a shared site is never the member's own (R6).
 */
export function siteOwnerAddress(context: Pick<AppContext, "ownerEmail" | "user">): string {
  return context.ownerEmail ?? context.user.email;
}

/**
 * Everything the app chrome and the page-scoped screens need, loaded once per request (React
 * `cache` is per request; nothing is kept across requests, so a removal shows on the next load):
 * the gated user, their own and shared sites, the current site with the access the rule gives, and
 * the plans. The user's own plan is read with their session under RLS (own account row); the site
 * owner's plan comes from the access helper.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const { user, pages, shared, sharedPages } = await requireAppUser();
  const supabase = await createServerSupabase();
  const [current, account] = await Promise.all([
    getCurrentPage(user, pages, sharedPages),
    supabase.from("accounts").select("plan, suspended_at").eq("id", user.id).maybeSingle(),
  ]);
  if (account.error) throw new Error(`Loading the account failed: ${account.error.message}`);
  const allowed = await siteAccessFor({
    actorId: user.id,
    siteId: current.id,
    need: "read",
    source: "editor",
  });
  if (!allowed.ok) {
    if (allowed.reason === "error") throw new Error("Loading the site's access failed");
    // Access ended between the list and this read (a removal): start over from what is left.
    redirect("/editor");
  }
  const { access } = allowed;
  const plan = toPlan(account.data?.plan);
  return {
    user,
    pages,
    shared,
    current: {
      ...current,
      access: {
        role: access.role,
        isOwner: access.isOwner,
        ownerId: access.ownerId,
        canEdit: access.canEdit,
        canPublish: access.canPublish,
      },
    },
    plan,
    sitePlan: toPlan(access.plan),
    ownerEmail: access.isOwner
      ? null
      : (shared.find((site) => site.id === current.id)?.ownerEmail ?? null),
    pageLimit: PLAN_INFO[plan].maxPages,
    suspended: account.data?.suspended_at != null,
  };
});

/** For screens that are the owner's only (Analytics, Audience, Domains, Members): a member's request 404s. */
export function isOwnerOfCurrent(context: Pick<AppContext, "current">): boolean {
  return context.current.access.isOwner;
}
