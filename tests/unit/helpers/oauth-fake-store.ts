import { randomUUID } from "node:crypto";
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
} from "@/lib/oauth/store";

/**
 * An in-memory `OauthStore` for the Vitest tables of the authorization server (M10-11 to M10-17). It
 * mirrors the atomic moves of migration 20261010000010_oauth.sql (the real ones are proved by pgTAP in
 * 170-oauth.test.sql and by the Playwright specs against the database), and keeps a clock the tests
 * move. `calls` counts every method, so a test can assert how many round trips an endpoint makes.
 */

const ALL = ["hydlnk.read", "hydlnk.write", "hydlnk.publish"];
const inOrder = (scopes: string[]) => ALL.filter((scope) => scopes.includes(scope));

export interface FakeToken {
  id: string;
  grantId: string;
  /** The install: a code exchange starts a family, a rotation keeps it (M10-39). */
  familyId: string;
  userId: string;
  kind: "access" | "refresh";
  hash: string;
  scopes: string[];
  resource: string | null;
  expiresAt: number;
  createdAt: number;
  lastUsedAt: number | null;
  rotatedAt: number | null;
  revokedAt: number | null;
}

export interface FakeGrant {
  id: string;
  userId: string;
  clientId: string;
  scopes: string[];
  authorizedAt: number;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export class FakeOauthStore implements OauthStore {
  clock = Date.UTC(2026, 9, 4, 12, 0, 0);
  clients = new Map<string, ClientRow>();
  requests = new Map<string, RequestRow>();
  grants: FakeGrant[] = [];
  tokens: FakeToken[] = [];
  suspended = new Set<string>();
  calls: Record<string, number> = {};
  /** Make the next call of a method throw (a database failure). */
  failNext: string | null = null;
  maxActiveGrants = 20;

  now = () => this.clock;
  advance(seconds: number) {
    this.clock += seconds * 1000;
  }

  private count(method: string) {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    if (this.failNext === method) {
      this.failNext = null;
      throw new Error(`[oauth] ${method} failed (XX000)`);
    }
  }
  get totalCalls() {
    return Object.values(this.calls).reduce((sum, n) => sum + n, 0);
  }
  private iso(ms: number) {
    return new Date(ms).toISOString();
  }

  // clients
  addClient(clientId: string, redirectUris: string[], over: Partial<ClientRow> = {}): ClientRow {
    const kind = clientId.startsWith("hlc_") ? "dcr" : "cimd";
    const row: ClientRow = {
      client_id: clientId,
      kind,
      client_name: "Test app",
      redirect_uris: redirectUris,
      logo_png: null,
      fetched_at: kind === "cimd" ? this.iso(this.clock) : null,
      expires_at: kind === "cimd" ? this.iso(this.clock + 3600_000) : null,
      created_at: this.iso(this.clock),
      last_seen_at: this.iso(this.clock),
      ...over,
    };
    this.clients.set(clientId, row);
    return row;
  }
  async getClient(clientId: string, options?: { withLogo?: boolean }) {
    this.count("getClient");
    const row = this.clients.get(clientId);
    if (!row) return null;
    return options?.withLogo ? { ...row } : { ...row, logo_png: null };
  }
  async upsertCimdClient(client: NewClient) {
    this.count("upsertCimdClient");
    this.clients.set(client.client_id, {
      client_id: client.client_id,
      kind: "cimd",
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      logo_png: client.logo_png ?? null,
      fetched_at: client.fetched_at ?? this.iso(this.clock),
      expires_at: client.expires_at ?? this.iso(this.clock),
      created_at: this.iso(this.clock),
      last_seen_at: this.iso(this.clock),
    });
  }
  async insertDcrClient(client: NewClient) {
    this.count("insertDcrClient");
    this.clients.set(client.client_id, {
      client_id: client.client_id,
      kind: "dcr",
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      logo_png: null,
      fetched_at: null,
      expires_at: null,
      created_at: this.iso(this.clock),
      last_seen_at: this.iso(this.clock),
    });
  }
  async touchClient(clientId: string) {
    this.count("touchClient");
    const row = this.clients.get(clientId);
    if (row) row.last_seen_at = this.iso(this.clock);
  }
  trimmed: number[] = [];
  async trimUnusedDcr(cap: number) {
    this.count("trimUnusedDcr");
    this.trimmed.push(cap);
    return 0;
  }

  trimmedCimd: Array<{ cap: number; keep: readonly string[] }> = [];
  async trimUnusedCimd(cap: number, keep: readonly string[]) {
    this.count("trimUnusedCimd");
    this.trimmedCimd.push({ cap, keep });
    return 0;
  }

  // requests
  async insertRequest(request: NewRequest) {
    this.count("insertRequest");
    this.requests.set(request.id, {
      id: request.id,
      client_id: request.client_id,
      user_id: null,
      status: "pending",
      redirect_uri: request.redirect_uri,
      scopes_requested: request.scopes_requested,
      scopes_granted: null,
      state: request.state,
      code_challenge: request.code_challenge,
      resource: request.resource,
      csrf_hash: null,
      code_hash: null,
      family_id: null,
      request_expires_at: this.iso(this.clock + 600_000),
      code_expires_at: null,
      used_at: null,
      created_at: this.iso(this.clock),
    });
  }
  async getRequest(id: string) {
    this.count("getRequest");
    const row = this.requests.get(id);
    return row ? { ...row } : null;
  }
  async bindRequest(id: string, userId: string, csrfHash: string) {
    this.count("bindRequest");
    const row = this.requests.get(id);
    if (
      !row ||
      row.status !== "pending" ||
      Date.parse(row.request_expires_at) <= this.clock ||
      (row.user_id !== null && row.user_id !== userId)
    ) {
      return null;
    }
    row.user_id = userId;
    row.csrf_hash = csrfHash;
    return { ...row };
  }
  /** Active grants of a user, for the limit. */
  private active(userId: string) {
    return this.grants.filter((grant) => grant.userId === userId && grant.revokedAt === null);
  }
  async decideRequest(args: DecideArgs) {
    this.count("decideRequest");
    const row = this.requests.get(args.id);
    if (
      !row ||
      row.status !== "pending" ||
      row.user_id !== args.userId ||
      row.csrf_hash !== args.csrfHash ||
      Date.parse(row.request_expires_at) <= this.clock
    ) {
      return null;
    }
    let decision = args.decision;
    if (decision === "allow" && this.suspended.has(args.userId)) decision = "deny";
    if (decision === "deny") {
      row.status = "denied";
      row.csrf_hash = null;
      return { ...row };
    }
    const granted = inOrder(
      ALL.filter(
        (scope) =>
          scope === "hydlnk.read" ||
          (row.scopes_requested.includes(scope) && args.scopes.includes(scope)),
      ),
    );
    let grant = this.grants.find((g) => g.userId === args.userId && g.clientId === row.client_id);
    if (grant) {
      if (grant.revokedAt !== null && this.active(args.userId).length >= this.maxActiveGrants) {
        throw new GrantLimitError();
      }
      grant.scopes = granted;
      grant.authorizedAt = this.clock;
      grant.revokedAt = null;
    } else {
      if (this.active(args.userId).length >= this.maxActiveGrants) throw new GrantLimitError();
      grant = {
        id: randomUUID(),
        userId: args.userId,
        clientId: row.client_id,
        scopes: granted,
        authorizedAt: this.clock,
        createdAt: this.clock,
        lastUsedAt: null,
        revokedAt: null,
      };
      this.grants.push(grant);
    }
    // Only the tokens that hold more than the person allowed this time end (Wave L second review).
    for (const token of this.tokens) {
      if (
        token.grantId === grant.id &&
        token.revokedAt === null &&
        !token.scopes.every((scope) => granted.includes(scope))
      ) {
        token.revokedAt = this.clock;
      }
    }
    row.status = "issued";
    row.scopes_granted = granted;
    row.code_hash = args.codeHash;
    row.code_expires_at = this.iso(this.clock + 60_000);
    row.csrf_hash = null;
    return { ...row };
  }

  // codes and tokens
  async getRequestByCodeHash(codeHash: string) {
    this.count("getRequestByCodeHash");
    for (const row of this.requests.values()) {
      if (row.code_hash === codeHash) return { ...row };
    }
    return null;
  }
  redeemRace: (() => void) | null = null;
  async redeemCode(args: {
    codeHash: string;
    accessHash: string;
    refreshHash: string;
  }): Promise<RedeemResult> {
    this.count("redeemCode");
    this.redeemRace?.();
    const row = [...this.requests.values()].find((r) => r.code_hash === args.codeHash);
    if (
      !row ||
      row.status !== "issued" ||
      row.used_at !== null ||
      Date.parse(row.code_expires_at ?? "") <= this.clock
    ) {
      return { outcome: "not_redeemable" };
    }
    if (this.suspended.has(row.user_id ?? "")) return { outcome: "suspended" };
    const grant = this.grants.find(
      (g) => g.userId === row.user_id && g.clientId === row.client_id && g.revokedAt === null,
    );
    if (!grant) return { outcome: "no_grant" };
    row.status = "used";
    row.used_at = this.iso(this.clock);
    const scopes = inOrder(grant.scopes.filter((s) => (row.scopes_granted ?? []).includes(s)));
    const accessExp = this.clock + 3600_000;
    const refreshExp = Math.min(this.clock + 60 * 86400_000, grant.authorizedAt + 365 * 86400_000);
    // A new family per code exchange: another install of the app keeps its own live refresh token.
    const familyId = randomUUID();
    row.family_id = familyId;
    this.addToken(grant, familyId, "access", args.accessHash, scopes, row.resource, accessExp);
    this.addToken(grant, familyId, "refresh", args.refreshHash, scopes, row.resource, refreshExp);
    return {
      outcome: "ok",
      grantId: grant.id,
      userId: grant.userId,
      clientId: grant.clientId,
      scopes,
      resource: row.resource,
      accessExpiresAt: this.iso(accessExp),
      refreshExpiresAt: this.iso(refreshExp),
    };
  }
  private addToken(
    grant: FakeGrant,
    familyId: string,
    kind: "access" | "refresh",
    hash: string,
    scopes: string[],
    resource: string | null,
    expiresAt: number,
  ) {
    if (
      kind === "refresh" &&
      this.tokens.some(
        (t) => t.familyId === familyId && t.kind === "refresh" && !t.rotatedAt && !t.revokedAt,
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.tokens.push({
      id: randomUUID(),
      grantId: grant.id,
      familyId,
      userId: grant.userId,
      kind,
      hash,
      scopes,
      resource,
      expiresAt,
      createdAt: this.clock,
      lastUsedAt: null,
      rotatedAt: null,
      revokedAt: null,
    });
  }
  async getTokenByHash(tokenHash: string): Promise<TokenLookup | null> {
    this.count("getTokenByHash");
    const token = this.tokens.find((t) => t.hash === tokenHash);
    if (!token) return null;
    const grant = this.grants.find((g) => g.id === token.grantId)!;
    return {
      id: token.id,
      kind: token.kind,
      grantId: token.grantId,
      familyId: token.familyId,
      userId: token.userId,
      clientId: grant.clientId,
      scopes: token.scopes,
      resource: token.resource,
      expiresAt: this.iso(token.expiresAt),
      rotatedAt: token.rotatedAt === null ? null : this.iso(token.rotatedAt),
      revokedAt: token.revokedAt === null ? null : this.iso(token.revokedAt),
      grantRevokedAt: grant.revokedAt === null ? null : this.iso(grant.revokedAt),
      grantScopes: grant.scopes,
    };
  }
  rotateRace: (() => void) | null = null;
  async rotateRefresh(args: {
    oldId: string;
    accessHash: string;
    refreshHash: string;
    scopes: string[] | null;
  }): Promise<RotateResult> {
    this.count("rotateRefresh");
    this.rotateRace?.();
    const old = this.tokens.find((t) => t.id === args.oldId);
    if (
      !old ||
      old.kind !== "refresh" ||
      // Rotated more than 60 seconds ago: no longer a retry, a copy.
      (old.rotatedAt !== null && old.rotatedAt <= this.clock - 60_000) ||
      old.revokedAt !== null ||
      old.expiresAt <= this.clock
    ) {
      return { outcome: "lost" };
    }
    const grant = this.grants.find((g) => g.id === old.grantId && g.revokedAt === null);
    if (!grant) return { outcome: "no_grant" };
    // Never wider than the presented token (sticky narrowing) or the grant; a request may narrow more.
    const base = old.scopes.filter((scope) => grant.scopes.includes(scope));
    if (args.scopes !== null && !args.scopes.every((scope) => grant.scopes.includes(scope))) {
      return { outcome: "invalid_scope" };
    }
    const wanted =
      args.scopes === null ? base : base.filter((scope) => args.scopes!.includes(scope));
    if (wanted.length === 0) return { outcome: "invalid_scope" };
    const scopes = inOrder(wanted);
    if (old.rotatedAt === null) {
      old.rotatedAt = this.clock;
    } else {
      // The grace window: what the first exchange issued is revoked (its refresh token whatever its
      // age, its access tokens by the time of the rotation); the original rotation time is kept.
      for (const token of this.tokens) {
        if (
          token.id !== old.id &&
          token.familyId === old.familyId &&
          token.revokedAt === null &&
          ((token.kind === "refresh" && token.rotatedAt === null) ||
            (token.kind === "access" && token.createdAt >= old.rotatedAt))
        ) {
          token.revokedAt = this.clock;
        }
      }
    }
    const accessExp = this.clock + 3600_000;
    const refreshExp = Math.min(this.clock + 60 * 86400_000, grant.authorizedAt + 365 * 86400_000);
    this.addToken(grant, old.familyId, "access", args.accessHash, scopes, old.resource, accessExp);
    this.addToken(
      grant,
      old.familyId,
      "refresh",
      args.refreshHash,
      scopes,
      old.resource,
      refreshExp,
    );
    return {
      outcome: "ok",
      grantId: grant.id,
      userId: grant.userId,
      scopes,
      resource: old.resource,
      accessExpiresAt: this.iso(accessExp),
      refreshExpiresAt: this.iso(refreshExp),
    };
  }
  async endGrant(grantId: string) {
    this.count("endGrant");
    for (const token of this.tokens) {
      if (token.grantId === grantId && token.revokedAt === null) token.revokedAt = this.clock;
    }
    const grant = this.grants.find((g) => g.id === grantId);
    if (grant && grant.revokedAt === null) grant.revokedAt = this.clock;
  }
  async endFamily(familyId: string) {
    this.count("endFamily");
    const members = this.tokens.filter((t) => t.familyId === familyId);
    if (members.length === 0) return;
    for (const token of members) {
      if (token.revokedAt === null) token.revokedAt = this.clock;
    }
    const grantId = members[0]!.grantId;
    const live = this.tokens.some(
      (t) =>
        t.grantId === grantId &&
        t.kind === "refresh" &&
        t.rotatedAt === null &&
        t.revokedAt === null &&
        t.expiresAt > this.clock,
    );
    if (!live) await this.endGrant(grantId);
  }
  async revokeByToken(tokenHash: string, clientId: string) {
    this.count("revokeByToken");
    const token = this.tokens.find((t) => t.hash === tokenHash);
    if (!token) return false;
    const grant = this.grants.find((g) => g.id === token.grantId);
    if (
      !grant ||
      grant.clientId !== clientId ||
      token.revokedAt !== null ||
      token.rotatedAt !== null ||
      token.expiresAt <= this.clock ||
      grant.revokedAt !== null
    ) {
      return false;
    }
    await this.endFamily(token.familyId);
    return true;
  }
  async verifyAccessToken(tokenHash: string, resource: string): Promise<VerifiedTokenRow | null> {
    this.count("verifyAccessToken");
    const token = this.tokens.find((t) => t.hash === tokenHash);
    if (
      !token ||
      token.kind !== "access" ||
      token.revokedAt !== null ||
      token.expiresAt <= this.clock ||
      token.resource !== resource
    ) {
      return null;
    }
    const grant = this.grants.find((g) => g.id === token.grantId);
    if (!grant || grant.revokedAt !== null) return null;
    return {
      tokenId: token.id,
      grantId: grant.id,
      userId: token.userId,
      clientId: grant.clientId,
      scopes: token.scopes,
      expiresAt: this.iso(token.expiresAt),
      lastUsedAt: token.lastUsedAt === null ? null : this.iso(token.lastUsedAt),
    };
  }
  touches: string[] = [];
  async touchToken(tokenId: string) {
    this.count("touchToken");
    const token = this.tokens.find((t) => t.id === tokenId);
    if (!token) return false;
    if (token.lastUsedAt !== null && token.lastUsedAt > this.clock - 60_000) return false;
    token.lastUsedAt = this.clock;
    this.touches.push(tokenId);
    const grant = this.grants.find((g) => g.id === token.grantId);
    if (grant) grant.lastUsedAt = this.clock;
    return true;
  }

  // grants and accounts
  async listActiveGrants(userId: string, limit: number): Promise<ActiveGrantRow[]> {
    this.count("listActiveGrants");
    // Most recently used first, never used last, then newest (the order of the real query).
    const ordered = [...this.active(userId)].sort(
      (a, b) =>
        (b.lastUsedAt ?? -Infinity) - (a.lastUsedAt ?? -Infinity) || b.createdAt - a.createdAt,
    );
    return ordered
      .map((grant) => {
        const client = this.clients.get(grant.clientId);
        return {
          id: grant.id,
          clientId: grant.clientId,
          scopes: grant.scopes,
          createdAt: this.iso(grant.createdAt),
          authorizedAt: this.iso(grant.authorizedAt),
          lastUsedAt: grant.lastUsedAt === null ? null : this.iso(grant.lastUsedAt),
          client: client
            ? {
                clientId: client.client_id,
                kind: client.kind as "cimd" | "dcr",
                name: client.client_name,
                redirectUris: client.redirect_uris,
              }
            : null,
        };
      })
      .slice(0, limit);
  }
  async getActiveGrant(userId: string, clientId: string) {
    this.count("getActiveGrant");
    const grant = this.active(userId).find((g) => g.clientId === clientId);
    return grant ? { id: grant.id, scopes: grant.scopes } : null;
  }
  async revokeUserGrant(userId: string, grantId: string) {
    this.count("revokeUserGrant");
    const grant = this.grants.find((g) => g.id === grantId && g.userId === userId);
    if (!grant) return "not_found" as const;
    await this.endGrant(grantId);
    return "ok" as const;
  }
  async revokeAllUserGrants(userId: string) {
    this.count("revokeAllUserGrants");
    const grants = this.active(userId);
    for (const grant of grants) await this.endGrant(grant.id);
    return grants.length;
  }
  async isSuspended(userId: string) {
    this.count("isSuspended");
    return this.suspended.has(userId);
  }
}

/** A limiter that allows everything and records its calls. */
export function openLimiter() {
  const calls: Array<{ key: string; limit: number; window: number }> = [];
  const limit = async (key: string, max: number, window: number) => {
    calls.push({ key, limit: max, window });
    return { allowed: true, retryAfter: 0 };
  };
  return { limit, calls };
}

/** An in-memory sliding-window limiter with a clock. */
export function memoryLimiter(now: () => number) {
  const hits = new Map<string, number[]>();
  return async (key: string, max: number, window: number) => {
    const t = now();
    const fresh = (hits.get(key) ?? []).filter((at) => at > t - window * 1000);
    if (fresh.length >= max) {
      hits.set(key, fresh);
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((fresh[0]! + window * 1000 - t) / 1000)),
      };
    }
    fresh.push(t);
    hits.set(key, fresh);
    return { allowed: true, retryAfter: 0 };
  };
}
