import { toPlanId, type PlanId } from "@/lib/limits/table";
import type { SiteRole } from "@/lib/team/constants";

/**
 * The one access decision on the TypeScript side (Wave F, M19-02, M19-06, M19-13). Pure, so its rule
 * table is unit-tested without a database. The row comes from `public.site_access(site, user)`, a
 * projection of the SQL rule `access.site_access_rows`; nothing else in src/ decides membership.
 */

/** What an operation needs, ordered: read < edit < publish < owner. */
export type SiteNeed = "read" | "edit" | "publish" | "owner";

/** Where a call came from (the same values as the content writer's `source`). */
export type AccessSource = "editor" | "mcp" | "builder" | "system";

export type AccessState = "active" | "paused_plan" | "paused_owner" | "suspended_self";

/** One row of `public.site_access` (the SQL rule's columns). */
export interface AccessRow {
  site_id: string;
  owner_id: string;
  role: string;
  is_owner: boolean;
  can_read: boolean;
  can_edit: boolean;
  can_publish: boolean;
  owner_plan: string;
  state: string;
}

export interface SiteAccess {
  siteId: string;
  /** The signed-in user or token user acting (rate keys, activity, "who did it"). */
  actorId: string;
  /** The site's owner: every account-, plan-, folder-, theme- and `p_owner_id`-shaped value. */
  ownerId: string;
  role: SiteRole;
  isOwner: boolean;
  canEdit: boolean;
  canPublish: boolean;
  /** The OWNER's effective plan: every limit of a write to this site. */
  plan: PlanId;
  state: AccessState;
}

export type AccessRefusalReason = "not_found" | "forbidden" | "account_suspended" | "error";
export interface AccessRefusal {
  ok: false;
  reason: AccessRefusalReason;
}

/**
 * The rule table:
 * 1. No row, or the row cannot read (paused, suspended): `not_found` (the same answer as a missing id).
 * 2. MCP and not the owner: `not_found`. A token reaches only its user's OWN sites (G10, M19-13); to
 *    open MCP to members later, this is the line to change (with page-access.ts and the consent text).
 * 3. Need `owner` and not the owner: `not_found`.
 * 4. Need above `read`, and the owner's own account is suspended: `account_suspended`.
 * 5. Need `edit` and cannot edit, or need `publish` and cannot publish: `forbidden`.
 */
export function decide(
  row: AccessRow | null,
  need: SiteNeed,
  source: AccessSource,
): "ok" | Exclude<AccessRefusalReason, "error"> {
  if (!row || !row.can_read) return "not_found";
  if (source === "mcp" && !row.is_owner) return "not_found";
  if (need === "owner" && !row.is_owner) return "not_found";
  if (need === "read") return "ok";
  if (row.is_owner && !row.can_edit) return "account_suspended";
  if (!row.can_edit) return "forbidden";
  if (need === "publish" && !row.can_publish) return "forbidden";
  return "ok";
}

const ROLES: readonly SiteRole[] = ["owner", "editor", "publisher"];
const STATES: readonly AccessState[] = ["active", "paused_plan", "paused_owner", "suspended_self"];

/** The row as the app's type (only called on a row `decide` passed). */
export function toSiteAccess(row: AccessRow, actorId: string): SiteAccess {
  return {
    siteId: row.site_id,
    actorId,
    ownerId: row.owner_id,
    role: ROLES.find((r) => r === row.role) ?? "editor",
    isOwner: row.is_owner,
    canEdit: row.can_edit,
    canPublish: row.can_publish,
    plan: toPlanId(row.owner_plan),
    state: STATES.find((s) => s === row.state) ?? "paused_plan",
  };
}

export type EntryWriteOp = "trash" | "delete" | "restore" | "purge";

/**
 * What a destructive entry write needs: taking something live down (trash or delete of a live entry)
 * and purging a trashed one are publish-class (G17); restoring into the drafts and removing a draft
 * that never went live are edits.
 */
export function needForEntryWrite(entry: { published: unknown }, op: EntryWriteOp): SiteNeed {
  if (op === "purge") return "publish";
  if (op === "restore") return "edit";
  return entry.published != null ? "publish" : "edit";
}
