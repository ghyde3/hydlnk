import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { publishedSubPageSchema, toSubPagePublishForm } from "@/lib/document/sub-page";
import { placedBlockImages } from "@/lib/publish/placed-images";
import { blockedBodyLinks, blockedPageLinks, unsafeBodySchemes } from "./blocklist";
import { failure, mapDbError } from "./errors";
import { recordSiteActivity } from "@/lib/access";
import { activityLimited } from "./activity";
import { entryFor, siteType } from "./guards";
import { bodyShapeIssue } from "./body-shape";
import { bodyImageIssue, checkOwnImages, postImages, type ImageUse } from "./images";
import { pruneTerms } from "./prune-terms";
import { issuesOf, schemaForType, untrimmedPathIssue } from "./schemas";
import type { ContentActor, ContentFailure, ContentResult, PublishRun } from "./types";

type Admin = SupabaseClient<Database>;
type Deps = { now?: () => Date; run?: PublishRun };
type Input = { actor: ContentActor; entryId: string; expectedRev: number };
/** Where a written entry sits: what the cache expiry needs (`entry:<id>`, `type:<typeId>`, or the site for a page). */
export type EntryPlace = { siteId: string; typeId: string; typeKey: string };

/** A refused rpc: a stale rev (22023) re-reads the rev and answers conflict with it. */
async function refused(
  admin: Admin,
  entryId: string,
  err: { code?: string | null; message?: string | null },
): Promise<ContentFailure> {
  const mapped = mapDbError(err);
  if (mapped.error !== "conflict") return mapped;
  const reread = await admin.from("content_entries").select("rev").eq("id", entryId).maybeSingle();
  if (reread.error) return failure("error");
  if (!reread.data) return failure("not_found");
  return failure("conflict", undefined, Number(reread.data.rev));
}

/**
 * The checks both operations share, before anything is written. A scheduled fire skips the rev
 * comparison only: its SQL function locks the entry and uses the current rev.
 */
async function prepare(
  admin: Admin,
  input: Input,
  opts: { allowDisabledType?: boolean; fire?: boolean } = {},
) {
  // Publish and unpublish are publish-class: an editor is refused (forbidden).
  const owned = await entryFor(admin, input.actor, input.entryId, "publish");
  if (!owned.ok) return owned;
  const { entry, access } = owned;
  if (entry.deleted_at !== null) return failure("not_found");
  if (!opts.fire && (!Number.isSafeInteger(input.expectedRev) || input.expectedRev < 1)) {
    return failure("invalid", "Send the revision you are editing.");
  }
  // Taking content down always works, even for a type switched off since.
  const type = await siteType(admin, entry.site_id, entry.type_id);
  if (!type.ok) return type;
  if (!type.type.enabled && !opts.allowDisabledType) return failure("type_disabled");
  if (!opts.fire && Number(entry.rev) !== input.expectedRev) {
    return failure("conflict", undefined, Number(entry.rev));
  }
  const place: EntryPlace = { siteId: entry.site_id, typeId: type.type.id, typeKey: type.type.key };
  return { ok: true as const, entry, access, type: type.type, place };
}

/**
 * Publish the entry's draft, strictly validated, stored exactly as it is. `deps.run` (Wave E): `check`
 * runs every rule, the database's too (`publish_dry_run`, rolled back), and writes nothing; `fire` validates a schedule's snapshot instead of the draft and
 * writes through `fire_scheduled_publish` (published_at is the scheduled time).
 */
export async function publishEntryWithClient(
  admin: Admin,
  input: Input,
  deps: Deps = {},
): Promise<ContentResult<{ rev: number; publishedAt: string } & EntryPlace>> {
  const run = deps.run;
  const ready = await prepare(admin, input, { fire: run?.kind === "fire" });
  if (!ready.ok) return ready;
  const { type } = ready;
  // What is validated and published: the stored draft, or the snapshot a schedule took.
  const entry =
    run?.kind === "fire" ? { ...ready.entry, draft: run.snapshot as Json } : ready.entry;

  const schema = schemaForType(type.key, "publish");
  if (!schema) return failure("invalid", "That content type can’t be published yet.");
  const parsed = schema.safeParse(entry.draft);
  if (!parsed.success) return { ...failure("invalid"), issues: issuesOf(parsed.error) };
  const spaced = untrimmedPathIssue(type.key, entry.draft);
  if (spaced) return { ...failure("invalid"), issues: [spaced] };

  // What is stored: a post as it is; a page as its publish form (hidden blocks dropped, text trimmed).
  let published: unknown = entry.draft;
  let images: ImageUse[] = [];
  if (type.key === "post") {
    // A body the bounded lexer refuses is refused before anything else reads it.
    const shape = bodyShapeIssue(entry.draft);
    if (shape) return shape;
    const unsafe = unsafeBodySchemes(entry.draft);
    if (unsafe) return unsafe;
    // Images in the body are uploads only; whose, and whether they exist, is checked below.
    const foreign = bodyImageIssue(entry.draft);
    if (foreign) return foreign;
    const blocked = await blockedBodyLinks(admin, entry.draft);
    if (blocked) return blocked;
    // A term deleted since the last save does not go into the published copy.
    const pruned = await pruneTerms(
      admin,
      { siteId: entry.site_id, typeId: entry.type_id },
      entry.draft,
    );
    if (!pruned.ok) return pruned;
    published = pruned.draft;
    images = postImages(entry.draft);
  } else if (type.key === "page") {
    const form = toSubPagePublishForm(parsed.data as Parameters<typeof toSubPagePublishForm>[0]);
    const checked = publishedSubPageSchema.safeParse(form);
    if (!checked.success) return { ...failure("invalid"), issues: issuesOf(checked.error) };
    const blocked = await blockedPageLinks(admin, form);
    if (blocked) return blocked;
    published = form;
    images = placedBlockImages(form.blocks).map((p) => ({
      path: p.ref.path,
      field: `${p.blockId ?? "page"}.${p.field}`,
    }));
  }
  // Uploads live in the site OWNER's folder, whoever publishes (a member's own folder is refused).
  const unplaced = await checkOwnImages(admin, ready.access.ownerId, images);
  if (unplaced) return unplaced;

  if (run?.kind === "check") {
    // The database's own publish rules (a slug another live post holds, the size checks, the byte
    // cap) on this copy, rolled back: refused with Publish's own words, nothing written.
    const dry = await admin.rpc("publish_dry_run", {
      p_entry_id: entry.id,
      p_owner_id: ready.access.ownerId,
      p_expected_rev: input.expectedRev,
      p_published: published as Json,
    });
    if (dry.error) return refused(admin, entry.id, dry.error);
    return { ok: true, rev: Number(entry.rev), publishedAt: "", ...ready.place };
  }
  if (run?.kind === "fire") {
    const fired = await admin.rpc("fire_scheduled_publish", {
      p_id: run.scheduleId,
      p_claim: run.claim,
      p_published: published as Json,
    });
    if (fired.error) return refused(admin, entry.id, fired.error);
    const out = (fired.data ?? {}) as { rev?: unknown; published_at?: unknown };
    return {
      ok: true,
      rev: Number(out.rev),
      publishedAt: typeof out.published_at === "string" ? out.published_at : "",
      ...ready.place,
    };
  }

  const limited = await activityLimited(ready.access);
  if (limited) return limited;
  const publishedAt = (deps.now?.() ?? new Date()).toISOString();
  const { data, error } = await admin.rpc("publish_entry", {
    p_entry_id: entry.id,
    p_owner_id: ready.access.ownerId,
    p_expected_rev: input.expectedRev,
    p_published: published as Json,
    p_published_at: publishedAt,
    p_source: input.actor.source,
  });
  if (error) return refused(admin, entry.id, error);
  await recordSiteActivity(admin, ready.access, type.key === "page" ? "page_published" : "post_published", entry.id);
  return { ok: true, rev: Number(data), publishedAt, ...ready.place };
}

/**
 * Take the entry off the site. The draft stays. `fire` (Wave E): a claimed scheduled unpublish, at the
 * entry's current rev, through `fire_scheduled_unpublish` (an entry that is not live just finishes).
 */
export async function unpublishEntryWithClient(
  admin: Admin,
  input: Input,
  deps: { run?: Extract<PublishRun, { kind: "fire" }> } = {},
): Promise<ContentResult<{ rev: number; changed?: boolean } & EntryPlace>> {
  const ready = await prepare(admin, input, { allowDisabledType: true, fire: Boolean(deps.run) });
  if (!ready.ok) return ready;
  const { entry } = ready;
  if (deps.run) {
    const fired = await admin.rpc("fire_scheduled_unpublish", {
      p_id: deps.run.scheduleId,
      p_claim: deps.run.claim,
    });
    if (fired.error) return refused(admin, entry.id, fired.error);
    const out = (fired.data ?? {}) as { rev?: unknown; changed?: unknown };
    return { ok: true, rev: Number(out.rev), changed: out.changed === true, ...ready.place };
  }
  const limited = await activityLimited(ready.access);
  if (limited) return limited;
  const { data, error } = await admin.rpc("unpublish_entry", {
    p_entry_id: entry.id,
    p_owner_id: ready.access.ownerId,
    p_expected_rev: input.expectedRev,
  });
  if (error) return refused(admin, entry.id, error);
  await recordSiteActivity(admin, ready.access, "post_unpublished", entry.id);
  return { ok: true, rev: Number(data), ...ready.place };
}
