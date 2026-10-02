import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  collectPublishErrors,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type ImageRef,
  type PublishDoc,
  type PublishError,
} from "@/lib/document";
import { MEDIA_BUCKET } from "@/lib/media/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { tokenSetSchema, type TokenSet } from "@/lib/theme";

/** Why a publish did not happen, besides `invalid` (the draft has problems the editor can show). */
export type PublishFailureReason = "unauthorized" | "forbidden" | "invalid" | "error";

export type PublishResult =
  | { ok: true; publishedAt: string }
  | { ok: false; errors: PublishError[]; reason?: PublishFailureReason };

export interface PublishDeps {
  /** Secret-key client (RLS does not apply: every check below is ours). */
  admin?: SupabaseClient<Database>;
  /** Does `page-media` hold this object? Defaults to a Storage HEAD with the secret key. */
  mediaExists?: (path: string) => Promise<boolean>;
  now?: () => Date;
}

const pageIdSchema = z.guid();
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const refuse = (
  reason: PublishFailureReason,
  errors: PublishError[] = [],
): { ok: false; errors: PublishError[]; reason: PublishFailureReason } => ({
  ok: false,
  errors,
  reason,
});

/**
 * The publish gate (M2-23, M2-25), everything except the cache call, which only a Server Action
 * may make (see actions.ts). Takes a page id and the verified session user and nothing else: the
 * document is read from Postgres here, never taken from the caller.
 *
 *   1. no session user: `unauthorized`; a page the user does not own (or that does not exist):
 *      `forbidden`. Nothing is read or written first;
 *   2. `publishDocSchema` on the stored draft (required fields, http(s) URLs, embed allowlist,
 *      no control or bidi characters, block limit): any issue returns `{ok:false, errors}` naming
 *      the block, and writes nothing;
 *   3. every image path of a visible block starts with the owner's uid and exists in `page-media`;
 *   4. `toPublishForm` with the tokens of the draft's theme row (a system theme or one the owner
 *      owns; a missing or foreign one resolves like no theme, as the editor does), then
 *      `publishedDocSchema` on the result: the frozen, fully resolved document;
 *   5. `pages.published` and `published_at` are written with the secret key, filtered on the owner.
 *
 * A failed gate writes nothing, so a failed Publish leaves the live page and its cache as they were.
 */
export async function publishPageCore(
  input: { pageId: unknown; userId: string | null },
  deps: PublishDeps = {},
): Promise<PublishResult> {
  if (!input.userId || !UID.test(input.userId)) return refuse("unauthorized");
  const userId = input.userId;
  const pageId = pageIdSchema.safeParse(input.pageId);
  if (!pageId.success) return refuse("forbidden");

  const admin = deps.admin ?? createAdminSupabase();

  // Ownership first: the secret key bypasses RLS, so the owner filter below is the access rule.
  const page = await admin
    .from("pages")
    .select("id, owner_id, draft")
    .eq("id", pageId.data)
    .maybeSingle();
  if (page.error) {
    console.error("[publish] reading the draft failed", page.error.message);
    return refuse("error");
  }
  if (!page.data || page.data.owner_id !== userId) return refuse("forbidden");

  const raw: unknown = page.data.draft;
  const parsed = publishDocSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = collectPublishErrors(raw);
    return refuse(
      "invalid",
      errors.length > 0
        ? errors
        : [{ blockId: null, field: "document", message: "Fix this page before publishing." }],
    );
  }
  const draft = parsed.data;

  let themeTokens: Partial<TokenSet> | null;
  try {
    themeTokens = await loadThemeTokens(admin, draft.theme.ref, userId);
  } catch (error) {
    console.error("[publish] reading the theme failed", error);
    return refuse("error");
  }

  const form = toPublishForm(draft, themeTokens);

  let mediaErrors: PublishError[];
  try {
    mediaErrors = await checkImages(form, userId, deps.mediaExists ?? storageExists(admin));
  } catch (error) {
    console.error("[publish] checking the images failed", error);
    return refuse("error");
  }
  if (mediaErrors.length > 0) return refuse("invalid", mediaErrors);

  const checked = publishedDocSchema.safeParse(form);
  if (!checked.success) {
    console.error("[publish] the publish form failed validation", checked.error.issues);
    return refuse("invalid", [
      { blockId: null, field: "document", message: "Fix this page before publishing." },
    ]);
  }

  const publishedAt = (deps.now?.() ?? new Date()).toISOString();
  const written = await admin
    .from("pages")
    .update({ published: checked.data as unknown as Json, published_at: publishedAt })
    .eq("id", pageId.data)
    .eq("owner_id", userId)
    .select("id");
  if (written.error) {
    console.error("[publish] writing the published page failed", written.error.message);
    return refuse("error");
  }
  if (!written.data || written.data.length === 0) return refuse("forbidden");
  return { ok: true, publishedAt };
}

/**
 * Tokens of the draft's theme row, or null: no theme, a deleted one, one the owner cannot use (the
 * system themes and the owner's own are the only ones readable here, the same rule RLS gives the
 * editor) or one whose tokens do not parse.
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
  if (error) throw new Error(error.message);
  if (!data) return null;
  const tokens = tokenSetSchema.partial().safeParse(data.tokens);
  return tokens.success ? tokens.data : null;
}

interface Placed {
  ref: ImageRef;
  blockId: string | null;
  field: string;
}

/** Every image of the publish form (visible blocks only) with where it sits, for the error. */
function placedImages(form: PublishDoc): Placed[] {
  const placed: Placed[] = [];
  if (form.profile.photo) {
    placed.push({ ref: form.profile.photo, blockId: null, field: "profile.photo" });
  }
  for (const block of form.blocks) {
    if ((block.type === "card" || block.type === "image") && block.image) {
      placed.push({ ref: block.image, blockId: block.id, field: "image" });
    }
  }
  return placed;
}

/**
 * A path must start with the owner's uid (so no one publishes another user's file) and exist in
 * the bucket (so a page never points at nothing). Hidden blocks are not part of the form.
 */
async function checkImages(
  form: PublishDoc,
  ownerId: string,
  exists: (path: string) => Promise<boolean>,
): Promise<PublishError[]> {
  const errors: PublishError[] = [];
  const own: Placed[] = [];
  for (const item of placedImages(form)) {
    if (item.ref.path.startsWith(`${ownerId}/`)) own.push(item);
    else {
      errors.push({
        blockId: item.blockId,
        field: item.field,
        message: "That image isn’t in your uploads. Upload it again.",
      });
    }
  }

  const paths = [...new Set(own.map((item) => item.ref.path))];
  const present = new Map<string, boolean>();
  for (let i = 0; i < paths.length; i += 8) {
    const batch = paths.slice(i, i + 8);
    const results = await Promise.all(batch.map((path) => exists(path)));
    batch.forEach((path, index) => present.set(path, results[index] === true));
  }
  for (const item of own) {
    if (!present.get(item.ref.path)) {
      errors.push({
        blockId: item.blockId,
        field: item.field,
        message: "That image is no longer available. Upload it again.",
      });
    }
  }
  return errors;
}

function storageExists(admin: SupabaseClient<Database>) {
  const bucket = admin.storage.from(MEDIA_BUCKET);
  return async (path: string): Promise<boolean> => {
    const { data } = await bucket.exists(path);
    return data;
  };
}
