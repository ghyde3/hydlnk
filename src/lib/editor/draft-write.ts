import "server-only";
import { readBlockedLinkError } from "@/lib/blocklist/error";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LIMITS,
  draftDocSchema,
  draftSubPageSchema,
  publishFormsEqual,
  type DraftDoc,
  type SubPageDraft,
} from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";
import type { Json } from "@/lib/supabase/database.types";
import { collectRefsByPath } from "@/lib/mcp/images";
import { MESSAGES, ToolFailure } from "@/lib/mcp/errors";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/admin/suspension";
import { updateEntryWithClient } from "@/lib/content/entries-core";
import type { ContentFailure } from "@/lib/content/types";
import { getHomeDraftWithClient } from "@/lib/site/page-entries-core";
import type { AdminClient } from "@/lib/mcp/types";

/**
 * The one server-side draft writer the tools share (M10-23). The editor writes its draft from the
 * browser under RLS; a tool has no browser, so this does the same write with the secret key, in the
 * same shape and with the same guard, and checks everything RLS would have checked itself.
 *
 *   1. read the page with the secret key, filtered on the owner (else `not_found`);
 *   2. read the owner's `suspended_at` (the secret key skips the owner policy that blocks a suspended
 *      owner in the browser): `account_suspended`, and `server_error` when it cannot be read;
 *   3. parse the stored draft with `draftDocSchema`: a draft that cannot be read is `server_error` and
 *      is never overwritten;
 *   4. `ifRev` given and different from the stored `rev`: `conflict`, nothing written;
 *   5. `change(doc)` returns the new draft (or throws a refusal); `rev` becomes the old one plus 1;
 *   6. the result must parse with `draftDocSchema` (`invalid_input`) and fit `LIMITS.draftBytes`
 *      (`too_large`);
 *   7. the same conditional update the browser makes: `update pages set draft = ... where id = ... and
 *      owner_id = ... and draft->>'rev' = {old rev}`. Zero rows means someone saved first (the
 *      editor's autosave, or another tool call): `conflict`, with no retry and no merge, so a save
 *      made in the editor is never written over silently.
 *
 * Since the content move (1b1-19) Home's blocks and every sub-page are page entries. A site that has a
 * Home entry is two stored documents, and `scope` says which one a call writes (its `ifRev` and the
 * returned `rev` are that document's):
 *
 *   - `blocks`: the change sees Home's design (`pages.draft`) with the blocks of the '/' entry; only the
 *     blocks may change, and they are written to the entry through the content writer (source `mcp`),
 *     guarded by the entry's rev;
 *   - `design`: the same view, but only the design may change; it is written to `pages.draft` (the
 *     frozen blocks stay as they are), guarded by `draft->>rev`.
 *
 * A sub-page (M12-05) goes through the same seven steps with `subPageId`: the site row is still read
 * and owner-filtered first, the sub-page entry is read under that site, the stored document is checked
 * with `draftSubPageSchema`, and the guard is the entry's rev, which the content writer checks. A site
 * with no Home entry (a test layout) keeps the whole document in `pages.draft`, as before.
 *
 * It sets the `draft` column and nothing else: `published`, `published_at`, `handle`, `name` and
 * `owner_id` are never in the statement. The database walls (the link blocklist trigger, the size
 * check) fire under the secret key too and become `blocked_link` and `too_large`.
 */

/** What a tool that edits blocks can do to either kind of draft: Home's or a sub-page's. */
export type BlocksDoc = DraftDoc | SubPageDraft;

export type ChangeOutcome<T, D extends BlocksDoc = DraftDoc> =
  { kind: "write"; doc: D; value: T } | { kind: "unchanged"; value: T };

/** Which stored document of Home a call writes (see above). A sub-page ignores it. */
export type DraftScope = "blocks" | "design";

export interface WriteDraftInput<T, D extends BlocksDoc = DraftDoc> {
  admin: AdminClient;
  /** Default `design`. */
  scope?: DraftScope | undefined;
  userId: string;
  /** The site (the `pages` row), also when the write is to one of its sub-pages. */
  pageId: string;
  /** Write this sub-page of the site instead of Home. */
  subPageId?: string | undefined;
  ifRev?: number | undefined;
  /** Gets a private copy of the stored draft. Returns the new draft, or says nothing changed, or throws a `ToolFailure`. */
  change: (doc: D) => ChangeOutcome<T, D> | Promise<ChangeOutcome<T, D>>;
}

export interface WriteDraftResult<T, D extends BlocksDoc = DraftDoc> {
  /** The rev now stored (the same as before when `unchanged`). */
  rev: number;
  unchanged: boolean;
  /** The draft now stored, with its rev. */
  doc: D;
  value: T;
  /** An image reference left the draft: the caller runs the media cleanup after the response. */
  droppedImages: boolean;
}

/** SQLSTATE of "the draft is too large": the size CHECK and the 200-block trigger. */
const TOO_LARGE_CODE = "23514";

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message.slice(0, 200),
  }));
}

/** An untyped handle, so one code path can read `content_entries` rows whatever the generated types say. */
type LooseAdmin = SupabaseClient;

/** A page entry as the writer reads it. */
interface EntryRow {
  id: string;
  rev: number;
  draft: unknown;
}

/** Key-order-insensitive JSON text, to compare two documents the database may have reordered. */
function canonicalText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalText(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Everything of a Home document except what the other stored document owns: `blocks` and `rev`. */
function designPart(doc: unknown): string {
  const { blocks: _blocks, rev: _rev, ...rest } = (doc ?? {}) as Record<string, unknown>;
  void _blocks;
  void _rev;
  return canonicalText(rest);
}

/** The live sub-page entry `entryId` of the site `siteId`, never Home, or null. */
async function readSubPageEntry(
  loose: LooseAdmin,
  siteId: string,
  entryId: string,
): Promise<EntryRow | null> {
  const type = await loose
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "page")
    .maybeSingle();
  if (type.error) throw new ToolFailure("server_error", MESSAGES.serverError);
  if (!type.data) return null;
  const found = await loose
    .from("content_entries")
    .select("id, site_id, rev, draft")
    .eq("id", entryId)
    .eq("site_id", siteId)
    .eq("type_id", (type.data as { id: string }).id)
    .is("deleted_at", null)
    .maybeSingle();
  if (found.error) throw new ToolFailure("server_error", MESSAGES.serverError);
  const row = found.data as (EntryRow & { site_id: string }) | null;
  if (!row || row.site_id !== siteId) return null;
  if ((row.draft as { path?: unknown } | null)?.path === "/") return null;
  return { id: row.id, rev: Number(row.rev), draft: row.draft };
}

/** A content writer refusal in a tool's words. */
function toToolFailure(failure: ContentFailure): ToolFailure {
  switch (failure.error) {
    case "conflict":
      return new ToolFailure("conflict", MESSAGES.conflict);
    case "not_found":
      return new ToolFailure("not_found", MESSAGES.not_found);
    case "too_large":
    case "storage_full":
      return new ToolFailure("too_large", MESSAGES.too_large);
    case "account_suspended":
      return new ToolFailure("account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
    case "blocked_link": {
      const blockIds = failure.blockIds ?? [];
      return new ToolFailure("blocked_link", MESSAGES.blocked_link, {
        details: { hosts: failure.hosts ?? [], blockIds },
        issues: blockIds.slice(0, 10).map((blockId) => ({
          path: `blocks.${blockId}`,
          message: "This block links to a blocked site. Use a different link.",
        })),
      });
    }
    case "invalid":
    case "path_taken":
    case "type_disabled": {
      const issues = failure.issues ?? [{ path: "path", message: failure.message }];
      return new ToolFailure("invalid_input", issues[0]?.message ?? failure.message, { issues });
    }
    default:
      return new ToolFailure("server_error", MESSAGES.serverError);
  }
}

export async function writeDraft<T, D extends BlocksDoc = DraftDoc>(
  input: WriteDraftInput<T, D>,
): Promise<WriteDraftResult<T, D>> {
  const { admin, userId, pageId, subPageId } = input;
  const isSub = subPageId !== undefined;
  const scope: DraftScope = input.scope ?? "design";
  const loose = admin as unknown as LooseAdmin;

  // 1. The page, filtered on its owner in the query and compared again.
  const read = await admin
    .from("pages")
    // `draft_rev` is Postgres' own `draft->>'rev'`: the guard filters on exactly that text.
    .select("id, owner_id, draft, draft_rev:draft->>rev")
    .eq("id", pageId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (read.error) throw new ToolFailure("server_error", MESSAGES.serverError);
  if (!read.data || read.data.owner_id !== userId) {
    throw new ToolFailure("not_found", MESSAGES.not_found);
  }
  // The page entry this call writes: a sub-page of that site (never of another one: the site id is
  // in the filter), or Home's '/' entry when the site has one.
  let entry: EntryRow | null = null;
  try {
    if (isSub) {
      entry = await readSubPageEntry(loose, pageId, subPageId);
      if (!entry) throw new ToolFailure("not_found", MESSAGES.not_found);
    } else {
      const home = await getHomeDraftWithClient(admin, pageId);
      entry = home ? { id: home.entryId, rev: home.rev, draft: home.draft } : null;
    }
  } catch (error) {
    if (error instanceof ToolFailure) throw error;
    throw new ToolFailure("server_error", MESSAGES.serverError);
  }

  // 2. Suspension.
  const account = await admin
    .from("accounts")
    .select("suspended_at")
    .eq("id", userId)
    .maybeSingle();
  if (account.error) throw new ToolFailure("server_error", MESSAGES.serverError);
  if (!account.data || account.data.suspended_at !== null) {
    throw new ToolFailure("account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
  }

  // 3. The stored draft must read. It is never repaired and never overwritten.
  const pagesDraft: unknown = read.data.draft;
  const homeEntry = !isSub && entry !== null;
  const blocksScope = isSub || (homeEntry && scope === "blocks");
  // What the change sees: a sub-page's document, Home's design with the entry's blocks, or the site
  // row's whole document.
  let storedRaw: unknown;
  if (isSub) storedRaw = entry!.draft;
  else if (homeEntry) {
    const blocks = (entry!.draft as { blocks?: unknown } | null)?.blocks;
    storedRaw = { ...(pagesDraft as Record<string, unknown>), blocks };
  } else storedRaw = pagesDraft;
  const stored = (isSub ? draftSubPageSchema : draftDocSchema).safeParse(storedRaw);
  if (!stored.success) throw new ToolFailure("server_error", MESSAGES.draftUnreadable);
  // The rev a call is checked against: the entry's for blocks and sub-pages, else the design's.
  const designRev = (stored.data as DraftDoc | undefined)?.rev;
  const oldRev: number = blocksScope ? entry!.rev : (designRev as number);
  const revKey: string | null = (read.data as { draft_rev?: string | null }).draft_rev ?? null;
  // The view of Home carries the rev of the document the call writes.
  const rawStored = (
    homeEntry && blocksScope ? { ...(storedRaw as object), rev: oldRev } : storedRaw
  ) as D;

  // 4. The extra, explicit check.
  if (input.ifRev !== undefined && input.ifRev !== oldRev) {
    throw new ToolFailure("conflict", MESSAGES.conflict);
  }

  // 5. The change, on a private copy of exactly what is stored (keys the schema does not know stay).
  const unchanged = (value: T): WriteDraftResult<T, D> => ({
    rev: oldRev,
    unchanged: true,
    doc: rawStored,
    value,
    droppedImages: false,
  });
  const outcome = await input.change(structuredClone(rawStored));
  if (outcome.kind === "unchanged") return unchanged(outcome.value);
  const after: D = isSub ? outcome.doc : ({ ...outcome.doc, rev: oldRev + 1 } as unknown as D);
  const sameAs = isSub ? after : { ...after, rev: oldRev };
  if (publishFormsEqual(sameAs, rawStored)) return unchanged(outcome.value);
  if (homeEntry) {
    // Each stored document takes only its own half of a change.
    const other = blocksScope
      ? designPart(after) !== designPart(rawStored)
      : canonicalText((after as DraftDoc).blocks) !== canonicalText((rawStored as DraftDoc).blocks);
    if (other) throw new ToolFailure("server_error", MESSAGES.serverError);
  }

  // 6. The whole draft must still be a draft, and fit.
  if (after.blocks.length > LIMITS.blocks) {
    throw new ToolFailure("block_limit", MESSAGES.block_limit);
  }
  const check = (isSub ? draftSubPageSchema : draftDocSchema).safeParse(after);
  if (!check.success) {
    const issues = issuesOf(check.error);
    throw new ToolFailure("invalid_input", issues[0]?.message ?? "That change isn’t valid.", {
      issues,
    });
  }
  if (jsonbTextBytes(after) > LIMITS.draftBytes) {
    throw new ToolFailure("too_large", MESSAGES.too_large);
  }

  let newRev: number;
  if (blocksScope) {
    // 7a. The page entry, through the content writer: the entry's rev is the guard, and a revision is
    // recorded as the writer does for any save. Home keeps its path, title and description.
    const entryDraft = isSub
      ? after
      : { ...(entry!.draft as Record<string, unknown>), blocks: (after as DraftDoc).blocks };
    const written = await updateEntryWithClient(admin, {
      actor: { userId, source: "mcp" },
      entryId: entry!.id,
      expectedRev: oldRev,
      draft: entryDraft,
    });
    if (!written.ok) throw toToolFailure(written);
    newRev = written.rev;
  } else {
    // 7b. The site row: the draft column only, guarded by the rev the change started from. With a
    // Home entry the blocks there are the frozen copy and stay as they are.
    const frozen = (pagesDraft as { blocks?: unknown } | null)?.blocks;
    const next: D = homeEntry ? ({ ...after, blocks: frozen } as unknown as D) : after;
    const base = loose.from("pages").update({ draft: next as unknown as Json });
    const scoped = base.eq("id", pageId).eq("owner_id", userId);
    const guarded =
      revKey === null ? scoped.is("draft->>rev", null) : scoped.eq("draft->>rev", revKey);
    const written = await guarded.select("id");
    if (written.error) {
      const blocked = readBlockedLinkError(written.error);
      if (blocked) {
        throw new ToolFailure("blocked_link", MESSAGES.blocked_link, {
          details: { hosts: blocked.hosts, blockIds: blocked.blockIds },
          issues: blocked.blockIds.slice(0, 10).map((blockId) => ({
            path: `blocks.${blockId}`,
            message: "This block links to a blocked site. Use a different link.",
          })),
        });
      }
      // The size CHECK.
      if (written.error.code === TOO_LARGE_CODE) {
        throw new ToolFailure("too_large", MESSAGES.too_large);
      }
      throw new ToolFailure("server_error", MESSAGES.serverError);
    }
    // Zero rows means someone saved first.
    if (!written.data || written.data.length === 0)
      throw new ToolFailure("conflict", MESSAGES.conflict);
    newRev = (after as unknown as DraftDoc).rev;
  }

  const before = new Set(collectRefsByPath(rawStored).keys());
  const afterRefs = new Set(collectRefsByPath(after).keys());
  const droppedImages = [...before].some((path) => !afterRefs.has(path));
  const doc = blocksScope && !isSub ? ({ ...after, rev: newRev } as unknown as D) : after;
  return { rev: newRev, unchanged: false, doc, value: outcome.value, droppedImages };
}
