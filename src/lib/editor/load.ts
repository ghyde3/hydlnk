import { z } from "zod";
import {
  LIMITS,
  blockSchema,
  draftDocSchema,
  emptyDraft,
  imageRefSchema,
  singleLine,
  truncateToCodePoints,
  type Block,
  type DraftDoc,
  type ImageRef,
} from "@/lib/document";
import { resolveProfileOptions } from "@/lib/document/profile-options";
import { tokenOverridesSchema } from "@/lib/theme";

/**
 * Turns whatever `pages.draft` holds into a draft the editor can work on (M2-03).
 *
 * A valid stored draft is used as it is, raw strings and all: the schemas trim on parse, and the
 * editor state must keep what the user typed. A draft that does not validate (a client or a direct
 * API call wrote something else: `{}`, `{"blocks": 5}`, a block of an unknown type) is repaired to
 * the nearest valid document: unreadable parts fall back to defaults (display name = handle, empty
 * bio, no photo, no theme, no blocks) and every block that still validates is kept. `repaired`
 * tells the screen to show its notice. Repair is read-only: nothing is written until the user edits.
 */
export interface LoadedDraft {
  draft: DraftDoc;
  /**
   * The stored `draft->>rev` as text, or null when the stored draft has none. The stale-tab guard
   * filters its update on exactly this value, so a draft with no rev (a corrupted one) still saves.
   */
  revKey: string | null;
  /** True when something had to be reset: show "Some content couldn't be read...". */
  repaired: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What Postgres' `draft->>'rev'` returns for the stored document (null for none). */
export function revKeyOf(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const rev = raw.rev;
  if (typeof rev === "number" && Number.isFinite(rev)) return String(rev);
  if (typeof rev === "string") return rev;
  if (typeof rev === "boolean") return String(rev);
  return null;
}

function revNumber(raw: unknown): number {
  const rev = isRecord(raw) ? raw.rev : undefined;
  return typeof rev === "number" && Number.isSafeInteger(rev) && rev >= 0 ? rev : 0;
}

/** `visible` defaults to true in the schema; the editor state always carries it explicitly. */
function withVisible(block: Block): Block {
  return typeof block.visible === "boolean" ? block : ({ ...block, visible: true } as Block);
}

/** Every id a block holds (its own, its icons', its cells'): ids are unique across the page. */
function idsOf(block: Block): string[] {
  if (block.type === "social") return [block.id, ...block.icons.map((icon) => icon.id)];
  if (block.type === "grid") return [block.id, ...block.cells.map((cell) => cell.id)];
  return [block.id];
}

/** A social block's icons and a grid block's cells that repeat an id: the first of each stays. */
function withoutRepeatedItemIds(item: unknown): unknown {
  if (!isRecord(item)) return item;
  const key = item.type === "social" ? "icons" : item.type === "grid" ? "cells" : null;
  const list = key === null ? undefined : item[key];
  if (key === null || !Array.isArray(list)) return item;
  const seenIds = new Set<string>();
  const kept = list.filter((entry) => {
    const id = isRecord(entry) ? entry.id : undefined;
    if (typeof id !== "string") return true;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  return kept.length === list.length ? item : { ...item, [key]: kept };
}

export function loadDraft(raw: unknown, handle: string): LoadedDraft {
  const revKey = revKeyOf(raw);

  if (isRecord(raw) && draftDocSchema.safeParse(raw).success) {
    const stored = raw as unknown as DraftDoc;
    return {
      draft: {
        version: 1,
        rev: stored.rev,
        profile: {
          name: stored.profile.name,
          bio: stored.profile.bio,
          photo: stored.profile.photo,
          // Stored objects are returned as they are, so the options are filled here (M6-15, M6-17).
          ...resolveProfileOptions(stored.profile),
        },
        theme: { ref: stored.theme.ref, overrides: stored.theme.overrides },
        blocks: stored.blocks.map(withVisible),
      },
      revKey,
      repaired: false,
    };
  }

  // The stored draft did not validate, so the result is always a repair: keep what reads, default
  // the rest.
  const source = isRecord(raw) ? raw : {};
  const rawProfile = isRecord(source.profile) ? source.profile : undefined;
  const text = (value: unknown, fallback: string, max: number): string =>
    typeof value === "string" ? truncateToCodePoints(singleLine(value), max) : fallback;
  const name = text(rawProfile?.name, handle, LIMITS.displayName);
  const bio = text(rawProfile?.bio, "", LIMITS.bio);
  let photo: ImageRef | null = null;
  const parsedPhoto = imageRefSchema.safeParse(rawProfile?.photo);
  if (parsedPhoto.success) photo = parsedPhoto.data;

  const rawTheme = isRecord(source.theme) ? source.theme : undefined;
  let ref: string | null = null;
  if (typeof rawTheme?.ref === "string" && z.guid().safeParse(rawTheme.ref).success) {
    ref = rawTheme.ref;
  }
  let overrides = {};
  const parsedOverrides = tokenOverridesSchema.safeParse(rawTheme?.overrides);
  if (parsedOverrides.success) overrides = parsedOverrides.data;

  const blocks: Block[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.blocks)) {
    for (const item of source.blocks) {
      if (blocks.length >= LIMITS.blocks) break;
      // Icons or cells that repeat an id inside one block: the first of each stays (M6-05).
      const candidateItem = withoutRepeatedItemIds(item);
      const parsed = blockSchema.safeParse(candidateItem);
      if (!parsed.success) continue;
      const ids = idsOf(parsed.data);
      if (ids.some((id) => seen.has(id)) || new Set(ids).size !== ids.length) continue;
      ids.forEach((id) => seen.add(id));
      // The raw object, not the parsed one: the editor keeps what was typed, whitespace included.
      blocks.push(withVisible(candidateItem as Block));
    }
  }

  const candidate: DraftDoc = {
    version: 1,
    rev: revNumber(raw),
    // Each option keeps its stored value when that is valid and takes its default when it is not.
    profile: { name, bio, photo, ...resolveProfileOptions(rawProfile) },
    theme: { ref, overrides },
    blocks,
  };
  if (!draftDocSchema.safeParse(candidate).success) {
    return { draft: { ...emptyDraft(handle), rev: revNumber(raw) }, revKey, repaired: true };
  }
  return { draft: candidate, revKey, repaired: true };
}
