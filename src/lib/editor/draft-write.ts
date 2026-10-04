import "server-only";
import { readBlockedLinkError } from "@/lib/blocklist/error";
import { LIMITS, draftDocSchema, publishFormsEqual, type DraftDoc } from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";
import type { Json } from "@/lib/supabase/database.types";
import { collectRefsByPath } from "@/lib/mcp/images";
import { MESSAGES, ToolFailure } from "@/lib/mcp/errors";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/admin/suspension";
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
 * It sets the `draft` column and nothing else: `published`, `published_at`, `handle`, `name` and
 * `owner_id` are never in the statement. The database walls (the link blocklist trigger, the size
 * check) fire under the secret key too and become `blocked_link` and `too_large`.
 */

export type ChangeOutcome<T> =
  { kind: "write"; doc: DraftDoc; value: T } | { kind: "unchanged"; value: T };

export interface WriteDraftInput<T> {
  admin: AdminClient;
  userId: string;
  pageId: string;
  ifRev?: number | undefined;
  /** Gets a private copy of the stored draft. Returns the new draft, or says nothing changed, or throws a `ToolFailure`. */
  change: (doc: DraftDoc) => ChangeOutcome<T> | Promise<ChangeOutcome<T>>;
}

export interface WriteDraftResult<T> {
  /** The rev now stored (the same as before when `unchanged`). */
  rev: number;
  unchanged: boolean;
  /** The draft now stored, with its rev. */
  doc: DraftDoc;
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

export async function writeDraft<T>(input: WriteDraftInput<T>): Promise<WriteDraftResult<T>> {
  const { admin, userId, pageId } = input;

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
  const stored = draftDocSchema.safeParse(read.data.draft);
  if (!stored.success) throw new ToolFailure("server_error", MESSAGES.draftUnreadable);
  const rawStored = read.data.draft as unknown as DraftDoc;
  const oldRev = stored.data.rev;
  const revKey: string | null = (read.data as { draft_rev?: string | null }).draft_rev ?? null;

  // 4. The extra, explicit check.
  if (input.ifRev !== undefined && input.ifRev !== oldRev) {
    throw new ToolFailure("conflict", MESSAGES.conflict);
  }

  // 5. The change, on a private copy of exactly what is stored (keys the schema does not know stay).
  const outcome = await input.change(structuredClone(rawStored));
  if (outcome.kind === "unchanged") {
    return {
      rev: oldRev,
      unchanged: true,
      doc: rawStored,
      value: outcome.value,
      droppedImages: false,
    };
  }
  const next: DraftDoc = { ...outcome.doc, rev: oldRev + 1 };
  if (publishFormsEqual({ ...next, rev: oldRev }, rawStored)) {
    return {
      rev: oldRev,
      unchanged: true,
      doc: rawStored,
      value: outcome.value,
      droppedImages: false,
    };
  }

  // 6. The whole draft must still be a draft, and fit.
  if (next.blocks.length > LIMITS.blocks) {
    throw new ToolFailure("block_limit", MESSAGES.block_limit);
  }
  const check = draftDocSchema.safeParse(next);
  if (!check.success) {
    const issues = issuesOf(check.error);
    throw new ToolFailure("invalid_input", issues[0]?.message ?? "That change isn’t valid.", {
      issues,
    });
  }
  if (jsonbTextBytes(next) > LIMITS.draftBytes) {
    throw new ToolFailure("too_large", MESSAGES.too_large);
  }

  // 7. The conditional update: the draft column only, guarded by the rev the change started from.
  const update = admin
    .from("pages")
    .update({ draft: next as unknown as Json })
    .eq("id", pageId)
    .eq("owner_id", userId);
  const guarded =
    revKey === null ? update.is("draft->>rev", null) : update.eq("draft->>rev", revKey);
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
    if (written.error.code === TOO_LARGE_CODE)
      throw new ToolFailure("too_large", MESSAGES.too_large);
    throw new ToolFailure("server_error", MESSAGES.serverError);
  }
  if (!written.data || written.data.length === 0)
    throw new ToolFailure("conflict", MESSAGES.conflict);

  const before = new Set(collectRefsByPath(rawStored).keys());
  const after = new Set(collectRefsByPath(next).keys());
  const droppedImages = [...before].some((path) => !after.has(path));
  return { rev: next.rev, unchanged: false, doc: next, value: outcome.value, droppedImages };
}
