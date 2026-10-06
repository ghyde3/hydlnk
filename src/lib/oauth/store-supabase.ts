import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import {
  GrantLimitError,
  type ActiveGrantRow,
  type ClientRow,
  type DecideArgs,
  type NewClient,
  type NewRequest,
  type OauthStore,
  type RedeemResult,
  type RequestRow,
  type RotateResult,
  type TokenLookup,
  type VerifiedTokenRow,
} from "./store";

/**
 * The real store: the four OAuth tables and the security definer functions of migration
 * 20261010000010_oauth.sql, reached with the secret key. Nothing here decides anything; the rules
 * live in the core functions that take an `OauthStore`.
 *
 * Errors: a failed call throws an Error whose message holds the operation and the PostgREST code
 * and never a value (no hash, token or address), so a log line cannot leak one. HL007 becomes a
 * `GrantLimitError`.
 */

type Admin = SupabaseClient<Database>;

/** postgres `bytea` over PostgREST is the hex text `\x89504e...`. */
export function toPgBytea(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

export function fromPgBytea(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith("\\x")) return null;
  return new Uint8Array(Buffer.from(value.slice(2), "hex"));
}

function fail(operation: string, error: { code?: string; message: string }): never {
  throw new Error(`[oauth] ${operation} failed${error.code ? ` (${error.code})` : ""}`);
}

const CLIENT_COLUMNS =
  "client_id, kind, client_name, redirect_uris, fetched_at, expires_at, created_at, last_seen_at, blocked_at, blocked_by, blocked_reason";

function toClientRow(row: Record<string, unknown>): ClientRow {
  return {
    client_id: row.client_id as string,
    kind: row.kind as string,
    client_name: row.client_name as string,
    redirect_uris: row.redirect_uris as string[],
    logo_png: fromPgBytea(row.logo_png),
    fetched_at: (row.fetched_at as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    created_at: row.created_at as string,
    last_seen_at: row.last_seen_at as string,
    blocked_at: (row.blocked_at as string | null) ?? null,
    blocked_by: (row.blocked_by as string | null) ?? null,
    blocked_reason: (row.blocked_reason as string | null) ?? null,
  };
}

export function createSupabaseOauthStore(admin: Admin = createAdminSupabase()): OauthStore {
  return {
    async getClient(clientId, options) {
      const columns = options?.withLogo ? `${CLIENT_COLUMNS}, logo_png` : CLIENT_COLUMNS;
      const { data, error } = await admin
        .from("oauth_clients")
        .select(columns)
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) fail("getClient", error);
      return data ? toClientRow(data as unknown as Record<string, unknown>) : null;
    },

    async upsertCimdClient(client: NewClient) {
      const { error } = await admin.from("oauth_clients").upsert(
        {
          client_id: client.client_id,
          kind: "cimd",
          client_name: client.client_name,
          redirect_uris: client.redirect_uris,
          logo_png: client.logo_png ? toPgBytea(client.logo_png) : null,
          fetched_at: client.fetched_at ?? new Date().toISOString(),
          expires_at: client.expires_at ?? new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "client_id" },
      );
      if (error) fail("upsertCimdClient", error);
    },

    async insertDcrClient(client: NewClient) {
      const { error } = await admin.from("oauth_clients").insert({
        client_id: client.client_id,
        kind: "dcr",
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
      });
      if (error) fail("insertDcrClient", error);
    },

    async touchClient(clientId) {
      const { error } = await admin
        .from("oauth_clients")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("client_id", clientId);
      if (error) fail("touchClient", error);
    },

    async trimUnusedDcr(cap) {
      const { data, error } = await admin.rpc("oauth_trim_unused_dcr", { p_cap: cap });
      if (error) fail("trimUnusedDcr", error);
      return typeof data === "number" ? data : 0;
    },

    async trimUnusedCimd(cap, keep) {
      const { data, error } = await admin.rpc("oauth_trim_unused_cimd", {
        p_cap: cap,
        p_keep: [...keep],
      });
      if (error) fail("trimUnusedCimd", error);
      return typeof data === "number" ? data : 0;
    },

    async insertRequest(request: NewRequest) {
      const { error } = await admin.from("oauth_authorization_codes").insert({
        id: request.id,
        client_id: request.client_id,
        redirect_uri: request.redirect_uri,
        scopes_requested: request.scopes_requested,
        state: request.state,
        code_challenge: request.code_challenge,
        resource: request.resource,
      });
      if (error) fail("insertRequest", error);
    },

    async getRequest(id) {
      const { data, error } = await admin
        .from("oauth_authorization_codes")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) fail("getRequest", error);
      return data;
    },

    async bindRequest(id, userId, csrfHash) {
      const { data, error } = await admin.rpc("oauth_bind_request", {
        p_id: id,
        p_user: userId,
        p_csrf_hash: csrfHash,
      });
      if (error) fail("bindRequest", error);
      return (data?.[0] as RequestRow | undefined) ?? null;
    },

    async decideRequest(args: DecideArgs) {
      const { data, error } = await admin.rpc("oauth_decide_request", {
        p_id: args.id,
        p_user: args.userId,
        p_csrf_hash: args.csrfHash,
        p_decision: args.decision,
        p_scopes: args.scopes,
        // A deny carries no code; the function reads the hash only for an allow.
        p_code_hash: args.codeHash as string,
      });
      if (error) {
        if (error.code === "HL007") throw new GrantLimitError();
        fail("decideRequest", error);
      }
      return (data?.[0] as RequestRow | undefined) ?? null;
    },

    async getRequestByCodeHash(codeHash) {
      const { data, error } = await admin
        .from("oauth_authorization_codes")
        .select("*")
        .eq("code_hash", codeHash)
        .maybeSingle();
      if (error) fail("getRequestByCodeHash", error);
      return data;
    },

    async redeemCode(args): Promise<RedeemResult> {
      const { data, error } = await admin.rpc("oauth_redeem_code", {
        p_code_hash: args.codeHash,
        p_access_hash: args.accessHash,
        p_refresh_hash: args.refreshHash,
      });
      if (error) fail("redeemCode", error);
      const row = data?.[0];
      if (!row) return { outcome: "not_redeemable" };
      return {
        outcome: row.outcome as RedeemResult["outcome"],
        grantId: row.grant_id ?? undefined,
        userId: row.user_id ?? undefined,
        clientId: row.client_id ?? undefined,
        scopes: row.scopes ?? undefined,
        resource: row.resource ?? undefined,
        accessExpiresAt: row.access_expires_at ?? undefined,
        refreshExpiresAt: row.refresh_expires_at ?? undefined,
      };
    },

    async getTokenByHash(tokenHash): Promise<TokenLookup | null> {
      const { data, error } = await admin
        .from("oauth_tokens")
        .select(
          "id, kind, grant_id, family_id, user_id, scopes, resource, expires_at, rotated_at, revoked_at, oauth_grants!inner(client_id, revoked_at, scopes)",
        )
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) fail("getTokenByHash", error);
      if (!data) return null;
      const grant = data.oauth_grants as unknown as {
        client_id: string;
        revoked_at: string | null;
        scopes: string[];
      };
      return {
        id: data.id,
        kind: data.kind as "access" | "refresh",
        grantId: data.grant_id,
        familyId: data.family_id,
        userId: data.user_id,
        clientId: grant.client_id,
        scopes: data.scopes,
        resource: data.resource,
        expiresAt: data.expires_at,
        rotatedAt: data.rotated_at,
        revokedAt: data.revoked_at,
        grantRevokedAt: grant.revoked_at,
        grantScopes: grant.scopes,
      };
    },

    async rotateRefresh(args): Promise<RotateResult> {
      const { data, error } = await admin.rpc("oauth_rotate_refresh", {
        p_old_id: args.oldId,
        p_access_hash: args.accessHash,
        p_refresh_hash: args.refreshHash,
        // null means "the grant's scopes as they are now".
        p_scopes: args.scopes as string[],
      });
      if (error) fail("rotateRefresh", error);
      const row = data?.[0];
      if (!row) return { outcome: "lost" };
      return {
        outcome: row.outcome as RotateResult["outcome"],
        grantId: row.grant_id ?? undefined,
        userId: row.user_id ?? undefined,
        scopes: row.scopes ?? undefined,
        resource: row.resource ?? null,
        accessExpiresAt: row.access_expires_at ?? undefined,
        refreshExpiresAt: row.refresh_expires_at ?? undefined,
      };
    },

    async endGrant(grantId) {
      const { error } = await admin.rpc("oauth_end_grant", { p_grant: grantId });
      if (error) fail("endGrant", error);
    },

    async endFamily(familyId) {
      const { error } = await admin.rpc("oauth_end_family", { p_family: familyId });
      if (error) fail("endFamily", error);
    },

    async revokeByToken(tokenHash, clientId) {
      const { data, error } = await admin.rpc("oauth_revoke_by_token", {
        p_token_hash: tokenHash,
        p_client_id: clientId,
      });
      if (error) fail("revokeByToken", error);
      return data === true;
    },

    async verifyAccessToken(tokenHash, resource): Promise<VerifiedTokenRow | null> {
      const { data, error } = await admin.rpc("oauth_verify_access_token", {
        p_token_hash: tokenHash,
        p_resource: resource,
      });
      if (error) fail("verifyAccessToken", error);
      const row = data?.[0];
      if (!row) return null;
      return {
        tokenId: row.token_id,
        grantId: row.grant_id,
        userId: row.user_id,
        clientId: row.client_id,
        scopes: row.scopes,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at ?? null,
      };
    },

    async touchToken(tokenId) {
      const { data, error } = await admin.rpc("oauth_touch_token", { p_token: tokenId });
      if (error) fail("touchToken", error);
      return data === true;
    },

    async listActiveGrants(userId, limit): Promise<ActiveGrantRow[]> {
      const { data, error } = await admin
        .from("oauth_grants")
        .select(
          "id, client_id, scopes, created_at, authorized_at, last_used_at, oauth_clients!inner(client_id, kind, client_name, redirect_uris)",
        )
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) fail("listActiveGrants", error);
      return (data ?? []).map((row) => {
        const client = row.oauth_clients as unknown as {
          client_id: string;
          kind: "cimd" | "dcr";
          client_name: string;
          redirect_uris: string[];
        } | null;
        return {
          id: row.id,
          clientId: row.client_id,
          scopes: row.scopes,
          createdAt: row.created_at,
          authorizedAt: row.authorized_at,
          lastUsedAt: row.last_used_at,
          client: client
            ? {
                clientId: client.client_id,
                kind: client.kind,
                name: client.client_name,
                redirectUris: client.redirect_uris,
              }
            : null,
        };
      });
    },

    async getActiveGrant(userId, clientId) {
      const { data, error } = await admin
        .from("oauth_grants")
        .select("id, scopes")
        .eq("user_id", userId)
        .eq("client_id", clientId)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) fail("getActiveGrant", error);
      return data ? { id: data.id, scopes: data.scopes } : null;
    },

    async revokeUserGrant(userId, grantId) {
      const { data, error } = await admin.rpc("oauth_revoke_user_grant", {
        p_user: userId,
        p_grant: grantId,
      });
      if (error) fail("revokeUserGrant", error);
      return data === "ok" ? "ok" : "not_found";
    },

    async revokeAllUserGrants(userId) {
      const { data, error } = await admin.rpc("oauth_revoke_all_user_grants", { p_user: userId });
      if (error) fail("revokeAllUserGrants", error);
      return typeof data === "number" ? data : 0;
    },

    async isSuspended(userId) {
      const { data, error } = await admin
        .from("accounts")
        .select("suspended_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) fail("isSuspended", error);
      // An account that does not exist is treated as suspended: it has no business connecting an app.
      return !data || data.suspended_at !== null;
    },
  };
}

let shared: OauthStore | undefined;

/** The store the routes use: one per server process. */
export function defaultOauthStore(): OauthStore {
  shared ??= createSupabaseOauthStore();
  return shared;
}
