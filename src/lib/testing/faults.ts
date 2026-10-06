import "server-only";
import { cookies } from "next/headers";
import { testHooksEnabled } from "@/lib/env/test-hooks";

/**
 * Fault injection for the end-to-end specs, and nothing else (M5-15, M5-16, M5-20).
 *
 * A server component's Supabase request is made by the Next.js server, so a Playwright route cannot
 * abort it the way it aborts a browser request. To prove the failure screens (the editor that cannot
 * load its draft, the themes row that cannot load, the route that throws) a spec sets the `hl-fault`
 * cookie on the app host to a comma-separated list of the names below, and the server code that owns
 * the load calls `failIfInjected(name)` right before it.
 *
 * It does nothing outside development, test and the end-to-end harness: with NODE_ENV=production
 * (every Vercel build, preview and production alike, and `next start`) `injectedFault` is false
 * whatever the cookie says, unless the test hooks are on (HYDLNK_QUERY_COUNTER=1 and not a Vercel
 * production deployment, see src/lib/env/test-hooks.ts). CI's browser suite runs against the
 * production build started that way (M9-13), so these specs still run there. The cookie is read only
 * on the app host, whose pages already read the session cookie, so no page becomes dynamic because
 * of it.
 */
export const FAULT_COOKIE = "hl-fault";

export type FaultName =
  /** The editor's and Design's own draft read fails. */
  | "draft-load"
  /** The saved-themes read on Design fails (the draft loads). */
  | "themes-load"
  /** A route throws while it renders: the error boundary shows. */
  | "route-throw"
  /** The version history screen's list read fails (M6-50). */
  | "versions-load"
  /** The Connected apps card's read fails (M10-18): the card says so and the rest of Settings renders. */
  | "connected-apps-load"
  /** Disconnecting the connected apps, the first step of an account deletion, fails (M10-19). */
  | "grants-revoke";

export function faultsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || testHooksEnabled();
}

/** True when the request carries the fault cookie naming `name`, and faults are enabled. */
export async function injectedFault(name: FaultName): Promise<boolean> {
  if (!faultsEnabled()) return false;
  const value = (await cookies()).get(FAULT_COOKIE)?.value ?? "";
  return value.split(",").includes(name);
}

/** Throws the error a failed read would throw, when the fault is injected. A no-op otherwise. */
export async function failIfInjected(name: FaultName): Promise<void> {
  if (await injectedFault(name)) throw new Error(`Injected fault: ${name}`);
}
