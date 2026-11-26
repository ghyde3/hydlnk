import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_SUSPENDED_CODE } from "@/lib/admin/suspension";
import { updateEntryWithClient } from "@/lib/content";
import type { ContentFailure } from "@/lib/content";
import { MAX_DRAFT_BYTES } from "@/lib/content/schemas";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The server save of a page entry's draft (1b1-16): Home's blocks and every sub-page. It wraps the
 * content writer's update and speaks the editor's save vocabulary (`SaveFn` / `SubSaveFn` kinds), so
 * the client can map the answer without knowing about content errors. The owner is checked by the
 * writer (another user's entry answers like a missing one); this layer only adds that the entry must
 * belong to the site named in the URL.
 */

export type EntrySaveBody =
  | { kind: "ok"; rev: number; unchanged: boolean }
  | { kind: "conflict"; currentRev?: number }
  | { kind: "missing" }
  | { kind: "too-large" }
  | { kind: "storage-full" }
  | { kind: "blocked"; hosts: string[]; blockIds: string[] }
  | { kind: "path"; message: string }
  | { kind: "suspended"; code: string; message: string }
  | { kind: "invalid"; message: string; issues?: ContentFailure["issues"] }
  | { kind: "error" };

export interface EntrySaveResponse {
  status: number;
  body: EntrySaveBody;
}

/** A content writer refusal in the editor's save vocabulary (the save route and the revisions routes). */
export function fromFailure(f: ContentFailure): EntrySaveResponse {
  const status = f.status;
  switch (f.error) {
    case "conflict":
      return {
        status,
        body: {
          kind: "conflict",
          ...(f.currentRev === undefined ? {} : { currentRev: f.currentRev }),
        },
      };
    case "not_found":
      return { status, body: { kind: "missing" } };
    case "too_large":
      return { status, body: { kind: "too-large" } };
    case "storage_full":
      return { status, body: { kind: "storage-full" } };
    case "blocked_link":
      return {
        status,
        body: { kind: "blocked", hosts: f.hosts ?? [], blockIds: f.blockIds ?? [] },
      };
    case "path_taken":
      return { status, body: { kind: "path", message: f.message } };
    case "account_suspended":
      return {
        status,
        body: { kind: "suspended", code: ACCOUNT_SUSPENDED_CODE, message: f.message },
      };
    case "invalid":
    case "type_disabled":
      return {
        status,
        body: { kind: "invalid", message: f.message, ...(f.issues ? { issues: f.issues } : {}) },
      };
    default:
      return { status, body: { kind: "error" } };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The most bytes a save request may carry: twice the largest draft the writer accepts, so no draft
 * the writer would take is refused here (the JSON envelope, escapes), and nothing larger is read.
 */
export const MAX_ENTRY_SAVE_BODY_BYTES = MAX_DRAFT_BYTES * 2;

export type EntrySaveBodyRead =
  { ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid" };

/**
 * Reads and parses a save request's JSON body, at most `maxBytes`. A `Content-Length` over the cap
 * is refused before a byte is read; a body with no (or a wrong) declared length is counted as it
 * arrives and dropped the moment it passes the cap, never buffered whole.
 */
export async function readEntrySaveBody(
  request: Request,
  maxBytes: number = MAX_ENTRY_SAVE_BODY_BYTES,
): Promise<EntrySaveBodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return { ok: false, reason: "invalid" };
    if (length > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
  }
  if (!request.body) return { ok: false, reason: "invalid" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export async function saveEntryDraftWithClient(
  admin: SupabaseClient<Database>,
  input: { userId: string; siteId: string; entryId: string; expectedRev: unknown; draft: unknown },
): Promise<EntrySaveResponse> {
  const rev = input.expectedRev;
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 1) {
    return {
      status: 422,
      body: { kind: "invalid", message: "Send the revision you are editing." },
    };
  }
  // A malformed id is no entry: answered here, before it reaches a uuid column and fails the query.
  if (
    typeof input.siteId !== "string" ||
    typeof input.entryId !== "string" ||
    !UUID.test(input.siteId) ||
    !UUID.test(input.entryId)
  ) {
    return { status: 404, body: { kind: "missing" } };
  }
  // The entry must sit in the site of the URL. A mismatch, a missing entry and another user's entry
  // all answer the same; ownership itself is the writer's check.
  const found = await admin
    .from("content_entries")
    .select("id")
    .eq("id", input.entryId)
    .eq("site_id", input.siteId)
    .maybeSingle();
  if (found.error) {
    console.error("[entries] reading the entry failed", found.error.message);
    return { status: 500, body: { kind: "error" } };
  }
  if (!found.data) return { status: 404, body: { kind: "missing" } };

  const result = await updateEntryWithClient(admin, {
    actor: { userId: input.userId, source: "editor" },
    entryId: input.entryId,
    expectedRev: rev,
    draft: input.draft,
  });
  if (!result.ok) return fromFailure(result);
  return { status: 200, body: { kind: "ok", rev: result.rev, unchanged: result.unchanged } };
}
