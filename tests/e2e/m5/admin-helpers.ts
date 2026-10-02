import type { BrowserContext } from "@playwright/test";
import { LOCAL_ADMIN_CLAIM } from "@/lib/admin/principal";
import { adminClient, type Plan } from "../fixtures/auth";
import { rand, signIn, trackUser, uniq } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, rawRequest, type RawResponse } from "../fixtures/http";

/**
 * Helpers for the admin and suspension specs (Wave D: M5-04, M5-06..M5-09).
 *
 * The dev server cannot be given a per-run ADMIN_USER_IDS, so a test admin is a throwaway user
 * whose `app_metadata` carries the local-only marker (src/lib/admin/principal.ts, honoured only on
 * a localhost root domain). `app_metadata` can only be written with the secret key, which is what
 * makes it as trustworthy as the signed session. The ADMIN_USER_IDS path itself is unit-tested
 * (tests/unit/admin-principal.test.ts).
 */

export const APP_HOST = "app.localhost:3000";
export const APP_ORIGIN = `http://${APP_HOST}`;

/** A confirmed user whose JWT carries the local admin marker. Removed by cleanupUsers(). */
export async function makeAdminEmail(label: string): Promise<string> {
  const email = `zq-${label}-${rand()}@example.com`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { [LOCAL_ADMIN_CLAIM]: true },
  });
  if (error || !data.user) throw new Error(`createUser (admin) failed: ${error?.message}`);
  trackUser(data.user.id);
  return email;
}

/** Signs `context` in as a fresh admin (with a page of their own, so the app shell renders). */
export async function signInAsAdmin(context: BrowserContext, label = "adm") {
  const email = await makeAdminEmail(label);
  return signIn(context, email, { handle: uniq(label).slice(0, 28) });
}

/** Signs `context` in as a fresh, ordinary user with one published page. */
export async function signInAsUser(
  context: BrowserContext,
  label = "usr",
  opts: { plan?: Plan; suspended?: boolean } = {},
) {
  const email = `zq-${label}-${rand()}@example.com`;
  const signedIn = await signIn(context, email, {
    handle: uniq(label).slice(0, 28),
    plan: opts.plan,
  });
  if (opts.suspended) await setSuspended(signedIn.userId, true);
  return signedIn;
}

export async function setSuspended(userId: string, suspended: boolean): Promise<void> {
  const { error } = await adminClient()
    .from("accounts")
    .update({ suspended_at: suspended ? new Date().toISOString() : null })
    .eq("id", userId);
  if (error) throw new Error(`setSuspended failed: ${error.message}`);
}

export async function suspendedAt(userId: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("accounts")
    .select("suspended_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`suspendedAt failed: ${error.message}`);
  return data.suspended_at as string | null;
}

/** The Cookie header of the app host session in `context`. */
export async function sessionCookie(context: BrowserContext): Promise<string> {
  return cookieHeader(await authCookies(context));
}

/** POST a JSON body to an app-host route with a session cookie (or none), redirects not followed. */
export function postApp(
  path: string,
  opts: { cookie?: string; origin?: string | null; body?: string; contentType?: string } = {},
): Promise<RawResponse> {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/json",
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? APP_ORIGIN;
  return appRaw(path, { method: "POST", cookie: opts.cookie, headers, body: opts.body ?? "{}" });
}

export const suspendPath = (accountId: string) => `/api/admin/accounts/${accountId}/suspend`;
export const unsuspendPath = (accountId: string) => `/api/admin/accounts/${accountId}/unsuspend`;
export const dismissPath = (reportId: string) => `/api/admin/reports/${reportId}/dismiss`;

/** GET a tenant host path without cookies. */
export const tenantRaw = (handle: string, path = "/") =>
  rawRequest(`${handle}.localhost:3000`, path);

export const json = (res: RawResponse): Record<string, unknown> => {
  try {
    return JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return {};
  }
};
