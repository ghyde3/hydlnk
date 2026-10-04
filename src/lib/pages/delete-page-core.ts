import type { SupabaseClient } from "@supabase/supabase-js";
import { expireDomainHost } from "@/lib/domains/expire-host";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Delete one page of the signed-in account (M4-19), written against an injected secret-key client
 * so tests drive it without Next.js; production code calls `deletePage` from "./delete-page".
 *
 * Order matters: ownership first (another account's page id, and an id that does not exist, are
 * both 404 and touch nothing), then the typed confirmation (checked here, not only in the dialog),
 * then each custom domain is removed from the hosting project, and only then is the `pages` row
 * deleted (its domains, events and daily_stats rows go with it by cascade). A domain that cannot be
 * removed aborts the whole delete: the page and every domain row stay, so a retry starts clean and
 * a hostname never lingers on the project without a row to find it by.
 *
 * A suspended owner cannot delete a page (M5-09): deleting it would free the handle and erase what
 * the admin needs to see. The account is read first, with the same secret key, before anything is
 * looked up or removed; a failed read refuses the delete (fail closed), a missing account row reads
 * as suspended.
 *
 * `userId` MUST be the verified session user, never request input.
 */

export type DeletePageError =
  | "not_found"
  | "confirmation_mismatch"
  | "domain_removal_failed"
  | "delete_failed"
  /** The owner's account is suspended (M5-09): deleting would erase the suspension and the evidence. */
  | "account_suspended";

export type DeletePageResult =
  | { ok: true; pageId: string; handle: string; remaining: number }
  | { ok: false; status: number; error: DeletePageError; message: string };

export interface DeletePageDeps {
  /** Takes one hostname off the hosting project. Resolves when it is gone (already gone counts); throws otherwise. */
  removeDomain(hostname: string): Promise<void>;
}

export const DELETE_PAGE_STATUS: Record<DeletePageError, number> = {
  not_found: 404,
  confirmation_mismatch: 400,
  domain_removal_failed: 502,
  delete_failed: 500,
  account_suspended: 403,
};

export const DELETE_PAGE_MESSAGES: Record<DeletePageError, string> = {
  not_found: "That page doesn’t exist.",
  confirmation_mismatch: "That doesn’t match the handle. Type it exactly to confirm.",
  domain_removal_failed: "Couldn’t remove its custom domain. Try again.",
  delete_failed: "Couldn’t delete the page. Try again.",
  account_suspended:
    "Your account is suspended, so its pages can’t be deleted. Contact support to appeal.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const failure = (error: DeletePageError): DeletePageResult => ({
  ok: false,
  status: DELETE_PAGE_STATUS[error],
  error,
  message: DELETE_PAGE_MESSAGES[error],
});

export async function deletePageWithClient(
  admin: SupabaseClient<Database>,
  input: { userId: string; pageId: unknown; confirm: unknown },
  deps: DeletePageDeps,
): Promise<DeletePageResult> {
  const { userId, pageId, confirm } = input;
  const account = await admin
    .from("accounts")
    .select("suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) {
    console.error("[pages] reading the account before a page delete failed", account.error.message);
    return failure("delete_failed");
  }
  if (!account.data || account.data.suspended_at !== null) return failure("account_suspended");
  if (typeof pageId !== "string" || !UUID.test(pageId)) return failure("not_found");

  const page = await admin
    .from("pages")
    .select("id, handle")
    .eq("id", pageId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (page.error) throw new Error(`Page lookup failed: ${page.error.message}`);
  if (!page.data) return failure("not_found");

  if (typeof confirm !== "string" || confirm !== page.data.handle) {
    return failure("confirmation_mismatch");
  }

  const domains = await admin.from("domains").select("hostname").eq("page_id", pageId);
  if (domains.error) throw new Error(`Domain lookup failed: ${domains.error.message}`);
  for (const { hostname } of domains.data ?? []) {
    try {
      await deps.removeDomain(hostname);
    } catch (error) {
      console.error(
        "[pages] removing a custom domain before a page delete failed",
        hostname,
        error,
      );
      return failure("domain_removal_failed");
    }
  }

  const deleted = await admin
    .from("pages")
    .delete()
    .eq("id", pageId)
    .eq("owner_id", userId)
    .select("id");
  if (deleted.error) {
    console.error("[pages] page delete failed", deleted.error.message);
    return failure("delete_failed");
  }
  if (!deleted.data || deleted.data.length === 0) return failure("not_found");

  // The page and its domains are gone: the proxy must stop answering for those hostnames (M8-11).
  for (const { hostname } of domains.data ?? []) expireDomainHost(hostname);

  const remaining = await admin
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (remaining.error) throw new Error(`Page count failed: ${remaining.error.message}`);

  return { ok: true, pageId, handle: page.data.handle, remaining: remaining.count ?? 0 };
}
