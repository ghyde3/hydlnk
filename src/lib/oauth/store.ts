import type { Database } from "@/lib/supabase/database.types";

/**
 * What the authorization server asks of its storage (M10-05). The core functions of this directory
 * (`exchangeCode`, `rotateRefresh`, `decideConsent`, `verifyAccessToken`, ...) take a store and a
 * clock, so a Vitest can drive every rule with an in-memory one and a fake clock; the one real store,
 * `createSupabaseOauthStore` (store-supabase.ts), calls the tables and the security definer functions
 * of migration 20261010000010_oauth.sql with the secret key.
 *
 * The split is deliberate. The store holds the ATOMIC moves (one conditional update, a grant upsert
 * with the end of its earlier tokens, a token rotation); the decisions around them (PKCE, redirect
 * matching, scopes, error words, reuse detection) live in the core functions, where a table of
 * cases can reach them.
 */

type Tables = Database["public"]["Tables"];

export type ClientRow = Omit<Tables["oauth_clients"]["Row"], "logo_png"> & {
  /** The re-encoded logo, or null. Only `getClient(..., { withLogo: true })` reads the bytes. */
  logo_png: Uint8Array | null;
};
export type RequestRow = Tables["oauth_authorization_codes"]["Row"];
export type GrantRow = Tables["oauth_grants"]["Row"];
export type TokenRow = Tables["oauth_tokens"]["Row"];

export type ClientKind = "cimd" | "dcr";

export interface NewRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  scopes_requested: string[];
  state: string | null;
  code_challenge: string;
  resource: string;
}

export interface NewClient {
  client_id: string;
  kind: ClientKind;
  client_name: string;
  redirect_uris: string[];
  logo_png?: Uint8Array | null;
  fetched_at?: string | null;
  expires_at?: string | null;
}

export interface DecideArgs {
  id: string;
  userId: string;
  csrfHash: string;
  decision: "allow" | "deny";
  scopes: string[];
  codeHash: string | null;
}

export type RedeemOutcome = "ok" | "not_redeemable" | "suspended" | "no_grant";

export interface RedeemResult {
  outcome: RedeemOutcome;
  grantId?: string;
  userId?: string;
  clientId?: string;
  scopes?: string[];
  resource?: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
}

export type RotateOutcome = "ok" | "lost" | "no_grant" | "invalid_scope";

export interface RotateResult {
  outcome: RotateOutcome;
  grantId?: string;
  userId?: string;
  scopes?: string[];
  resource?: string | null;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
}

/** A token row with what the endpoints need to judge it, read by hash. */
export interface TokenLookup {
  id: string;
  kind: "access" | "refresh";
  grantId: string;
  /** The install this token belongs to: a code exchange starts a family, a rotation keeps it. */
  familyId: string;
  userId: string;
  clientId: string;
  scopes: string[];
  resource: string | null;
  expiresAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
  grantRevokedAt: string | null;
  grantScopes: string[];
}

/** What the bearer check returns for a live access token. */
export interface VerifiedTokenRow {
  tokenId: string;
  grantId: string;
  userId: string;
  clientId: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
}

export interface ActiveGrantRow {
  id: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
  authorizedAt: string;
  lastUsedAt: string | null;
  client: { kind: ClientKind; name: string; redirectUris: string[]; clientId: string } | null;
}

/** HL007: the person already holds 20 active connected apps. */
export class GrantLimitError extends Error {
  constructor() {
    super("oauth_grant_limit");
    this.name = "GrantLimitError";
  }
}

export interface OauthStore {
  // clients
  getClient(clientId: string, options?: { withLogo?: boolean }): Promise<ClientRow | null>;
  /** Inserts or replaces the cache row of a client-metadata client (one row per client id). */
  upsertCimdClient(client: NewClient): Promise<void>;
  insertDcrClient(client: NewClient): Promise<void>;
  /** True when any of the (lower-case) hosts is a return-address host of a blocked app (M13-10 review). */
  anyHostBlocked(hosts: readonly string[]): Promise<boolean>;
  /** `last_seen_at`, when an authorize request names the client. */
  touchClient(clientId: string): Promise<void>;
  /** Deletes the oldest unused registrations past the cap; returns how many went. */
  trimUnusedDcr(cap: number): Promise<number>;
  /**
   * Deletes the oldest client-metadata rows that no grant and no request refers to, past the cap,
   * never one of `keep` (the known clients); returns how many went.
   */
  trimUnusedCimd(cap: number, keep: readonly string[]): Promise<number>;

  // authorize requests
  insertRequest(request: NewRequest): Promise<void>;
  getRequest(id: string): Promise<RequestRow | null>;
  /** The row when it is still pending, unexpired and either unbound or this person's; else null. */
  bindRequest(id: string, userId: string, csrfHash: string): Promise<RequestRow | null>;
  /** The changed row, or null when any condition failed. Throws GrantLimitError on HL007. */
  decideRequest(args: DecideArgs): Promise<RequestRow | null>;

  // codes and tokens
  getRequestByCodeHash(codeHash: string): Promise<RequestRow | null>;
  redeemCode(args: {
    codeHash: string;
    accessHash: string;
    refreshHash: string;
  }): Promise<RedeemResult>;
  getTokenByHash(tokenHash: string): Promise<TokenLookup | null>;
  rotateRefresh(args: {
    oldId: string;
    accessHash: string;
    refreshHash: string;
    scopes: string[] | null;
  }): Promise<RotateResult>;
  /** Ends a grant and every token of every family of it. */
  endGrant(grantId: string): Promise<void>;
  /** Ends one family (one install) and the grant too when no live family is left. */
  endFamily(familyId: string): Promise<void>;
  /** RFC 7009: true when a live token of that client ended its family (and its grant, if it was the last). */
  revokeByToken(tokenHash: string, clientId: string): Promise<boolean>;
  verifyAccessToken(tokenHash: string, resource: string): Promise<VerifiedTokenRow | null>;
  touchToken(tokenId: string): Promise<boolean>;

  // grants and accounts
  listActiveGrants(userId: string, limit: number): Promise<ActiveGrantRow[]>;
  getActiveGrant(
    userId: string,
    clientId: string,
  ): Promise<{ id: string; scopes: string[] } | null>;
  revokeUserGrant(userId: string, grantId: string): Promise<"ok" | "not_found">;
  revokeAllUserGrants(userId: string): Promise<number>;
  isSuspended(userId: string): Promise<boolean>;
}
