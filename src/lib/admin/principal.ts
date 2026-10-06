import { isLocalRootDomain } from "./env";

/**
 * Who is calling, decided once from verified session claims. Pure (no `server-only`, no I/O) so the
 * admin rules are unit-tested without Next.js. `src/lib/admin/auth.ts` builds one from the request.
 */
export type Principal =
  { kind: "anonymous" } | { kind: "user"; id: string; email: string; admin: boolean };

export const ANONYMOUS: Principal = { kind: "anonymous" };

/**
 * The `app_metadata` flag that marks a local test admin. `app_metadata` can only be written with
 * the secret key (a user cannot edit it), and it travels in the signed JWT, so it is as trustworthy
 * as the session itself. It is honoured ONLY on a localhost root domain (see `isLocalRootDomain`):
 * the Playwright suite signs in throwaway users, and the dev server cannot be given a per-run
 * ADMIN_USER_IDS. Production's only admin source is ADMIN_USER_IDS.
 */
export const LOCAL_ADMIN_CLAIM = "hydlnk_local_admin";

export interface AdminConfig {
  adminIds: ReadonlySet<string>;
  /** `NEXT_PUBLIC_ROOT_DOMAIN`, to decide whether the local-only marker may count. */
  rootDomain: string | undefined;
}

export interface SessionClaims {
  sub?: unknown;
  email?: unknown;
  app_metadata?: unknown;
}

/** Is this signed-in user an admin? ADMIN_USER_IDS, plus the local-only marker on localhost. */
export function isAdminClaims(claims: SessionClaims, config: AdminConfig): boolean {
  const id = typeof claims.sub === "string" ? claims.sub.toLowerCase() : "";
  if (id === "") return false;
  if (config.adminIds.has(id)) return true;
  if (!isLocalRootDomain(config.rootDomain)) return false;
  const meta = claims.app_metadata;
  return (
    typeof meta === "object" &&
    meta !== null &&
    (meta as Record<string, unknown>)[LOCAL_ADMIN_CLAIM] === true
  );
}

/** Principal from verified claims, or anonymous when there is no usable subject. */
export function principalFromClaims(
  claims: SessionClaims | null | undefined,
  config: AdminConfig,
): Principal {
  if (!claims) return ANONYMOUS;
  const id = typeof claims.sub === "string" ? claims.sub : "";
  if (id === "") return ANONYMOUS;
  return {
    kind: "user",
    id,
    email: typeof claims.email === "string" ? claims.email : "",
    admin: isAdminClaims(claims, config),
  };
}

export type AdminDenial = {
  ok: false;
  status: 401 | 403;
  error: "unauthenticated" | "forbidden";
  message: string;
};

/** The one admin gate: null for an admin, a 401 for nobody signed in, a 403 for anyone else. */
export function denyUnlessAdmin(principal: Principal): AdminDenial | null {
  if (principal.kind === "anonymous") {
    return {
      ok: false,
      status: 401,
      error: "unauthenticated",
      message: "Sign in to continue.",
    };
  }
  if (!principal.admin) {
    return { ok: false, status: 403, error: "forbidden", message: "This action is for admins." };
  }
  return null;
}
