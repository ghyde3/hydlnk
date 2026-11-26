"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { serverEmailEnv } from "@/lib/domains/email-env";
import { sendMessage } from "@/lib/domains/email";
import { clientEnv } from "@/lib/env/client";
import { setCurrentPageCookie } from "@/lib/pages/current-cookie";
import { rateLimit } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/routing/urls";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  acceptInviteCore,
  inviteMemberCore,
  leaveSiteCore,
  removeMemberCore,
  revokeInviteCore,
  setMemberRoleCore,
  teamFailure,
  type TeamFailure,
} from "./core";
import { siteInviteEmail } from "./invite-email";
import { clearInviteCookie, pendingInviteToken } from "./resume";

/**
 * The team Server Actions (Wave F, M19-08, M19-09). Each takes ids and plain values only, acts as the
 * verified session user, and leaves every decision to the database's team functions (owner checks
 * through the one access rule, under locks). Signed out: `not_found`, nothing done.
 */

type Plain = { ok: true } | TeamFailure;

async function actor(): Promise<string | null> {
  return (await getSessionUser())?.id ?? null;
}

/** Invite an address as editor or publisher. The link is returned once and emailed. */
export async function inviteMember(
  siteId: string,
  email: string,
  role: string,
): Promise<{ ok: true; inviteUrl: string; emailed: "sent" | "skipped" | "failed" } | TeamFailure> {
  const actorId = await actor();
  if (!actorId) return teamFailure("not_found");
  return inviteMemberCore(
    createAdminSupabase(),
    { actorId, siteId, email, role },
    {
      appOrigin: appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN),
      send: async (to, memberRole, inviteUrl) =>
        sendMessage(await siteInviteEmail(to, memberRole, inviteUrl), serverEmailEnv()),
    },
  );
}

export async function revokeInvite(inviteId: string): Promise<Plain> {
  const actorId = await actor();
  if (!actorId) return teamFailure("not_found");
  return revokeInviteCore(createAdminSupabase(), { actorId, inviteId });
}

export async function removeMember(siteId: string, userId: string): Promise<Plain> {
  const actorId = await actor();
  if (!actorId) return teamFailure("not_found");
  return removeMemberCore(createAdminSupabase(), { actorId, siteId, userId });
}

export async function setMemberRole(siteId: string, userId: string, role: string): Promise<Plain> {
  const actorId = await actor();
  if (!actorId) return teamFailure("not_found");
  return setMemberRoleCore(createAdminSupabase(), { actorId, siteId, userId, role });
}

/** A member leaves a site shared with them (their pending schedules there are canceled). */
export async function leaveSite(siteId: string): Promise<Plain> {
  const userId = await actor();
  if (!userId) return teamFailure("not_found");
  return leaveSiteCore(createAdminSupabase(), { userId, siteId });
}

export type AcceptInviteState = { message: string } | null;

/**
 * Accept the invite the HttpOnly invite cookie holds (a POST: a link prefetch never accepts). On
 * success the site becomes the current one and the editor opens.
 */
export async function acceptInvite(
  _previous: AcceptInviteState,
  _form: FormData,
): Promise<AcceptInviteState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const token = await pendingInviteToken();
  if (!token) return { message: teamFailure("invite_used").message };
  const limit = await rateLimit(`invite-accept:${user.id}`, 10, 600);
  if (!limit.allowed) return { message: teamFailure("rate_limited").message };
  const result = await acceptInviteCore(createAdminSupabase(), { userId: user.id, token });
  if (!result.ok) {
    // A link that can never work again is dropped; a wrong account keeps it to switch accounts.
    if (result.error !== "invite_email") await clearInviteCookie();
    return { message: result.message };
  }
  await clearInviteCookie();
  await setCurrentPageCookie(result.siteId);
  redirect("/editor");
}
