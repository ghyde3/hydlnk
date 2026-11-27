import type { SupabaseClient } from "@supabase/supabase-js";
import {
  draftSubPageSchema,
  emptySubPageDraft,
  suggestPath,
  type SubPageDraft,
} from "@/lib/document";
import {
  countSubPageEntriesWithClient,
  listPagePathsWithClient,
} from "@/lib/site/page-entries-core";
import { createEntryWithClient } from "@/lib/content";
import {
  needForEntryWrite,
  recordSiteActivity,
  requireEntryAccess,
  requireSiteAccess,
  type AccessRefusal,
} from "@/lib/access";
import { activityAllowed } from "@/lib/team/activity-limit";
import { ACTIVITY_RATE_LIMITED_MESSAGE, PUBLISH_FORBIDDEN_MESSAGE } from "@/lib/team/messages";
import type { ContentActor } from "@/lib/content";
import { pagesPerSiteMessage } from "@/lib/limits";
import { normalizePageName } from "@/lib/pages/name";
import type { Database } from "@/lib/supabase/database.types";
import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import { pathProblem } from "./pages";

/**
 * Create and delete a sub-page of one of the signed-in account's sites (M11-04 step 7, M11-08),
 * written against an injected secret-key client so tests drive it without Next.js; the routes call
 * these with the server-only admin client. A sub-page is a page entry (stage 1b): create goes through
 * the content writer (`createEntryWithClient`, type page) and delete removes the entry for good in one
 * transaction (`delete_page_entry`, M15-13). Clients have
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
  | "forbidden"
  | "account_suspended"
  | "page_limit"
  | "storage_full"
  | "path_invalid"
  | "path_taken"
  | "doc_invalid"
  | "create_failed"
  | "delete_failed"
  /** Past the activity limit (team attack pass, finding 2). */
  | "rate_limited";

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
  forbidden: 403,
  account_suspended: 403,
  page_limit: 403,
  storage_full: 403,
  path_invalid: 422,
  path_taken: 409,
  doc_invalid: 422,
  create_failed: 500,
  delete_failed: 500,
  rate_limited: 429,
};

export const SUB_PAGE_MESSAGES: Record<SubPageError, string> = {
  not_found: "That page doesn’t exist.",
  forbidden: PUBLISH_FORBIDDEN_MESSAGE,
  account_suspended:
    "Your account is suspended, so its pages can’t be changed. Contact support to appeal.",
  page_limit: "This site is at its limit of pages.",
  storage_full: STORAGE_FULL_MESSAGE,
  path_invalid: "Choose a valid path.",
  path_taken: "Another page of this site already uses that path.",
  doc_invalid: "That page’s content isn’t valid.",
  create_failed: "Couldn’t add the page. Try again.",
  delete_failed: "Couldn’t delete the page. Try again.",
  rate_limited: ACTIVITY_RATE_LIMITED_MESSAGE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const failure = (error: SubPageError, message?: string) => ({
  ok: false as const,
  status: SUB_PAGE_STATUS[error],
  error,
  message: message ?? SUB_PAGE_MESSAGES[error],
});

type Admin = SupabaseClient<Database>;

/** A refusal of the access helper in this layer's words (`unexpected`: a failed read). */
function refusalOf(refusal: AccessRefusal, unexpected: SubPageError) {
  return failure(refusal.reason === "error" ? unexpected : refusal.reason);
}

export async function createSubPageWithClient(
  admin: Admin,
  input: {
    userId: string;
    /** Where the call came from (S4): the MCP tool says "mcp", so decide() applies its owner-only rule. */
    source: ContentActor["source"];
    siteId: unknown;
    title?: unknown;
    path?: unknown;
    /** Optional starting content (a template page, a duplicate): checked with the draft schema. */
    description?: unknown;
    blocks?: unknown;
  },
): Promise<CreateSubPageResult> {
  // Adding a draft page is an edit: an editor may; the owner's plan is the limit (access.plan).
  const found = await requireSiteAccess(admin, {
    actorId: input.userId,
    siteId: input.siteId,
    need: "edit",
    source: input.source,
  });
  if (!found.ok) return refusalOf(found, "create_failed");
  const { access } = found;
  const site = { id: access.siteId };

  // A title that is not given, or is blank, is "New page" (the page can be renamed at once).
  const named = typeof input.title === "string" ? normalizePageName(input.title) : null;
  const title = named?.ok ? named.name : "New page";

  // Paths only (draft->>path), never whole drafts. Home ('/') is not a sub-page's path, and a
  // trashed page has let go of its path.
  const taken: string[] = [];
  for (const { draftPath, livePath } of await listPagePathsWithClient(admin, site.id)) {
    if (typeof draftPath === "string" && draftPath !== "/") taken.push(draftPath);
    if (livePath !== null && livePath !== "/") taken.push(livePath);
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
  if (!(await activityAllowed(access.actorId))) return failure("rate_limited");
  const made = await createEntryWithClient(admin, {
    actor: { userId: input.userId, source: input.source },
    siteId: site.id,
    typeKey: "page",
    draft,
  });
  if (!made.ok) {
    switch (made.error) {
      case "page_limit": {
        // Home plus every sub-page entry, trash included: what the trigger counted.
        const count = await countSubPageEntriesWithClient(admin, site.id);
        return failure("page_limit", pagesPerSiteMessage(access.plan, count + 1));
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
      case "forbidden":
        return failure("forbidden");
      case "invalid":
      case "blocked_link":
      case "too_large":
        return failure("doc_invalid", made.message);
      default:
        console.error("[site-pages] create failed", made.error, made.message);
        return failure("create_failed");
    }
  }
  await recordSiteActivity(admin, access, "page_created", made.id);
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

export async function deleteSubPageWithClient(
  admin: Admin,
  input: { userId: string; siteId: unknown; subPageId: unknown; purge?: boolean },
): Promise<DeleteSubPageResult> {
  if (typeof input.siteId !== "string" || !UUID.test(input.siteId)) return failure("not_found");
  if (typeof input.subPageId !== "string" || !UUID.test(input.subPageId)) {
    return failure("not_found");
  }
  const subPageId = input.subPageId.toLowerCase();
  // Access on the entry's own site, which must be the URL's: deleting a live page is publish-class,
  // a draft-only page an edit (needForEntryWrite).
  const found = await requireEntryAccess(admin, {
    actorId: input.userId,
    entryId: subPageId,
    siteId: input.siteId.toLowerCase(),
    need: (entry) => needForEntryWrite(entry, "delete"),
    source: "editor",
  });
  if (!found.ok) return refusalOf(found, "delete_failed");
  const { access } = found;
  const handle = await admin.from("pages").select("handle").eq("id", access.siteId).maybeSingle();
  if (handle.error || !handle.data) return failure("delete_failed");
  const site = { id: access.siteId, handle: handle.data.handle };

  // One transaction (delete_page_entry): the entry, its revisions, its links, its path claims and
  // its item in the site's draft menu (pages.draft nav.items, `draft.rev` untouched, so the owner's
  // open editor keeps its stale-tab guard) go together or not at all. The page limit frees at once
  // and a failure leaves the page fully in place, still listed, still live and still in the menu.
  // It takes a live page and one already in the trash; Home, another site's entry and an unknown id
  // are all P0002. (Posts keep the 30-day trash; this door is for pages only.)
  // R8: decided again under the entry row's lock, through the rule (a page that went live since the
  // read above needs publish: 42501).
  if (!(await activityAllowed(access.actorId))) return failure("rate_limited");
  const deleted = await admin.rpc("delete_page_entry_as", {
    p_entry_id: subPageId,
    p_site_id: site.id,
    p_owner_id: access.ownerId,
    p_actor: access.actorId,
  });
  if (deleted.error) {
    if (deleted.error.code === "P0002") return failure("not_found");
    if (deleted.error.code === "42501") return failure("forbidden");
    console.error("[site-pages] delete failed", deleted.error.code, deleted.error.message);
    return failure("delete_failed");
  }
  await recordSiteActivity(admin, access, "entry_deleted", subPageId);
  return { ok: true, id: subPageId, siteId: site.id, handle: site.handle, purged: true };
}
