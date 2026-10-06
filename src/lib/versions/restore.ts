import {
  type Block,
  type DocTheme,
  type DraftDoc,
  type ImageRef,
  type PublishDoc,
  type SubPageDraft,
  type SubPagePublish,
} from "@/lib/document";
import { TOKEN_KEYS, resolveTokens, type TokenOverrides, type TokenSet } from "@/lib/theme";
import { mediaPathOf } from "@/lib/themes/bg-image";

/**
 * The pure half of preview and restore (M6-49): turning a stored version into what the screen draws
 * and what the draft will hold. No I/O: the caller says which image paths are still stored
 * (`isPresent`), so every rule here is a plain function of its inputs and is tested without a
 * database.
 */

/** Where an image sits in the document: the profile photo, a card or image block, or the background. */
export type ImagePlace = "photo" | "block" | "background";

/**
 * The page-media paths a version names inside `ownerId`'s own folder, once each: the ones whose
 * object has to be looked up in Storage. A reference outside the folder is never looked up (it is
 * dropped without asking Storage), and neither is anything that is not an image path. The places are
 * the ones `collectImageRefs` and Publish's `placedImages` walk: the profile photo, card and image
 * blocks, a link's thumbnail (M6-20), the share image (M6-32) and the background image.
 */
export function ownedImagePaths(
  doc: PublishDoc,
  ownerId: string,
  mediaOrigin: string,
  subPages: readonly { blocks: readonly Block[] }[] = [],
): string[] {
  const paths = new Set<string>();
  const own = (path: string | null) => {
    if (path !== null && path.startsWith(`${ownerId}/`)) paths.add(path);
  };
  own(doc.profile.photo?.path ?? null);
  // The profile's logo (M9-24).
  own(doc.profile.logo?.path ?? null);
  for (const block of [...doc.blocks, ...subPages.flatMap((page) => page.blocks)]) {
    if ((block.type === "card" || block.type === "image") && block.image) own(block.image.path);
    if (block.type === "link" && block.icon?.type === "image") own(block.icon.image.path);
    // A book's cover (M9-20).
    if (block.type === "book" && block.cover) own(block.cover.path);
    // An item's photo (M12-01).
    if (block.type === "items") for (const item of block.items) own(item.image?.path ?? null);
  }
  own(doc.share?.image?.path ?? null);
  own(mediaPathOf(doc.tokens.bgImage, mediaOrigin));
  return [...paths];
}

export interface CheckedImages {
  doc: PublishDoc;
  /**
   * References removed: one for each photo, card image, image-block image, link thumbnail and share
   * image, and one for the background.
   */
  missingImages: number;
  /** The resolved background image was replaced (the draft's page-level overrides then say so). */
  backgroundMissing: boolean;
}

/** An image reference is kept only when the checker says so; the checker counts what it drops. */
type KeepImage = <R extends { path: string }>(ref: R | null) => R | null;

/**
 * One block with the images that cannot be shown taken out: the shared half of `nullMissingImages`
 * (Home) and `nullMissingSubPageImages`. A link's thumbnail is removed from the link, a card, image
 * or book image becomes null, and an item's photo is removed from the item (M12-01). The block is
 * returned as it came when nothing changed.
 */
function checkBlockImages(block: Block, keep: KeepImage): Block {
  if ((block.type === "card" || block.type === "image") && block.image) {
    const image = keep(block.image);
    return image === block.image ? block : ({ ...block, image } as Block);
  }
  if (block.type === "link" && block.icon?.type === "image") {
    if (keep(block.icon.image) !== null) return block;
    const rest = { ...block };
    delete rest.icon;
    return rest;
  }
  // A cover that cannot be shown becomes null (the draft schema has the key as null): the book,
  // its text and its store buttons stay, and the page draws no cover (M9-20).
  if (block.type === "book" && block.cover) {
    const cover = keep(block.cover);
    return cover === block.cover ? block : ({ ...block, cover } as Block);
  }
  // An item whose photo is gone stays, without the photo (the draft schema has no null for it).
  if (block.type === "items" && block.items.some((item) => item.image)) {
    let changed = false;
    const items = block.items.map((item) => {
      if (!item.image || keep(item.image) !== null) return item;
      changed = true;
      const rest = { ...item };
      delete rest.image;
      return rest;
    });
    return changed ? { ...block, items } : block;
  }
  return block;
}

function makeKeep(
  ownerId: string,
  isPresent: (path: string) => boolean,
  onMissing: () => void,
): KeepImage {
  return (ref) => {
    if (ref === null) return null;
    if (ref.path.startsWith(`${ownerId}/`) && isPresent(ref.path)) return ref;
    onMissing();
    return null;
  };
}

/**
 * A copy of `doc` with every image that cannot be shown replaced by null, and the count. An image
 * reference is kept only when its path is inside the owner's folder and `isPresent` says the object
 * is still in `page-media`. A link's thumbnail (the draft schema has no null for `icon`) is removed
 * from the link instead, so the link stays and shows no icon; the share image becomes null and the
 * share title and description stay. The version's frozen background image goes the same way: when
 * `tokens.bgImage` is not one of this project's media URLs, is in another user's folder, or names
 * an object that is gone, it becomes null (and a background type of `image` becomes `solid`), so
 * the page is drawn, and later published, without it.
 *
 * Never mutates its input and never reads anything from the caller's document but its own fields.
 */
export function nullMissingImages(
  doc: PublishDoc,
  ownerId: string,
  mediaOrigin: string,
  isPresent: (path: string) => boolean,
): CheckedImages {
  let missing = 0;
  const keep = makeKeep(ownerId, isPresent, () => {
    missing += 1;
  });

  const photo = keep(doc.profile.photo);
  // A logo that cannot be shown is left off the profile (M9-24), so the page is drawn without it.
  const logo = doc.profile.logo ? keep(doc.profile.logo) : null;
  const blocks = doc.blocks.map((block) => checkBlockImages(block, keep));

  let share = doc.share;
  if (share?.image) {
    const image = keep(share.image);
    if (image === null) share = { ...share, image: null };
  }

  let tokens: TokenSet = doc.tokens;
  let backgroundMissing = false;
  if (tokens.bgImage !== null) {
    const path = mediaPathOf(tokens.bgImage, mediaOrigin);
    if (path === null || !path.startsWith(`${ownerId}/`) || !isPresent(path)) {
      missing += 1;
      backgroundMissing = true;
      tokens = {
        ...tokens,
        bgImage: null,
        bgType: tokens.bgType === "image" ? "solid" : tokens.bgType,
      };
    }
  }

  return {
    doc: {
      ...doc,
      profile: withLogo({ ...doc.profile, photo }, logo),
      blocks,
      ...(share === undefined ? {} : { share }),
      tokens,
    },
    missingImages: missing,
    backgroundMissing,
  };
}

/**
 * A sub-page of a version with its missing images taken out the way Home's are (M12-04), and how
 * many there were. Never mutates its input.
 */
export function nullMissingSubPageImages(
  page: SubPagePublish,
  ownerId: string,
  isPresent: (path: string) => boolean,
): { page: SubPagePublish; missingImages: number } {
  let missing = 0;
  const keep = makeKeep(ownerId, isPresent, () => {
    missing += 1;
  });
  return {
    page: { ...page, blocks: page.blocks.map((block) => checkBlockImages(block, keep)) },
    missingImages: missing,
  };
}

/** The profile with its logo as checked: the key goes when the logo is gone (M9-24). */
function withLogo<P extends { logo?: ImageRef | null | undefined }>(
  profile: P,
  logo: ImageRef | null,
): P {
  if (profile.logo === undefined || profile.logo === null) return profile;
  if (logo !== null) return profile;
  const rest = { ...profile };
  delete rest.logo;
  return rest;
}

/**
 * The theme of the restored draft, so that `resolveTokens(themeTokens, theme.overrides)` equals the
 * version's frozen `tokens` exactly (the pure part of "theme fidelity"):
 *
 *   - the theme is unchanged: its reference and the version's overrides are kept as they were;
 *   - the theme was edited since: the reference is kept and the overrides gain every token whose
 *     value would otherwise differ from the frozen one;
 *   - the theme was deleted, or is not the owner's to use (`themeTokens` is null): the reference
 *     becomes null and the overrides carry every token the theme used to supply.
 *
 * `frozen` is the version's own `tokens`, as stored. When the version's background image is not
 * available (`backgroundMissing`), the page-level overrides say so, in a form Publish accepts:
 * `bgImage` null, and `bgType` solid when it was image.
 */
export function restoredTheme(
  version: Pick<PublishDoc, "theme">,
  frozen: TokenSet,
  themeTokens: Partial<TokenSet> | null,
  backgroundMissing: boolean,
): DocTheme {
  const base = resolveTokens(themeTokens, version.theme.overrides);
  const overrides: Record<string, unknown> = { ...version.theme.overrides };
  for (const key of TOKEN_KEYS) {
    // `undefined` would not override anything (a token the stored version predates keeps its default).
    if (frozen[key] !== undefined && base[key] !== frozen[key]) overrides[key] = frozen[key];
  }
  if (backgroundMissing) {
    overrides.bgImage = null;
    if (frozen.bgType === "image") overrides.bgType = "solid";
  }
  return {
    ref: themeTokens === null ? null : version.theme.ref,
    overrides: overrides as TokenOverrides,
  };
}

/** The `rev` a restored draft carries: the stored one plus one (a stored draft with no usable rev counts as 0). */
export function nextRev(storedDraft: unknown): number {
  const rev =
    typeof storedDraft === "object" && storedDraft !== null && !Array.isArray(storedDraft)
      ? (storedDraft as Record<string, unknown>).rev
      : undefined;
  return typeof rev === "number" && Number.isSafeInteger(rev) && rev >= 0 ? rev + 1 : 1;
}

/**
 * The draft a version restores to: its profile, its share card (M6-32, when the version has one),
 * its blocks (ids kept, all visible, in order), the theme from `restoredTheme` and `rev` set by the
 * caller. `doc` is the version after `nullMissingImages`. Not validated here: the caller parses the
 * result with `draftDocSchema`.
 */
export function versionToDraft(doc: PublishDoc, theme: DocTheme, rev: number): DraftDoc {
  return {
    version: 1,
    rev,
    profile: { ...doc.profile },
    ...(doc.share === undefined ? {} : { share: { ...doc.share } }),
    // The version's support banner (M9-23), when it had one.
    ...(doc.banner === undefined ? {} : { banner: { ...doc.banner } }),
    // The version's UTM defaults and redirect mode (M9-27, M9-31), when it had them.
    ...(doc.utm === undefined ? {} : { utm: { ...doc.utm } }),
    ...(doc.redirect === undefined ? {} : { redirect: { ...doc.redirect } }),
    // The site menu (M11-07): Home's document carries it, so a restore keeps it. An entry for a page
    // deleted since is dropped at Publish (`pruneNav`).
    ...(doc.nav === undefined ? {} : { nav: { show: doc.nav.show, items: [...doc.nav.items] } }),
    theme,
    blocks: doc.blocks.map((block) => ({ ...block, visible: true }) as Block),
  };
}

/** The draft of a sub-page a version restores to: its path, title, description and blocks (ids kept, all visible). */
export function versionToSubPageDraft(page: SubPagePublish): SubPageDraft {
  return {
    path: page.path,
    title: page.title,
    description: page.description,
    blocks: page.blocks.map((block) => ({ ...block, visible: true }) as Block),
  };
}
