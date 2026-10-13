import type { SupabaseClient } from "@supabase/supabase-js";
import {
  draftSubPageSchema,
  emptySubPageDraft,
  resolveNav,
  suggestPath,
  type SubPageDraft,
} from "@/lib/document";
import { createEntryWithClient } from "@/lib/content/entries-core";
import { purgeEntryWithClient, trashEntryWithClient } from "@/lib/content/trash-core";
import type { ContentActor } from "@/lib/content/types";
import { pagesPerSiteMessage, toPlanId } from "@/lib/limits";
import { normalizePageName } from "@/lib/pages/name";
import type { Database, Json } from "@/lib/supabase/database.types";
import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import { pathProblem } from "./pages";

/**
 * Create and delete a sub-page of one of the signed-in account's sites (M11-04 step 7, M11-08),
 * written against an injected secret-key client so tests drive it without Next.js; the routes call
 * these with the server-only admin client. A sub-page is a page entry (stage 1b): create goes through
 * the content writer (`createEntryWithClient`, type page) and delete trashes the entry. Clients have
 * no insert or delete grant on entries, so these are the only doors, and they check ownership
 * themselves: the site must belong to `userId` (a verified session user, never request input), and a
 * suspended owner is refused, read first and failing closed (a failed read refuses the write, a
 * missing account reads as suspended).
 *
 * The limit is the database's: the BEFORE INSERT trigger raises HL008 when the site is at its plan's
 * pages per site, Home and trashed pages counted, and this layer turns it into the plan's message.
 * A taken or reserved path is HL012 at insert; the path check here only gives the better message.
 */

export type SubPageError =
  | "not_found"
  | "account_suspended"
  | "page_limit"
  | "storage_full"
  | "path_invalid"
  | "path_taken"
  | "doc_invalid"
  | "create_failed"
  | "delete_failed";

export type CreateSubPageResult =
  | {
      ok: true;
      id: string;
      draft: SubPageDraft;
      /** The new entry's rev: every save of this page is checked against it. */
      rev: number;
      createdAt: string;
      updatedAt: string;
    }
  | { ok: false; status: number; error: SubPageError; message: string };

export type DeleteSubPageResult =
  | { ok: true; id: string; siteId: string; handle: string; purged: boolean }
  | { ok: false; status: number; error: SubPageError; message: string };

export const SUB_PAGE_STATUS: Record<SubPageError, number> = {
  not_found: 404,
  account_suspended: 403,
  page_limit: 403,
  storage_full: 403,
  path_invalid: 422,
  path_taken: 409,
  doc_invalid: 422,
  create_failed: 500,
  delete_failed: 500,
};

export const SUB_PAGE_MESSAGES: Record<SubPageError, string> = {
  not_found: "That page doesn’t exist.",
  account_suspended:
    "Your account is suspended, so its pages can’t be changed. Contact support to appeal.",
  page_limit: "This site is at its limit of pages.",
  storage_full: STORAGE_FULL_MESSAGE,
  path_invalid: "Choose a valid path.",
  path_taken: "Another page of this site already uses that path.",
  doc_invalid: "That page’s content isn’t valid.",
  create_failed: "Couldn’t add the page. Try again.",
  delete_failed: "Couldn’t delete the page. Try again.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page made less than this long ago, and never published, may be purged on delete. */
const PURGE_WINDOW_MS = 10 * 60 * 1000;

const actorOf = (userId: string): ContentActor => ({ userId, source: "editor" });

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
  input: {
    userId: string;
    siteId: unknown;
    title?: unknown;
    path?: unknown;
    /** Optional starting content (a template page, a duplicate): checked with the draft schema. */
    description?: unknown;
    blocks?: unknown;
  },
): Promise<CreateSubPageResult> {
  const account = await activeAccountPlan(admin, input.userId);
  if (account.kind === "error") return failure("create_failed");
  if (account.kind === "suspended") return failure("account_suspended");
  const site = await ownedSite(admin, input.userId, input.siteId);
  if (!site) return failure("not_found");

  // A title that is not given, or is blank, is "New page" (the page can be renamed at once).
  const named = typeof input.title === "string" ? normalizePageName(input.title) : null;
  const title = named?.ok ? named.name : "New page";

  // Paths only (draft->>path), never whole drafts. Home ('/') is not a sub-page's path, and a
  // trashed page has let go of its path.
  const existing = await admin
    .from("content_entries")
    .select("path:draft->>path, live_path, content_types!inner(key)")
    .eq("site_id", site.id)
    .eq("content_types.key", "page")
    .is("deleted_at", null);
  if (existing.error) throw new Error(`Sub-page lookup failed: ${existing.error.message}`);
  const taken: string[] = [];
  for (const row of existing.data ?? []) {
    const { path: draftPath } = row as unknown as { path: string | null };
    if (typeof draftPath === "string" && draftPath !== "/") taken.push(draftPath);
    if (row.live_path !== null && row.live_path !== "/") taken.push(row.live_path);
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

  let draft = emptySubPageDraft(path, title);
  if (input.description !== undefined || input.blocks !== undefined) {
    const parsed = draftSubPageSchema.safeParse({
      ...draft,
      description: input.description ?? "",
      blocks: input.blocks ?? [],
    });
    if (!parsed.success) return failure("doc_invalid");
    draft = parsed.data;
  }
  const made = await createEntryWithClient(admin, {
    actor: actorOf(input.userId),
    siteId: site.id,
    typeKey: "page",
    draft,
  });
  if (!made.ok) {
    switch (made.error) {
      case "page_limit": {
        // Home plus every sub-page entry, trash included: what the trigger counted.
        const count = await admin
          .from("content_entries")
          .select("id, content_types!inner(key)", { count: "exact", head: true })
          .eq("site_id", site.id)
          .eq("content_types.key", "page")
          .neq("draft->>path", "/");
        return failure("page_limit", pagesPerSiteMessage(account.plan, (count.count ?? 0) + 1));
      }
      case "path_taken":
        return failure("path_taken");
      case "slug_reserved":
      case "slug_taken":
        return failure("path_taken");
      case "storage_full":
        return failure("storage_full");
      case "account_suspended":
        return failure("account_suspended");
      case "not_found":
        return failure("not_found");
      case "invalid":
      case "blocked_link":
      case "too_large":
        return failure("doc_invalid", made.message);
      default:
        console.error("[site-pages] create failed", made.error, made.message);
        return failure("create_failed");
    }
  }
  return {
    ok: true,
    id: made.id,
    draft,
    rev: made.rev,
    // An insert sets both dates to now.
    createdAt: made.updatedAt,
    updatedAt: made.updatedAt,
  };
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
    // Menu ids are lowercase uuids in Home's draft; the id given here may be spelled in upper case.
    const wanted = subPageId.toLowerCase();
    if (!nav.items.some((id) => typeof id === "string" && id.toLowerCase() === wanted)) return;
    const next = {
      ...draft,
      nav: {
        show: nav.show,
        items: nav.items.filter((id) => typeof id !== "string" || id.toLowerCase() !== wanted),
      },
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
  input: { userId: string; siteId: unknown; subPageId: unknown; purge?: boolean },
): Promise<DeleteSubPageResult> {
  const { userId } = input;
  const account = await activeAccountPlan(admin, userId);
  if (account.kind === "error") return failure("delete_failed");
  if (account.kind === "suspended") return failure("account_suspended");
  const site = await ownedSite(admin, userId, input.siteId);
  if (!site) return failure("not_found");
  if (typeof input.subPageId !== "string" || !UUID.test(input.subPageId)) {
    return failure("not_found");
  }
  const subPageId = input.subPageId.toLowerCase();

  // The page entry of this site that is not Home and not already in the trash.
  const read = async () => {
    const found = await admin
      .from("content_entries")
      .select("id, rev, created_at, published, content_types!inner(key)")
      .eq("id", subPageId)
      .eq("site_id", site.id)
      .eq("content_types.key", "page")
      .neq("draft->>path", "/")
      .is("deleted_at", null)
      .maybeSingle();
    if (found.error) throw new Error(`Sub-page lookup failed: ${found.error.message}`);
    return found.data;
  };

  // A concurrent autosave moves the rev: read it again, a few times.
  let entry = await read();
  if (!entry) return failure("not_found");
  let trashed = false;
  for (let attempt = 0; attempt < 3 && !trashed; attempt++) {
    const out = await trashEntryWithClient(admin, {
      actor: actorOf(userId),
      entryId: entry.id,
      expectedRev: Number(entry.rev),
    });
    if (out.ok) {
      trashed = true;
    } else if (out.error === "conflict") {
      const again = await read();
      if (!again) return failure("not_found");
      entry = again;
    } else if (out.error === "not_found") {
      return failure("not_found");
    } else if (out.error === "account_suspended") {
      return failure("account_suspended");
    } else {
      console.error("[site-pages] delete failed", out.error, out.message);
      return failure("delete_failed");
    }
  }
  if (!trashed) return failure("delete_failed");

  // An undo of a page made a moment ago (a failed template apply) takes it out for good, so it does
  // not keep a place in the limit. A page that is old or was ever published stays in the trash.
  let purgedForGood = false;
  if (
    input.purge === true &&
    entry.published === null &&
    Date.now() - new Date(entry.created_at).getTime() < PURGE_WINDOW_MS
  ) {
    const purged = await purgeEntryWithClient(admin, {
      actor: actorOf(userId),
      entryId: entry.id,
    });
    purgedForGood = purged.ok;
    if (!purged.ok) console.error("[site-pages] purge failed", purged.error, purged.message);
  }

  try {
    await removeFromHomeNav(admin, site.id, subPageId);
  } catch (error) {
    // The page is gone; a stale menu entry is dropped by Publish.
    console.error(
      "[site-pages] removing the menu entry failed",
      error instanceof Error ? error.message : "",
    );
  }
  return { ok: true, id: subPageId, siteId: site.id, handle: site.handle, purged: purgedForGood };
}
