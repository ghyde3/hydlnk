import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailAddress } from "@/lib/document";
import type { Database } from "@/lib/supabase/database.types";
import { toMemberRole, type MemberRole } from "./constants";
import { hashInviteToken, isInviteToken, newInviteToken } from "./token";

/**
 * Team management (Wave F, M19-08, M19-09), written against an injected secret-key client so tests
 * drive it without Next.js. Every decision about who may do what is the database's: each team
 * function calls `require_site_access(..., 'owner')` (or checks the accepting session) under its
 * locks, so these cores only validate input, mint and hash tokens and word the refusals.
 */

type Admin = SupabaseClient<Database>;

export type TeamError =
  | "not_found"
  | "invalid_email"
  | "invalid_role"
  | "invite_owner"
  | "already_member"
  | "already_invited"
  | "team_plan"
  | "team_limit"
  | "invite_limit"
  | "invite_email"
  | "invite_session"
  | "invite_used"
  | "shared_site_limit"
  | "rate_limited"
  | "error";

export const TEAM_MESSAGES: Readonly<Record<TeamError, string>> = {
  not_found: "That doesn’t exist.",
  invalid_email: "Enter an email address, like name@example.com.",
  invalid_role: "Choose Editor or Publisher.",
  invite_owner: "That’s your own address. Invite someone else.",
  already_member: "That person is already a member of this site.",
  already_invited: "That address already has an invite. Revoke it to send a new one.",
  team_plan: "Team access is part of Studio.",
  team_limit: "This site has 10 members and invites, the most it can have. Remove one first.",
  invite_limit: "You’ve sent 20 invites today, the most for a day. Try again tomorrow.",
  invite_email:
    "This invite is for another email address. Sign in with the address it was sent to.",
  invite_session:
    "To accept, sign in with the link we email you (or with Google), not with a password.",
  invite_used:
    "This invite link has expired, was revoked or was already used. Ask the owner for a new one.",
  shared_site_limit: "You’re a member of 50 sites, the most an account can be. Leave one first.",
  rate_limited: "Too many tries. Try again in a while.",
  error: "Something went wrong. Try again.",
};

export type TeamFailure = { ok: false; error: TeamError; message: string };
export const teamFailure = (error: TeamError): TeamFailure => ({
  ok: false,
  error,
  message: TEAM_MESSAGES[error],
});

/** What a team function raises, in this module's words (codes from 20261126220300). */
export function teamErrorOf(err: { code?: string | null; message?: string | null }): TeamError {
  switch (err.code) {
    case "P0002":
      return err.message === "invite_not_found" ? "invite_used" : "not_found";
    case "HL019":
      return err.message === "team_plan" ? "team_plan" : "team_limit";
    case "HL020":
      return "invite_limit";
    case "HL021":
      return err.message === "invite_session" ? "invite_session" : "invite_email";
    case "23505":
      return err.message === "already_member" ? "already_member" : "already_invited";
    case "22023":
      if (err.message === "invite_owner") return "invite_owner";
      if (err.message === "shared_site_limit") return "shared_site_limit";
      if (err.message === "invalid_role") return "invalid_role";
      return "error";
    default:
      console.error("[team] database error", err.code);
      return "error";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export interface InviteDeps {
  /** Sends the invite email; resolves "skipped" when no transport is set (local without Mailpit). */
  send: (to: string, role: MemberRole, inviteUrl: string) => Promise<"sent" | "skipped">;
  /** The app host's origin, e.g. "https://app.hydlnk.com". */
  appOrigin: string;
}

/**
 * The owner invites an address with a role. The link is returned once (the token is never stored)
 * and emailed; a failed email leaves the invite in place and says so (`emailed: "failed"`), logged
 * without the address.
 */
export async function inviteMemberCore(
  admin: Admin,
  input: { actorId: string; siteId: unknown; email: unknown; role: unknown },
  deps: InviteDeps,
): Promise<
  { ok: true; inviteUrl: string; emailed: "sent" | "skipped" | "failed" } | TeamFailure
> {
  if (!isUuid(input.siteId)) return teamFailure("not_found");
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!isEmailAddress(email) || email.length > 254) return teamFailure("invalid_email");
  const role = toMemberRole(input.role);
  if (!role) return teamFailure("invalid_role");
  const token = newInviteToken();
  const { error } = await admin.rpc("create_site_invite", {
    p_site: input.siteId.toLowerCase(),
    p_actor: input.actorId,
    p_email: email,
    p_token_hash: hashInviteToken(token),
    p_role: role,
  });
  if (error) return teamFailure(teamErrorOf(error));
  const inviteUrl = `${deps.appOrigin}/invite/${token}`;
  let emailed: "sent" | "skipped" | "failed";
  try {
    emailed = await deps.send(email, role, inviteUrl);
  } catch (err) {
    console.error("[team] sending the invite email failed", err instanceof Error ? err.name : "unknown");
    emailed = "failed";
  }
  return { ok: true, inviteUrl, emailed };
}

/**
 * The signed-in user accepts the invite the token names; answers the site they joined. `methods` is
 * the session's sign-in methods (`SessionUser.methods`): the database refuses a password-only session
 * (S1, HL021 invite_session), so only someone who proved the inbox joins.
 */
export async function acceptInviteCore(
  admin: Admin,
  input: { userId: string; token: unknown; methods: readonly string[] },
): Promise<{ ok: true; siteId: string } | TeamFailure> {
  if (!isInviteToken(input.token)) return teamFailure("invite_used");
  const { data, error } = await admin.rpc("accept_site_invite", {
    p_token_hash: hashInviteToken(input.token),
    p_user: input.userId,
    p_methods: [...input.methods],
  });
  if (error) return teamFailure(teamErrorOf(error));
  return { ok: true, siteId: String(data) };
}

type Plain = { ok: true } | TeamFailure;
const plain = (error: { code?: string | null; message?: string | null } | null): Plain =>
  error ? teamFailure(teamErrorOf(error)) : { ok: true };

export async function revokeInviteCore(
  admin: Admin,
  input: { actorId: string; inviteId: unknown },
): Promise<Plain> {
  if (!isUuid(input.inviteId)) return teamFailure("not_found");
  const { error } = await admin.rpc("revoke_site_invite", {
    p_invite: input.inviteId.toLowerCase(),
    p_actor: input.actorId,
  });
  return plain(error);
}

export async function removeMemberCore(
  admin: Admin,
  input: { actorId: string; siteId: unknown; userId: unknown },
): Promise<Plain> {
  if (!isUuid(input.siteId) || !isUuid(input.userId)) return teamFailure("not_found");
  const { error } = await admin.rpc("remove_site_member", {
    p_site: input.siteId.toLowerCase(),
    p_actor: input.actorId,
    p_user: input.userId.toLowerCase(),
  });
  return plain(error);
}

export async function setMemberRoleCore(
  admin: Admin,
  input: { actorId: string; siteId: unknown; userId: unknown; role: unknown },
): Promise<Plain> {
  if (!isUuid(input.siteId) || !isUuid(input.userId)) return teamFailure("not_found");
  const role = toMemberRole(input.role);
  if (!role) return teamFailure("invalid_role");
  const { error } = await admin.rpc("set_site_member_role", {
    p_site: input.siteId.toLowerCase(),
    p_actor: input.actorId,
    p_user: input.userId.toLowerCase(),
    p_role: role,
  });
  return plain(error);
}

export async function leaveSiteCore(
  admin: Admin,
  input: { userId: string; siteId: unknown },
): Promise<Plain> {
  if (!isUuid(input.siteId)) return teamFailure("not_found");
  const { error } = await admin.rpc("leave_site", {
    p_site: input.siteId.toLowerCase(),
    p_user: input.userId,
  });
  return plain(error);
}

export interface TeamMember {
  userId: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}
export interface TeamInvite {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
}
export interface TeamActivity {
  at: string;
  email: string | null;
  role: string;
  action: string;
}
export interface TeamData {
  members: TeamMember[];
  invites: TeamInvite[];
  activity: TeamActivity[];
}

/** The members screen's data, owner only (the function refuses anyone else with P0002: null). */
export async function loadTeamCore(
  admin: Admin,
  input: { actorId: string; siteId: string },
): Promise<TeamData | null> {
  const { data, error } = await admin.rpc("list_site_team", {
    p_site: input.siteId,
    p_actor: input.actorId,
  });
  if (error) {
    if (error.code === "P0002") return null;
    throw new Error(`Loading the team failed: ${error.code}`);
  }
  const raw = (data ?? {}) as {
    members?: Array<Record<string, unknown>>;
    invites?: Array<Record<string, unknown>>;
    activity?: Array<Record<string, unknown>>;
  };
  return {
    members: (raw.members ?? []).flatMap((row) => {
      const role = toMemberRole(row.role);
      return role
        ? [{ userId: String(row.user_id), email: String(row.email ?? ""), role, joinedAt: String(row.created_at) }]
        : [];
    }),
    invites: (raw.invites ?? []).flatMap((row) => {
      const role = toMemberRole(row.role);
      return role
        ? [{ id: String(row.id), email: String(row.email), role, expiresAt: String(row.expires_at) }]
        : [];
    }),
    activity: (raw.activity ?? []).map((row) => ({
      at: String(row.at),
      email: typeof row.email === "string" ? row.email : null,
      role: String(row.role),
      action: String(row.action),
    })),
  };
}
