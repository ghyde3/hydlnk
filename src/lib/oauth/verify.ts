import "server-only";
import { after } from "next/server";
import {
  LAST_USED_WRITE_SECONDS,
  MAX_BEARER_LENGTH,
  orderedScopes,
  type OauthScope,
} from "./constants";
import { oauthConfig } from "./config";
import { defaultOauthStore } from "./store-supabase";
import type { OauthStore } from "./store";
import { sha256Hex } from "./tokens";

/**
 * The bearer check of the MCP endpoint (M10-04) and the contract the MCP side builds on:
 *
 *   verifyAccessToken(token) -> { userId, clientId, grantId, scopes, tokenId, expiresAt } | null
 *   requireScope(auth, scope)  throws InsufficientScopeError when the token lacks the scope
 *   hasScope(auth, scope)      the same test as a boolean
 *
 * `verifyAccessToken` returns null for ANY bad token (unknown, altered, expired, revoked, a refresh
 * token or a code used as a bearer, a token minted for another resource, a token of an ended grant, a
 * deleted user, an oversized or non-ASCII value) and never throws for one. It throws only when the
 * database cannot answer, with a message that names the operation and holds no token. The caller maps
 * both outcomes to the same 401 or a 5xx as it sees fit.
 *
 * The lookup hashes the presented value (SHA-256 of the whole string, hex) and asks the database for
 * a live `access` row with that hash for exactly the canonical MCP URL whose grant is not revoked,
 * all judged by the DATABASE clock (`oauth_verify_access_token`). The plaintext is never queried,
 * compared in application code or logged. The user comes from the token row and from nowhere else.
 *
 * Use is recorded cheaply: the first request of a token, and then at most one per minute, writes the
 * token's and the grant's `last_used_at`. The write happens after the response (`after`) and its
 * failure is swallowed, so it never delays or fails a request.
 */

export interface VerifiedAuth {
  userId: string;
  clientId: string;
  grantId: string;
  scopes: OauthScope[];
  tokenId: string;
  /** Unix seconds, the shape of `AuthInfo.expiresAt`. */
  expiresAt: number;
}

export interface VerifyDeps {
  store?: OauthStore;
  /** The canonical MCP URL a token must have been minted for. */
  resource?: string;
  /** Milliseconds since the epoch (a fake clock in tests). */
  now?: () => number;
  /** Runs `work` after the response (default: Next's `after`, falling back to a plain call). */
  defer?: (work: () => Promise<unknown>) => void;
}

/** Printable ASCII only, no space: what a bearer token can be. */
const BEARER_VALUE = /^[\x21-\x7e]+$/;

function deferAfterResponse(work: () => Promise<unknown>): void {
  const run = () => work().catch(() => undefined);
  try {
    after(run);
  } catch {
    // Outside a request (a script or a test): run it now, still never awaited by the caller.
    void run();
  }
}

export async function verifyAccessToken(
  token: string,
  deps: VerifyDeps = {},
): Promise<VerifiedAuth | null> {
  if (typeof token !== "string") return null;
  if (token.length === 0 || token.length > MAX_BEARER_LENGTH || !BEARER_VALUE.test(token)) {
    return null;
  }
  const store = deps.store ?? defaultOauthStore();
  const resource = deps.resource ?? oauthConfig().resource;
  const now = deps.now ?? Date.now;

  const row = await store.verifyAccessToken(sha256Hex(token), resource);
  if (!row) return null;

  const lastUsed = row.lastUsedAt === null ? null : Date.parse(row.lastUsedAt);
  if (
    lastUsed === null ||
    Number.isNaN(lastUsed) ||
    now() - lastUsed >= LAST_USED_WRITE_SECONDS * 1000
  ) {
    (deps.defer ?? deferAfterResponse)(() => store.touchToken(row.tokenId));
  }

  return {
    userId: row.userId,
    clientId: row.clientId,
    grantId: row.grantId,
    scopes: orderedScopes(row.scopes),
    tokenId: row.tokenId,
    expiresAt: Math.floor(Date.parse(row.expiresAt) / 1000),
  };
}

export class InsufficientScopeError extends Error {
  readonly scope: OauthScope;
  constructor(scope: OauthScope) {
    super(`insufficient_scope: ${scope}`);
    this.name = "InsufficientScopeError";
    this.scope = scope;
  }
}

/** Does the token hold `scope`? Exact: `hydlnk.publish` does not imply `hydlnk.write`. */
export function hasScope(auth: Pick<VerifiedAuth, "scopes">, scope: OauthScope): boolean {
  return auth.scopes.includes(scope);
}

export function requireScope(auth: Pick<VerifiedAuth, "scopes">, scope: OauthScope): void {
  if (!hasScope(auth, scope)) throw new InsufficientScopeError(scope);
}
