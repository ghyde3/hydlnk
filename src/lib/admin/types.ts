import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** What an admin action answers: an HTTP status and a JSON body, never a thrown error. */
export type ActionFailure = {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 500;
  error: string;
  message: string;
};
export type ActionSuccess = { ok: true; status: 200; data: Record<string, unknown> };
export type ActionResult = ActionSuccess | ActionFailure;

/** Everything an action touches, injected so tests drive it without Next.js or a database. */
export interface AdminDeps {
  /** Secret-key client (RLS does not apply: the admin gate in `executeAdminAction` is the rule). */
  db: SupabaseClient<Database>;
  /** `invalidateAccountPages` (M2-28): expires the cached public page of every page of the account. */
  invalidateAccount: (accountId: string) => Promise<number>;
  /** `invalidateHandle` for each handle: expires a cached 404 (an unsuspend must not wait for it). */
  invalidateHandles: (handles: readonly string[]) => void;
  /** Admins cannot be suspended: true for an id in ADMIN_USER_IDS (or a local test admin). */
  isProtectedAccount: (accountId: string) => Promise<boolean>;
  now: () => Date;
}

export interface AdminActionContext {
  /** The verified admin running the action. */
  actor: { id: string; email: string };
  deps: AdminDeps;
}

/**
 * One admin mutation. Nothing calls `run` directly: `executeAdminAction` (execute.ts) checks the
 * caller is an admin first, so an action cannot be reached by someone who is not.
 */
export interface AdminAction {
  /** Stable name: the audit log, the registry test and error logs use it. */
  readonly name: string;
  run(context: AdminActionContext, rawInput: unknown): Promise<ActionResult>;
}

export const fail = (
  status: ActionFailure["status"],
  error: string,
  message: string,
): ActionFailure => ({ ok: false, status, error, message });
