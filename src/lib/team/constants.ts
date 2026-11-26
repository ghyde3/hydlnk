/**
 * Team access numbers (Wave F, M19-05). Postgres holds the same numbers in the team functions
 * (20261126200300_site_team_functions.sql: 20 invites a day, 50 shared sites, 7 days) and
 * `plan_site_members` (the per-site cap, PLAN_LIMITS[plan].siteMembers); tests/unit/m19t-team-constants.test.ts
 * pins both sides. Safe in server and client code.
 */

/** An invite link lasts this many days. */
export const INVITE_TTL_DAYS = 7;
/** Invites one owner may send in a rolling 24 hours, over all of their sites (HL020). */
export const INVITES_PER_DAY = 20;
/** Sites one account may be a member of (accept_site_invite, 22023 shared_site_limit). */
export const SHARED_SITES_PER_MEMBER = 50;

export const MEMBER_ROLES = ["editor", "publisher"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type SiteRole = "owner" | MemberRole;

export const ROLE_LABELS: Readonly<Record<SiteRole, string>> = {
  owner: "Owner",
  editor: "Editor",
  publisher: "Publisher",
};

export function toMemberRole(value: unknown): MemberRole | null {
  return MEMBER_ROLES.find((role) => role === value) ?? null;
}
