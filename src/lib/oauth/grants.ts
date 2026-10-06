import "server-only";
import { clientAddressHost } from "./authorize";
import { MAX_ACTIVE_GRANTS, orderedScopes, type OauthScope } from "./constants";
import { REVOKE_FAILED, REVOKE_RATE_LIMITED } from "./messages";
import { logOauthFailure } from "./log";
import type { LimitFn } from "./register";
import type { OauthStore } from "./store";
import { defaultOauthStore } from "./store-supabase";

/**
 * What a person has connected, and how they disconnect it (M10-18, M10-19). The grant tables have no
 * client access, so every read and write here uses the secret key and is filtered by the verified
 * session user: a user id never comes from a form.
 */

export interface ConnectedApp {
  id: string;
  name: string;
  /** The host of a metadata client's address; null for a registered client (shown as not verified). */
  address: string | null;
  scopes: OauthScope[];
  /** "Oct 4, 2026" */
  connectedOn: string;
  lastUsedOn: string | null;
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatConnectedDate(iso: string): string {
  return DAY.format(new Date(iso));
}

/**
 * The person's active grants, most recently used first, at most 20, whose client row still exists.
 * A grant that ended (revoked by the person, by the app, or through refresh-token reuse) is not here.
 */
export async function loadConnectedApps(
  userId: string,
  store: Pick<OauthStore, "listActiveGrants"> = defaultOauthStore(),
): Promise<ConnectedApp[]> {
  const rows = await store.listActiveGrants(userId, MAX_ACTIVE_GRANTS);
  return rows
    .filter((row) => row.client !== null)
    .map((row) => ({
      id: row.id,
      name: row.client!.name,
      address: row.client!.kind === "cimd" ? clientAddressHost(row.client!.clientId) : null,
      scopes: orderedScopes(row.scopes),
      connectedOn: formatConnectedDate(row.createdAt),
      lastUsedOn: row.lastUsedAt === null ? null : formatConnectedDate(row.lastUsedAt),
    }));
}

/** Every grant and token of the person ends, and their pending requests go (account deletion, M10-19). */
export async function revokeAllGrants(
  userId: string,
  store: Pick<OauthStore, "revokeAllUserGrants"> = defaultOauthStore(),
): Promise<void> {
  await store.revokeAllUserGrants(userId);
}

export type RevokeAppResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unauthorized" | "not_found" | "rate_limited" | "failed";
      message: string;
    };

const GRANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REVOKE_PER_USER_PER_HOUR = 60;

/**
 * The Revoke button (M10-18). No session is unauthorized. Another person's grant id, a random id and
 * a malformed id all answer `not_found` and change nothing. On success the grant and all of its tokens
 * end and its unanswered requests are deleted in one transaction; repeating it is safe. A suspended
 * account may revoke: revoking is never blocked.
 */
export async function revokeConnectedAppFor(
  user: { id: string } | null,
  grantId: unknown,
  deps: { store: Pick<OauthStore, "revokeUserGrant">; limit: LimitFn },
): Promise<RevokeAppResult> {
  if (!user) {
    return {
      ok: false,
      reason: "unauthorized",
      message: "You’re signed out. Sign in again to continue.",
    };
  }
  if (typeof grantId !== "string" || !GRANT_ID.test(grantId)) {
    return { ok: false, reason: "not_found", message: REVOKE_FAILED };
  }
  const verdict = await deps.limit(`oauth-revoke-user:${user.id}`, REVOKE_PER_USER_PER_HOUR, 3600);
  if (!verdict.allowed) return { ok: false, reason: "rate_limited", message: REVOKE_RATE_LIMITED };
  try {
    const result = await deps.store.revokeUserGrant(user.id, grantId.toLowerCase());
    return result === "ok"
      ? { ok: true }
      : { ok: false, reason: "not_found", message: REVOKE_FAILED };
  } catch (error) {
    logOauthFailure("revokeConnectedApp", error);
    return { ok: false, reason: "failed", message: REVOKE_FAILED };
  }
}
