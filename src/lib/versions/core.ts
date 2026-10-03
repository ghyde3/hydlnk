import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checkBlocklist, readBlockedLinkError } from "@/lib/blocklist";
import { draftDocSchema, publishedDocSchema, type PublishDoc } from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";
import { PLAN_LIMITS, toPlanId } from "@/lib/limits";
import { MEDIA_BUCKET } from "@/lib/media/limits";
import { mediaOrigin } from "@/lib/media/url";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";
import {
  nextRev,
  nullMissingImages,
  ownedImagePaths,
  restoredTheme,
  versionToDraft,
  type CheckedImages,
} from "./restore";
import type { PreviewResult, RestoreResult, VersionFailureReason } from "./types";

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
/** The `pages.draft` size cap (`pages_draft_size`), the same line the database holds. */
const DRAFT_BYTE_CAP = 524_288;

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
  ownerId: string;
  pageId: string;
  /** `pages.draft` as stored, and its rev as Postgres reads it (`draft->>rev`); restore only. */
  draft: unknown;
  draftRev: string | null;
  version: { id: string; versionNo: number; document: unknown };
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

  // Ownership first: the secret key bypasses RLS, so this filter is the access rule.
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
  if (!row || row.owner_id !== userId) return fail("forbidden");

  const account = await admin
    .from("accounts")
    .select("plan, suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) {
    logFailure(op, "error", { page: pageId.data });
    return { ok: false, reason: "error" };
  }
  if (!account.data) return fail("forbidden");
  if (account.data.suspended_at !== null) return fail("account_suspended");
  if (PLAN_LIMITS[toPlanId(account.data.plan)].versionsKept <= 0) return fail("plan_required");

  // Only now is a version id looked at. Malformed, unknown and another page's all read the same.
  const versionId = guid.safeParse(input.versionId);
  if (!versionId.success) return fail("not_found");
  const found = await admin
    .from("page_versions")
    .select("id, version_no, document")
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
      ownerId: userId,
      pageId: pageId.data,
      draft: row.draft ?? null,
      draftRev: row.draft_rev ?? null,
      version: {
        id: found.data.id,
        versionNo: found.data.version_no,
        document: found.data.document,
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

/**
 * The stored document, parsed with the strict published schema, with every image that cannot be
 * shown replaced by null. A document that does not parse is `null` (the raw JSON is never returned).
 * Throws when Storage cannot be asked.
 */
async function checkedVersion(
  open: OpenVersion,
  deps: VersionDeps,
): Promise<{ parsed: PublishDoc; checked: CheckedImages } | null> {
  const parsed = publishedDocSchema.safeParse(open.version.document);
  if (!parsed.success) return null;
  const origin = mediaOrigin();
  const exists = deps.mediaExists ?? storageExists(open.admin);
  const present = await presentPaths(ownedImagePaths(parsed.data, open.ownerId, origin), exists);
  return {
    parsed: parsed.data,
    checked: nullMissingImages(parsed.data, open.ownerId, origin, (path) => present.has(path)),
  };
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
  return { ok: true, doc: result.checked.doc, missingImages: result.checked.missingImages };
}

/**
 * Restore (M6-49): writes the version into the DRAFT and nothing else. `pages.published`,
 * `published_at`, `page_versions`, the themes and Storage are untouched and no cache tag is
 * expired, so the live page does not change; the owner reviews the draft in the editor and
 * publishes when ready.
 *
 *   - the draft is the version's profile, blocks (ids kept, all visible, in order) and theme, with
 *     `rev` one past the stored one, so an editor tab open on the old draft meets the stale-tab
 *     guard on its next save instead of overwriting the restore;
 *   - the theme resolves to the version's frozen tokens exactly (see `restoredTheme`);
 *   - an image that is gone becomes null and is counted; a background image that is gone becomes
 *     `bgImage` null in the page-level overrides, so Publish does not stop on it;
 *   - the draft is parsed with `draftDocSchema` and checked against the draft size cap, and the
 *     link blocklist is asked about it (`blocked_link` with the hosts) before anything is written;
 *   - the write is filtered on the page id, the owner id and the draft rev read at the start, and
 *     goes through the same `pages` triggers as any draft save: a draft that changed in between
 *     (another tab saved, or a second restore ran first) matches no row and is `conflict`.
 */
export async function restorePageVersionCore(
  input: VersionInput,
  deps: VersionDeps = {},
): Promise<RestoreResult> {
  const opened = await openVersion("restore", input, deps, true);
  if (!opened.ok) return opened;
  const open = opened.value;
  const ids = { page: open.pageId, version: open.version.id };
  const failed = (reason: VersionFailureReason): RestoreResult => {
    logFailure("restore", reason, ids);
    return { ok: false, reason };
  };

  let result: Awaited<ReturnType<typeof checkedVersion>>;
  let themeTokens: Partial<TokenSet> | null;
  try {
    result = await checkedVersion(open, deps);
    themeTokens = result
      ? await loadThemeTokens(open.admin, result.parsed.theme.ref, open.ownerId)
      : null;
  } catch {
    return failed("error");
  }
  if (result === null) return failed("error");
  const { parsed, checked } = result;

  const theme = restoredTheme(parsed, parsed.tokens, themeTokens, checked.backgroundMissing);
  const draft = draftDocSchema.safeParse(versionToDraft(checked.doc, theme, nextRev(open.draft)));
  if (!draft.success) return failed("error");
  if (jsonbTextBytes(draft.data) > DRAFT_BYTE_CAP) return failed("error");

  // The same function the `pages` trigger runs on every draft write: a site listed since this
  // version was published is caught here, with the hosts, before anything is written.
  try {
    const blocked = await checkBlocklist(open.admin, draft.data);
    if (blocked.hosts.length > 0) {
      logFailure("restore", "blocked_link", ids);
      return { ok: false, reason: "blocked_link", hosts: blocked.hosts };
    }
  } catch {
    return failed("error");
  }

  const update = open.admin
    .from("pages")
    .update({ draft: draft.data as unknown as Json })
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
  if (!written.data || written.data.length === 0) {
    logFailure("restore", "conflict", ids);
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, restored: open.version.versionNo, missingImages: checked.missingImages };
}
