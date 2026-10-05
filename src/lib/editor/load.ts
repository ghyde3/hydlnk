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
  type Share,
  isShareEmpty,
  salvageMarks,
} from "@/lib/document";
import {
  LOGO_PLACEMENTS,
  NAME_SIZES,
  pickNameFont,
  pickProfileStyle,
} from "@/lib/document/page-extras";
import {
  linkUtmSchema,
  lockSchema,
  pageUtmSchema,
  redirectSchema,
} from "@/lib/document/link-fields";
import { repairNav } from "@/lib/document/nav";
import { resolveProfileOptions } from "@/lib/document/profile-options";
import { tokenOverridesSchema, validBlockOverrides } from "@/lib/theme";

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

/** Every id a block holds (its own, its icons', its cells', its text links'): ids are unique across the page. */
function idsOf(block: Block): string[] {
  if (block.type === "social") return [block.id, ...block.icons.map((icon) => icon.id)];
  if (block.type === "grid") return [block.id, ...block.cells.map((cell) => cell.id)];
  // Each store button and each map button is clicked and counted by its own id (M9-20, M9-21, M9-22).
  if (block.type === "book" || block.type === "apps") {
    return [block.id, ...block.links.map((link) => link.id)];
  }
  if (block.type === "map") return [block.id, block.googleId, block.appleId];
  // A link inside text is clicked and counted by its own id (M6-28).
  if (block.type === "text") {
    return [
      block.id,
      ...(block.marks ?? []).flatMap((mark) => (mark.type === "link" ? [mark.id] : [])),
    ];
  }
  return [block.id];
}

/** A social block's icons, a grid block's cells and a book's or app block's store links that repeat an id: the first of each stays. */
function withoutRepeatedItemIds(item: unknown): unknown {
  if (!isRecord(item)) return item;
  const key =
    item.type === "social"
      ? "icons"
      : item.type === "grid"
        ? "cells"
        : item.type === "book" || item.type === "apps"
          ? "links"
          : null;
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

/**
 * A block with a style that does not validate (M6-45: a radius of -5, a color that is not a hex
 * literal, written straight to the draft) keeps its content and loses only the bad style, so the
 * editor and its preview show the block with the theme default for that setting. Without this the
 * whole block would be dropped by the repair below for the sake of one optional setting. Only the
 * ten allowed override keys with valid values survive; nothing is written until the user edits.
 */
function withoutBadOverrides(item: unknown): unknown {
  if (!isRecord(item) || !("overrides" in item)) return item;
  const { overrides, ...rest } = item;
  const kept = validBlockOverrides(overrides);
  return kept ? { ...rest, overrides: kept } : rest;
}

/**
 * A text block whose marks the draft schema cannot read as they are (400 marks, a mark of another
 * type, an `align` that is not a string: something wrote them straight to the draft, M9-12) keeps its
 * text and the marks that read, the first 30 inline and the first 20 alignments, and loses the rest.
 * Nothing is written until the user edits.
 */
function withSaneMarks(item: unknown): unknown {
  if (!isRecord(item) || item.type !== "text" || !("marks" in item)) return item;
  const { marks, ...rest } = item;
  const kept = salvageMarks(marks);
  return kept.length > 0 ? { ...rest, marks: kept } : rest;
}

/**
 * A link block whose own tags or lock the draft schema cannot read (M9-27, M9-29: something wrote
 * them straight to the draft) keeps its content and loses only that key. Nothing is written until
 * the user edits.
 */
function withSaneLinkFields(item: unknown): unknown {
  if (!isRecord(item) || item.type !== "link") return item;
  let out = item;
  if ("utm" in out && !linkUtmSchema("draft").safeParse(out.utm).success) {
    const { utm, ...rest } = out;
    void utm;
    out = rest;
  }
  if ("lock" in out && !lockSchema("draft").safeParse(out.lock).success) {
    const { lock, ...rest } = out;
    void lock;
    out = rest;
  }
  return out;
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
          // The logo, its placement and the name's font and size (M9-24): kept as stored, and only
          // when the document has them (no key is invented).
          ...pickProfileStyle(stored.profile),
        },
        // The share card (M6-32) is kept as stored, raw strings and all.
        ...(stored.share ? { share: stored.share } : {}),
        // The support banner (M9-23), raw strings and all.
        ...(stored.banner ? { banner: stored.banner } : {}),
        // The page's UTM defaults (M9-27) and redirect mode (M9-31), as stored.
        ...(stored.utm ? { utm: stored.utm } : {}),
        ...(stored.redirect ? { redirect: stored.redirect } : {}),
        // The site's menu (M11-07), as stored: dropping it here would erase it on the next autosave.
        ...(stored.nav ? { nav: stored.nav } : {}),
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

  // The share card (M6-32): each field keeps what reads (text cut to its limit, on one line, an
  // image reference that validates) and the card is dropped when nothing is left.
  const rawShare = isRecord(source.share) ? source.share : undefined;
  let share: Share | undefined;
  if (rawShare) {
    const parsedImage = imageRefSchema.safeParse(rawShare.image);
    const repaired: Share = {
      title: text(rawShare.title, "", LIMITS.shareTitle),
      description: text(rawShare.description, "", LIMITS.shareDescription),
      image: parsedImage.success ? parsedImage.data : null,
    };
    if (!isShareEmpty(repaired)) share = repaired;
  }

  // The logo and the name's own style (M9-24): each keeps its value when it reads, else it is left out.
  const style: Record<string, unknown> = {};
  const parsedLogo = imageRefSchema.safeParse(rawProfile?.logo);
  if (parsedLogo.success) style.logo = parsedLogo.data;
  if ((LOGO_PLACEMENTS as readonly unknown[]).includes(rawProfile?.logoPlacement)) {
    style.logoPlacement = rawProfile?.logoPlacement;
  }
  if ((NAME_SIZES as readonly unknown[]).includes(rawProfile?.nameSize)) {
    style.nameSize = rawProfile?.nameSize;
  }
  const nameFont = pickNameFont(rawProfile?.nameFont);
  if (nameFont !== null) style.nameFont = nameFont;

  // The support banner (M9-23): kept when its parts read (text cut to its limit, on one line), else dropped.
  const rawBanner = isRecord(source.banner) ? source.banner : undefined;
  let banner: DraftDoc["banner"];
  if (rawBanner && typeof rawBanner.id === "string") {
    const candidate = {
      id: rawBanner.id,
      visible: rawBanner.visible !== false,
      text: text(rawBanner.text, "", LIMITS.bannerText),
      label: text(rawBanner.label, "", LIMITS.bannerLabel),
      url: typeof rawBanner.url === "string" ? rawBanner.url.slice(0, LIMITS.draftUrl) : "",
    };
    if (draftDocSchema.shape.banner.safeParse(candidate).success) banner = candidate;
  }

  // The page's UTM defaults and redirect mode (M9-27, M9-31): each is kept when it reads, else dropped.
  const parsedUtm = pageUtmSchema("draft").safeParse(source.utm);
  const utm = source.utm !== undefined && parsedUtm.success ? parsedUtm.data : undefined;
  const parsedRedirect = redirectSchema("draft").safeParse(source.redirect);
  const redirect =
    source.redirect !== undefined && parsedRedirect.success ? parsedRedirect.data : undefined;

  // The site's menu (M11-07): pruned to the ids that read, at most the cap, never dropped whole.
  const nav = repairNav(source.nav);

  const rawTheme = isRecord(source.theme) ? source.theme : undefined;
  let ref: string | null = null;
  if (typeof rawTheme?.ref === "string" && z.guid().safeParse(rawTheme.ref).success) {
    ref = rawTheme.ref;
  }
  let overrides = {};
  const parsedOverrides = tokenOverridesSchema.safeParse(rawTheme?.overrides);
  if (parsedOverrides.success) overrides = parsedOverrides.data;

  const blocks: Block[] = [];
  // The banner's id is part of the page's id space (M9-23): a block that repeats it is dropped.
  const seen = new Set<string>(banner ? [banner.id] : []);
  if (Array.isArray(source.blocks)) {
    for (const item of source.blocks) {
      if (blocks.length >= LIMITS.blocks) break;
      // Icons or cells that repeat an id inside one block: the first of each stays (M6-05).
      const candidateItem = withSaneLinkFields(
        withSaneMarks(withoutBadOverrides(withoutRepeatedItemIds(item))),
      );
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
    profile: { name, bio, photo, ...resolveProfileOptions(rawProfile), ...style },
    ...(share ? { share } : {}),
    ...(banner ? { banner } : {}),
    ...(utm ? { utm } : {}),
    ...(redirect ? { redirect } : {}),
    ...(nav ? { nav } : {}),
    theme: { ref, overrides },
    blocks,
  };
  if (!draftDocSchema.safeParse(candidate).success) {
    return { draft: { ...emptyDraft(handle), rev: revNumber(raw) }, revKey, repaired: true };
  }
  return { draft: candidate, revKey, repaired: true };
}
