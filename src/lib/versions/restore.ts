import type { Block, DocTheme, DraftDoc, ImageRef, PublishDoc } from "@/lib/document";
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
 * dropped without asking Storage), and neither is anything that is not an image path.
 */
export function ownedImagePaths(doc: PublishDoc, ownerId: string, mediaOrigin: string): string[] {
  const paths = new Set<string>();
  const own = (path: string | null) => {
    if (path !== null && path.startsWith(`${ownerId}/`)) paths.add(path);
  };
  own(doc.profile.photo?.path ?? null);
  for (const block of doc.blocks) {
    if ((block.type === "card" || block.type === "image") && block.image) own(block.image.path);
  }
  own(mediaPathOf(doc.tokens.bgImage, mediaOrigin));
  return [...paths];
}

export interface CheckedImages {
  doc: PublishDoc;
  /** References replaced by null: one for each photo, card image or image-block image, and one for the background. */
  missingImages: number;
  /** The resolved background image was replaced (the draft's page-level overrides then say so). */
  backgroundMissing: boolean;
}

/**
 * A copy of `doc` with every image that cannot be shown replaced by null, and the count. An image
 * reference is kept only when its path is inside the owner's folder and `isPresent` says the object
 * is still in `page-media`. The version's frozen background image goes the same way: when
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
  const keep = (ref: ImageRef | null): ImageRef | null => {
    if (ref === null) return null;
    if (ref.path.startsWith(`${ownerId}/`) && isPresent(ref.path)) return ref;
    missing += 1;
    return null;
  };

  const photo = keep(doc.profile.photo);
  const blocks = doc.blocks.map((block): Block => {
    if ((block.type === "card" || block.type === "image") && block.image) {
      const image = keep(block.image);
      return image === block.image ? block : ({ ...block, image } as Block);
    }
    return block;
  });

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
    doc: { ...doc, profile: { ...doc.profile, photo }, blocks, tokens },
    missingImages: missing,
    backgroundMissing,
  };
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
 * The draft a version restores to: its profile, its blocks (ids kept, all visible, in order), the
 * theme from `restoredTheme` and `rev` set by the caller. `doc` is the version after
 * `nullMissingImages`. Not validated here: the caller parses the result with `draftDocSchema`.
 */
export function versionToDraft(doc: PublishDoc, theme: DocTheme, rev: number): DraftDoc {
  return {
    version: 1,
    rev,
    profile: { ...doc.profile },
    theme,
    blocks: doc.blocks.map((block) => ({ ...block, visible: true }) as Block),
  };
}
