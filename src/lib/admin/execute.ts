import { denyUnlessAdmin, type Principal } from "./principal";
import { fail, type ActionResult, type AdminAction, type AdminDeps } from "./types";

/**
 * The one way an admin mutation runs. Every route handler and every test goes through here:
 *
 *   1. `denyUnlessAdmin`: 401 for nobody signed in, 403 for a signed-in non-admin. This happens
 *      before the input is read and before `makeDeps` is called, so a refused caller never builds a
 *      database client, let alone writes.
 *   2. the action runs with the verified admin as `actor`;
 *   3. a thrown error is logged and answers 500, never leaking its message.
 *
 * `makeDeps` is a factory so the secret-key client is created only for an admin.
 */
export async function executeAdminAction(
  action: AdminAction,
  principal: Principal,
  rawInput: unknown,
  makeDeps: () => AdminDeps,
): Promise<ActionResult> {
  const denied = denyUnlessAdmin(principal);
  if (denied) return denied;
  // `denyUnlessAdmin` returns null only for an admin user.
  if (principal.kind !== "user") return fail(401, "unauthenticated", "Sign in to continue.");
  try {
    return await action.run(
      { actor: { id: principal.id, email: principal.email }, deps: makeDeps() },
      rawInput,
    );
  } catch (error) {
    console.error(`[admin] ${action.name} failed`, error);
    return fail(500, "action_failed", "That didn’t work. Try again.");
  }
}
