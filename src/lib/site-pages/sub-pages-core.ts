import type { SupabaseClient } from "@supabase/supabase-js";
import {
  draftSubPageSchema,
  emptySubPageDraft,
  resolveNav,
  suggestPath,
  type SubPageDraft,
} from "@/lib/document";
import { pagesPerSiteMessage, toPlanId } from "@/lib/limits";
import { normalizePageName } from "@/lib/pages/name";
import type { Database, Json } from "@/lib/supabase/database.types";
import { pathProblem } from "./pages";

/**
 * Create and delete a sub-page of one of the signed-in account's sites (M11-04 step 7, M11-08),
 * written against an injected secret-key client so tests drive it without Next.js; the routes call
 * these with the server-only admin client. Clients cannot insert or delete `site_pages` rows (no
 * grant), so these are the only doors, and they check ownership themselves: the site must belong to
 * `userId` (a verified session user, never request input), and a suspended owner is refused, read
 * first and failing closed (a failed read refuses the write, a missing account reads as suspended).
 *
 * The limit is the database's: the BEFORE INSERT trigger raises HL008 when the site is at its plan's
 * pages per site, Home counted, and this layer turns it into the plan's message.
 */

export type SubPageError =
  | "not_found"
  | "account_suspended"
  | "page_limit"
  | "path_invalid"
  | "path_taken"
  | "create_failed"
  | "delete_failed";

export type CreateSubPageResult =
  | { ok: true; id: string; draft: SubPageDraft; createdAt: string }
  | { ok: false; status: number; error: SubPageError; message: string };

export type DeleteSubPageResult =
  | { ok: true; id: string; siteId: string; handle: string }
  | { ok: false; status: number; error: SubPageError; message: string };

export const SUB_PAGE_STATUS: Record<SubPageError, number> = {
  not_found: 404,
  account_suspended: 403,
  page_limit: 403,
  path_invalid: 422,
  path_taken: 409,
  create_failed: 500,
  delete_failed: 500,
};

export const SUB_PAGE_MESSAGES: Record<SubPageError, string> = {
  not_found: "That page doesn’t exist.",
  account_suspended:
    "Your account is suspended, so its pages can’t be changed. Contact support to appeal.",
  page_limit: "This site is at its limit of pages.",
  path_invalid: "Choose a valid path.",
  path_taken: "Another page of this site already uses that path.",
  create_failed: "Couldn’t add the page. Try again.",
  delete_failed: "Couldn’t delete the page. Try again.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const failure = (error: SubPageError, message?: string) => ({
  ok: false as const,
  status: SUB_PAGE_STATUS[error],
  error,
  message: message ?? SUB_PAGE_MESSAGES[error],
});

type Admin = SupabaseClient<Database>;

/** The account's plan, or null when it is suspended or unreadable (the write is refused). */
async function activeAccountPlan(admin: Admin, userId: string) {
  const account = await admin
    .from("accounts")
    .select("plan, suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) {
    console.error("[site-pages] reading the account failed", account.error.message);
    return { kind: "error" as const };
  }
  if (!account.data || account.data.suspended_at !== null) return { kind: "suspended" as const };
  return { kind: "ok" as const, plan: toPlanId(account.data.plan) };
}

async function ownedSite(admin: Admin, userId: string, siteId: unknown) {
  if (typeof siteId !== "string" || !UUID.test(siteId)) return null;
  const site = await admin
    .from("pages")
    .select("id, handle")
    .eq("id", siteId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (site.error) throw new Error(`Site lookup failed: ${site.error.message}`);
  return site.data;
}

export async function createSubPageWithClient(
  admin: Admin,
  input: { userId: string; siteId: unknown; title?: unknown; path?: unknown },
): Promise<CreateSubPageResult> {
  const account = await activeAccountPlan(admin, input.userId);
  if (account.kind === "error") return failure("create_failed");
  if (account.kind === "suspended") return failure("account_suspended");
  const site = await ownedSite(admin, input.userId, input.siteId);
  if (!site) return failure("not_found");

  // A title that is not given, or is blank, is "New page" (the page can be renamed at once).
  const named = typeof input.title === "string" ? normalizePageName(input.title) : null;
  const title = named?.ok ? named.name : "New page";

  const existing = await admin.from("site_pages").select("draft, live_path").eq("page_id", site.id);
  if (existing.error) throw new Error(`Sub-page lookup failed: ${existing.error.message}`);
  const taken: string[] = [];
  for (const row of existing.data ?? []) {
    const parsed = draftSubPageSchema.safeParse(row.draft);
    if (parsed.success) taken.push(parsed.data.path);
    else if (typeof (row.draft as { path?: unknown } | null)?.path === "string") {
      taken.push((row.draft as { path: string }).path);
    }
    if (row.live_path !== null) taken.push(row.live_path);
  }

  let path: string;
  if (typeof input.path === "string") {
    path = input.path.trim();
    const problem = pathProblem(path, taken);
    if (problem !== null) {
      const duplicate = taken.includes(path) && pathProblem(path, []) === null;
      return failure(duplicate ? "path_taken" : "path_invalid", problem);
    }
  } else {
    path = suggestPath(title, taken);
  }

  const draft = emptySubPageDraft(path, title);
  const inserted = await admin
    .from("site_pages")
    .insert({ page_id: site.id, draft: draft as unknown as Json })
    .select("id, created_at")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "HL008") {
      const count = await admin
        .from("site_pages")
        .select("id", { count: "exact", head: true })
        .eq("page_id", site.id);
      return failure("page_limit", pagesPerSiteMessage(account.plan, (count.count ?? 0) + 1));
    }
    console.error("[site-pages] create failed", inserted.error.code, inserted.error.message);
    return failure("create_failed");
  }
  return { ok: true, id: inserted.data.id, draft, createdAt: inserted.data.created_at };
}

/**
 * Takes one id out of Home's draft menu without touching `draft.rev`, so the owner's open editor
 * keeps its stale-tab guard (it removes the entry itself too). The write is conditional on the rev
 * it read; a concurrent autosave makes it match nothing and it reads again, a few times. Whatever is
 * left over is harmless: Publish drops menu items that are not pages of the site.
 */
async function removeFromHomeNav(admin: Admin, siteId: string, subPageId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await admin
      .from("pages")
      .select("draft, draft_rev:draft->>rev")
      .eq("id", siteId)
      .single();
    if (read.error) throw new Error(`Home lookup failed: ${read.error.message}`);
    const draft = read.data.draft as Record<string, unknown> | null;
    if (!draft || typeof draft !== "object" || !("nav" in draft) || draft.nav === undefined) return;
    const nav = resolveNav(draft.nav as { show?: boolean; items?: string[] });
    if (!nav.items.includes(subPageId)) return;
    const next = {
      ...draft,
      nav: { show: nav.show, items: nav.items.filter((id) => id !== subPageId) },
    };
    const update = admin
      .from("pages")
      .update({ draft: next as unknown as Json })
      .eq("id", siteId);
    const conditional =
      read.data.draft_rev === null
        ? update.is("draft->>rev", null)
        : update.eq("draft->>rev", read.data.draft_rev);
    const written = await conditional.select("id");
    if (written.error) throw new Error(`Home update failed: ${written.error.message}`);
    if (written.data.length > 0) return;
  }
}

export async function deleteSubPageWithClient(
  admin: Admin,
  input: { userId: string; siteId: unknown; subPageId: unknown },
): Promise<DeleteSubPageResult> {
  const account = await activeAccountPlan(admin, input.userId);
  if (account.kind === "error") return failure("delete_failed");
  if (account.kind === "suspended") return failure("account_suspended");
  const site = await ownedSite(admin, input.userId, input.siteId);
  if (!site) return failure("not_found");
  if (typeof input.subPageId !== "string" || !UUID.test(input.subPageId)) {
    return failure("not_found");
  }

  const deleted = await admin
    .from("site_pages")
    .delete()
    .eq("id", input.subPageId)
    .eq("page_id", site.id)
    .select("id");
  if (deleted.error) {
    console.error("[site-pages] delete failed", deleted.error.message);
    return failure("delete_failed");
  }
  if (!deleted.data || deleted.data.length === 0) return failure("not_found");

  try {
    await removeFromHomeNav(admin, site.id, input.subPageId);
  } catch (error) {
    // The page is gone; a stale menu entry is dropped by Publish.
    console.error(
      "[site-pages] removing the menu entry failed",
      error instanceof Error ? error.message : "",
    );
  }
  return { ok: true, id: input.subPageId, siteId: site.id, handle: site.handle };
}
