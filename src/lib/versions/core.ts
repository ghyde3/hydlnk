import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checkBlocklist, readBlockedLinkError } from "@/lib/blocklist";
import { LIMITS, draftDocSchema, publishedDocSchema, type PublishDoc } from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";
import { PLAN_LIMITS } from "@/lib/limits";
import { MEDIA_BUCKET } from "@/lib/media/limits";
import { mediaOrigin } from "@/lib/media/url";
import { recordSiteActivity, requireSiteAccess, type SiteAccess } from "@/lib/access";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { activityAllowed } from "@/lib/team/activity-limit";
import type { Database, Json } from "@/lib/supabase/database.types";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import {
  nextRev,
  nullMissingImages,
  nullMissingSubPageImages,
  ownedImagePaths,
  restoredTheme,
  versionToDraft,
  type CheckedImages,
} from "./restore";
import { parseStoredSubPages } from "./site";
import type { PreviewResult, PreviewSubPage, RestoreResult, VersionFailureReason } from "./types";

/**
 * Preview and restore of a published version (M6-49), everything except what a Server Action alone
 * does (reading the session; see actions.ts). Both take two ids and the verified session user and
 * nothing else: the document is read from Postgres here, never taken from the caller, and nothing
 * here touches the cache, so the live page cannot change.
 *
 * The checks run in this order, and nothing is read or written before the previous one has passed:
 *
 *   1. no session user                              -> unauthorized
 *   2. a page id that is not a uuid, a page the user does not own, or one that does not exist
 *                                                  -> forbidden (the version id is not looked at)
 *   3. the owner's account is suspended              -> account_suspended
 *   4. `accounts.plan` keeps no versions (the limits table's `versionsKept` is 0)
 *                                                  -> plan_required (no version row is read)
 *   5. a version id that is malformed, unknown or belongs to another page
 *                                                  -> not_found (the same answer for all three, so ids cannot be probed)
 *   6. the work.
 *
 * Failures log a short code and the ids (only when they are real uuids), never a document, a URL,
 * a database message or a token.
 */

export interface VersionDeps {
  /** Secret-key client (RLS does not apply: every check below is ours). */
  admin?: SupabaseClient<Database>;
  /** Does `page-media` hold this object? Defaults to a Storage HEAD with the secret key. */
  mediaExists?: (path: string) => Promise<boolean>;
}

export interface VersionInput {
  pageId: unknown;
  versionId: unknown;
  /** The verified session user's id, or null with no session. */
  userId: string | null;
}

const guid = z.guid();
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Op = "preview" | "restore";

/** A short code and the ids, nothing else: an id that is not a real uuid is not echoed at all. */
function logFailure(op: Op, code: string, ids: { page?: unknown; version?: unknown }): void {
  const id = (value: unknown) => (typeof value === "string" && UID.test(value) ? value : "-");
  const line = `[versions] ${op} ${code} page=${id(ids.page)} version=${id(ids.version)}`;
  if (code === "error") console.error(line);
  else console.warn(line);
}

interface OpenVersion {
  admin: SupabaseClient<Database>;
  /** The site's OWNER (folder, themes, the draft write's filter); `access.actorId` is who asked. */
  ownerId: string;
  access: SiteAccess;
  pageId: string;
  /** `pages.draft` as stored, and its rev as Postgres reads it (`draft->>rev`); restore only. */
  draft: unknown;
  draftRev: string | null;
  version: { id: string; versionNo: number; document: unknown; subPages: unknown };
}

type Opened = { ok: true; value: OpenVersion } | { ok: false; reason: VersionFailureReason };

/** Checks 1 to 5 above. `withDraft` also reads the page's draft with the owner check (restore). */
async function openVersion(
  op: Op,
  input: VersionInput,
  deps: VersionDeps,
  withDraft: boolean,
): Promise<Opened> {
  const fail = (reason: VersionFailureReason): Opened => {
    logFailure(op, reason, { page: input.pageId, version: input.versionId });
    return { ok: false, reason };
  };

  if (!input.userId || !UID.test(input.userId)) return fail("unauthorized");
  const userId = input.userId;
  const pageId = guid.safeParse(input.pageId);
  if (!pageId.success) return fail("forbidden");

  const admin = deps.admin ?? createAdminSupabase();

  // Access first (Wave F, the one helper): members preview and restore into the draft (G5), both
  // asked as `edit` so a suspended owner gets account_suspended for either, as before (M6-49). The
  // secret key bypasses RLS, so this is the access rule; a stranger's site answers `forbidden`.
  const allowed = await requireSiteAccess(admin, {
    actorId: userId,
    siteId: pageId.data,
    need: "edit",
    source: "editor",
  });
  if (!allowed.ok) {
    if (allowed.reason === "error") {
      logFailure(op, "error", { page: pageId.data });
      return { ok: false, reason: "error" };
    }
    return fail(allowed.reason === "account_suspended" ? "account_suspended" : "forbidden");
  }
  const { access } = allowed;
  const page = await admin
    .from("pages")
    .select(withDraft ? "id, owner_id, draft, draft_rev:draft->>rev" : "id, owner_id")
    .eq("id", pageId.data)
    .maybeSingle();
  if (page.error) {
    logFailure(op, "error", { page: pageId.data });
    return { ok: false, reason: "error" };
  }
  const row = page.data as {
    id: string;
    owner_id: string;
    draft?: unknown;
    draft_rev?: string | null;
  } | null;
  if (!row) return fail("forbidden");
  // The OWNER's plan decides whether version history is included.
  if (PLAN_LIMITS[access.plan].versionsKept <= 0) return fail("plan_required");

  // Only now is a version id looked at. Malformed, unknown and another page's all read the same.
  const versionId = guid.safeParse(input.versionId);
  if (!versionId.success) return fail("not_found");
  const found = await admin
    .from("page_versions")
    .select("id, version_no, document, sub_pages")
    .eq("id", versionId.data)
    .eq("page_id", pageId.data)
    .maybeSingle();
  if (found.error) {
    logFailure(op, "error", { page: pageId.data });
    return { ok: false, reason: "error" };
  }
  if (!found.data) return fail("not_found");

  return {
    ok: true,
    value: {
      admin,
      ownerId: access.ownerId,
      access,
      pageId: pageId.data,
      draft: row.draft ?? null,
      draftRev: row.draft_rev ?? null,
      version: {
        id: found.data.id,
        versionNo: found.data.version_no,
        document: found.data.document,
        subPages: found.data.sub_pages,
      },
    },
  };
}

/** Which of `paths` exist in `page-media`, looked up eight at a time. Throws when Storage cannot answer. */
async function presentPaths(
  paths: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<Set<string>> {
  const present = new Set<string>();
  for (let i = 0; i < paths.length; i += 8) {
    const batch = paths.slice(i, i + 8);
    const results = await Promise.all(batch.map((path) => exists(path)));
    batch.forEach((path, index) => {
      if (results[index] === true) present.add(path);
    });
  }
  return present;
}

function storageExists(admin: SupabaseClient<Database>) {
  const bucket = admin.storage.from(MEDIA_BUCKET);
  return async (path: string): Promise<boolean> => {
    const { data } = await bucket.exists(path);
    return data;
  };
}

/** The version as stored, every image check applied: Home and each sub-page, parsed and cleaned. */
interface CheckedVersion {
  parsed: PublishDoc;
  checked: CheckedImages;
  /** The sub-pages of the version (M12-04), ordered by path, with their missing images taken out. */
  subPages: PreviewSubPage[];
  /** Missing images over Home and every sub-page. */
  missingImages: number;
}

/**
 * The stored document and sub-pages, parsed with the strict published schemas, with every image
 * that cannot be shown replaced by null. A version that does not parse (Home or any sub-page) is
 * `null` (the raw JSON is never returned). Throws when Storage cannot be asked.
 */
async function checkedVersion(
  open: OpenVersion,
  deps: VersionDeps,
): Promise<CheckedVersion | null> {
  const parsed = publishedDocSchema.safeParse(open.version.document);
  if (!parsed.success) return null;
  const stored = parseStoredSubPages(open.version.subPages);
  if (stored === null) return null;
  const origin = mediaOrigin();
  const exists = deps.mediaExists ?? storageExists(open.admin);
  const present = await presentPaths(
    ownedImagePaths(
      parsed.data,
      open.ownerId,
      origin,
      stored.map((page) => page.doc),
    ),
    exists,
  );
  const isPresent = (path: string) => present.has(path);
  const checked = nullMissingImages(parsed.data, open.ownerId, origin, isPresent);
  let missingImages = checked.missingImages;
  const subPages = stored.map((page): PreviewSubPage => {
    const result = nullMissingSubPageImages(page.doc, open.ownerId, isPresent);
    missingImages += result.missingImages;
    return { id: page.id, path: page.path, title: page.title, doc: result.page };
  });
  return { parsed: parsed.data, checked, subPages, missingImages };
}

/**
 * Tokens of a theme row, or null: no theme, a deleted one, one the owner cannot use (system themes
 * and the owner's own are the only ones read, the rule RLS gives the editor) or one whose tokens do
 * not parse. Same lookup as the Publish gate.
 */
async function loadThemeTokens(
  admin: SupabaseClient<Database>,
  ref: string | null,
  ownerId: string,
): Promise<Partial<TokenSet> | null> {
  if (!ref) return null;
  const { data, error } = await admin
    .from("themes")
    .select("tokens")
    .eq("id", ref)
    .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
    .maybeSingle();
  if (error) throw new Error(`reading the theme failed (${error.code ?? "unknown"})`);
  if (!data) return null;
  const tokens = tokenSetSchema.partial().safeParse(data.tokens);
  return tokens.success ? tokens.data : null;
}

/**
 * Preview (M6-49): the stored document of one version, ready for the shared renderer. Reads only:
 * no write, no cache call. The result is the parsed document with the images that are gone replaced
 * by null (and the background image dropped the same way), and how many there were.
 */
export async function loadVersionPreviewCore(
  input: VersionInput,
  deps: VersionDeps = {},
): Promise<PreviewResult> {
  const opened = await openVersion("preview", input, deps, false);
  if (!opened.ok) return opened;
  const open = opened.value;

  let result: Awaited<ReturnType<typeof checkedVersion>>;
  try {
    result = await checkedVersion(open, deps);
  } catch {
    logFailure("preview", "error", { page: open.pageId, version: open.version.id });
    return { ok: false, reason: "error" };
  }
  if (result === null) {
    logFailure("preview", "error", { page: open.pageId, version: open.version.id });
    return { ok: false, reason: "error" };
  }
  return {
    ok: true,
    doc: result.checked.doc,
    missingImages: result.missingImages,
    subPages: result.subPages,
  };
}

/**
 * Restore (M6-49; design only since M15-10): writes the version's DESIGN into `pages.draft` and
 * nothing else. The design is everything of the site that is not a page's content: profile, theme,
 * menu, banner, share card, UTM tags and redirect. No page entry is read for writing or written:
 * Home's blocks and every sub-page stay exactly as they are, and each page is restored from its own
 * revisions (src/lib/site-pages/entry-revisions-core.ts). M12-04 restored the pages too; M15-10
 * replaced that, because pages now publish on their own and a site-wide restore would overwrite
 * drafts the owner never asked about.
 *
 * `pages.published`, every entry (draft and published copy), `published_at`, `page_versions`, the
 * themes and Storage are untouched and no cache tag is expired, so the live site does not change;
 * the owner reviews the design in the editor and publishes it when ready.
 *
 *   - the draft is the version's design with `rev` one past the stored one, so an editor tab open
 *     on the old draft meets the stale-tab guard on its next save instead of overwriting the restore;
 *   - the theme resolves to the version's frozen tokens exactly (see `restoredTheme`);
 *   - an image of the design that is gone becomes null and is counted (photo, logo, share image); a
 *     background image that is gone becomes `bgImage` null in the page-level overrides, so Publish
 *     does not stop on it. Images inside blocks are not looked at: blocks are not restored;
 *   - the design is parsed with `draftDocSchema` (with no blocks) and checked against the draft size
 *     cap, and the link blocklist is asked about it (`blocked_link` with the hosts) before the write;
 *   - the write is filtered on the page id, the owner id and the draft rev read at the start, and
 *     goes through the same `pages` triggers as any draft save: a draft that changed in between
 *     (another tab saved, or a second restore ran first) matches no row and is `conflict`. The
 *     frozen `blocks` of `pages.draft` are sent back as they were stored, never the version's.
 *
 * The answer keeps the fields its readers know: `entries` is always empty and `pagesRestored`,
 * `recreated` and `notRestored` are always 0, 0 and empty.
 */
export async function restorePageVersionCore(
  input: VersionInput,
  deps: VersionDeps = {},
): Promise<RestoreResult> {
  const opened = await openVersion("restore", input, deps, true);
  if (!opened.ok) return opened;
  const open = opened.value;
  const ids = { page: open.pageId, version: open.version.id };
  const failed = (reason: VersionFailureReason | "conflict"): RestoreResult => {
    logFailure("restore", reason, ids);
    return { ok: false, reason };
  };

  // The version's design: its document with no blocks. Only the design's own images are looked up.
  const stored = publishedDocSchema.safeParse(open.version.document);
  if (!stored.success) return failed("error");
  const parsed: PublishDoc = { ...stored.data, blocks: [] };
  let checked: CheckedImages;
  let themeTokens: Partial<TokenSet> | null;
  try {
    const origin = mediaOrigin();
    const present = await presentPaths(
      ownedImagePaths(parsed, open.ownerId, origin),
      deps.mediaExists ?? storageExists(open.admin),
    );
    checked = nullMissingImages(parsed, open.ownerId, origin, (path) => present.has(path));
    themeTokens = await loadThemeTokens(open.admin, parsed.theme.ref, open.ownerId);
  } catch {
    return failed("error");
  }

  const theme = restoredTheme(parsed, parsed.tokens, themeTokens, checked.backgroundMissing);
  const draft = draftDocSchema.safeParse(versionToDraft(checked.doc, theme, nextRev(open.draft)));
  if (!draft.success) return failed("error");

  // The write carries the design and no blocks. For a moved site (Home is a page entry) the frozen
  // copy in `pages.draft` is never read: the database keeps it for a draft that omits it
  // (guard_frozen_page_blocks). Only a site that has NOT been moved, whose blocks still live in
  // `pages.draft` with nothing guarding them, gets them sent back unchanged, or the restore would
  // drop them.
  const { blocks: _none, ...design } = draft.data;
  void _none;
  const moved = await open.admin.rpc("site_has_home_entry", { p_site: open.pageId });
  if (moved.error) {
    console.error("[versions] reading whether the site was moved failed", moved.error.code);
    return failed("error");
  }
  let designDraft: Record<string, unknown> = design;
  if (moved.data !== true) {
    const unmovedDraft = (open.draft ?? {}) as Record<string, unknown>;
    if ("blocks" in unmovedDraft) designDraft = { ...design, blocks: unmovedDraft.blocks };
  }
  // The line the database holds (`pages_draft_integrity`, 20261002000001) and the editor's autosave
  // keeps: refused here, before any write, instead of failing there with 23514.
  if (jsonbTextBytes(designDraft) > LIMITS.draftBytes) return failed("error");

  // The same function the `pages` trigger runs on every draft write: a site listed since this
  // version was published is caught here, with the hosts, before anything is written. Only the
  // design is asked about: a link inside a page's blocks is not restored, so it cannot refuse this.
  try {
    const blocked = await checkBlocklist(open.admin, draft.data);
    if (blocked.hosts.length > 0) {
      logFailure("restore", "blocked_link", ids);
      return { ok: false, reason: "blocked_link", hosts: blocked.hosts };
    }
  } catch {
    return failed("error");
  }

  if (!(await activityAllowed(open.access.actorId))) return { ok: false, reason: "rate_limited" };
  // The design to `pages.draft`, guarded by its rev (the stale-tab guard).
  const update = open.admin
    .from("pages")
    .update({ draft: designDraft as unknown as Json })
    .eq("id", open.pageId)
    .eq("owner_id", open.ownerId);
  const written = await (
    open.draftRev === null
      ? update.is("draft->>rev", null)
      : update.eq("draft->>rev", open.draftRev)
  ).select("id");
  if (written.error) {
    // A listing that landed between the check and the write: the trigger refuses the draft (HL005).
    const refusal = readBlockedLinkError(written.error);
    if (refusal) {
      logFailure("restore", "blocked_link", ids);
      return { ok: false, reason: "blocked_link", hosts: refusal.hosts };
    }
    // Only the SQLSTATE is logged: a constraint message can carry the row.
    console.error(
      `[versions] restore error write=${written.error.code ?? "unknown"} page=${open.pageId} version=${open.version.id}`,
    );
    return { ok: false, reason: "error" };
  }
  if (!written.data || written.data.length === 0) return failed("conflict");
  await recordSiteActivity(open.admin, open.access, "version_restored");

  return {
    ok: true,
    restored: open.version.versionNo,
    missingImages: checked.missingImages,
    pagesRestored: 0,
    recreated: 0,
    entries: [],
    notRestored: [],
  };
}
