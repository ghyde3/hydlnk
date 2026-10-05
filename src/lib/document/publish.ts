import {
  BLOCK_OVERRIDE_KEYS,
  resolveTokens,
  type BlockOverrides,
  type TokenSet,
} from "@/lib/theme";
import { pickShape, publishFocus } from "./focus";
import { publishTextAndMarks } from "./marks";
import { publishLock } from "./lock";
import { publishNav } from "./nav";
import { publishBanner, publishNameStyle } from "./page-extras";
import { resolveProfileOptions } from "./profile-options";
import { publishShare } from "./share";
import { publishLinkUtm, publishPageUtm } from "./utm";
import {
  publishDocSchema,
  type Block,
  type DraftDoc,
  type ImageRef,
  type LinkBlock,
  type PublishDoc,
  type SocialIcon,
} from "./schema";

/**
 * The publish form of a draft: what Publish writes to `pages.published` and what the editor's
 * status chip compares with it (M2-27). Pure and total: it never throws and never reads the clock,
 * the database or the document's `rev`.
 *
 *   - `rev` is dropped; hidden blocks (`visible === false`) are removed, the rest carry
 *     `visible: true`;
 *   - `tokens` is every token resolved: system default, then `themeTokens` (the draft's theme row,
 *     or null for none or a deleted one), then the page's overrides;
 *   - the six profile display options are written explicitly, with the default for a missing one;
 *   - every text and URL is trimmed, unknown keys are not copied, block `overrides` keep only the
 *     keys of `BLOCK_OVERRIDE_KEYS` that have a value (omitted when none), and an empty optional
 *     image link is omitted. The result is canonical, so two equal drafts give deep-equal forms.
 *
 * It does not validate. The Publish gate runs `publishDocSchema` on the draft first and
 * `publishedDocSchema` on this result before writing.
 */
export function toPublishForm(draft: DraftDoc, themeTokens: Partial<TokenSet> | null): PublishDoc {
  const blocks: Block[] = [];
  for (const block of draft.blocks) {
    if (block.visible === false) continue;
    const form = publishBlock(block);
    if (form) blocks.push(form);
  }
  // The share card (M6-32): trimmed, empty fields omitted, no `share` key at all when all are empty.
  const share = publishShare(draft.share);
  // The support banner (M9-23): trimmed; no key at all when it is hidden or empty.
  const banner = publishBanner(draft.banner);
  // The logo and the name's own style (M9-24): written only when they differ from the defaults, so a
  // page that uses none publishes byte-identically to before. A logo's focus is dropped.
  const logo = imageRef(draft.profile.logo ?? null);
  // The page's UTM defaults (M9-27) and redirect mode (M9-31): written only when set, so a page that
  // never used either publishes byte-identically to before.
  const utm = publishPageUtm(draft.utm);
  const redirect = publishRedirect(draft.redirect);
  // The site menu (M11-07): written only when it is not the default, like the extras above.
  const nav = publishNav(draft.nav);
  return {
    version: 1,
    ...(share ? { share } : {}),
    ...(banner ? { banner } : {}),
    ...(utm ? { utm } : {}),
    ...(redirect ? { redirect } : {}),
    ...(nav ? { nav } : {}),
    profile: {
      name: draft.profile.name.trim(),
      bio: draft.profile.bio.trim(),
      photo: imageRef(draft.profile.photo),
      // Always written, every one filled (M6-15, M6-17), so the form deep-equals a stored
      // document that the strict schema has parsed (which fills the same defaults).
      ...resolveProfileOptions(draft.profile),
      ...(logo ? { logo } : {}),
      ...publishNameStyle(draft.profile, logo !== null),
    },
    theme: { ref: draft.theme.ref, overrides: { ...draft.theme.overrides } },
    tokens: resolveTokens(themeTokens, draft.theme.overrides),
    blocks,
  };
}

function imageRef(ref: ImageRef | null): ImageRef | null {
  return ref ? { path: ref.path, width: ref.width, height: ref.height } : null;
}

/**
 * A card's or an image block's reference (M6-23): the same, plus its focus rounded to three
 * decimals and left out when it is the center, so two equal drafts give equal forms. The profile
 * photo and link thumbnails use `imageRef`, which drops the focus (they are square crops already).
 */
function imageRefWithFocus(ref: ImageRef | null): ImageRef | null {
  if (!ref) return null;
  const focus = publishFocus(ref.focus);
  return { path: ref.path, width: ref.width, height: ref.height, ...(focus ? { focus } : {}) };
}

/**
 * A block's own style (M6-45), on every block type: the ten `BLOCK_OVERRIDE_KEYS` that have a
 * value and nothing else, or no `overrides` key at all. Two equal drafts give equal forms.
 */
function cleanOverrides(overrides: BlockOverrides | undefined): { overrides?: BlockOverrides } {
  if (!overrides) return {};
  const kept: Record<string, unknown> = {};
  for (const key of BLOCK_OVERRIDE_KEYS) {
    if (overrides[key] !== undefined) kept[key] = overrides[key];
  }
  return Object.keys(kept).length > 0 ? { overrides: kept as BlockOverrides } : {};
}

/**
 * A link's `icon` and `featured` (M6-20, M6-22), each only when set: the built-in name, or the
 * image's path, width and height and nothing else. Two equal drafts give equal forms.
 */
function linkDecorations(block: LinkBlock): Pick<LinkBlock, "icon" | "featured" | "utm" | "lock"> {
  const out: Pick<LinkBlock, "icon" | "featured" | "utm" | "lock"> = {};
  const icon = block.icon;
  if (icon?.type === "builtin") out.icon = { type: "builtin", name: icon.name };
  else if (icon?.type === "image") out.icon = { type: "image", image: imageRef(icon.image)! };
  if (block.featured !== undefined) out.featured = block.featured;
  // This link's own UTM tags (M9-27) and its lock (M9-29): each only when it says something.
  const utm = publishLinkUtm(block.utm);
  if (utm) out.utm = utm;
  const lock = publishLock(block.lock);
  if (lock) out.lock = lock;
  return out;
}

/** Redirect mode as Publish stores it: `{linkId}` (trimmed), or no key when it is off. */
function publishRedirect(redirect: DraftDoc["redirect"]): { linkId: string } | undefined {
  if (!redirect || typeof redirect.linkId !== "string") return undefined;
  const linkId = redirect.linkId.trim();
  return linkId === "" ? undefined : { linkId };
}

/** A multi-line value as Publish stores it: line breaks as LF, trimmed (a FAQ answer, the contact hours). */
function publishLines(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function publishIcon(icon: SocialIcon): SocialIcon {
  return icon.platform === "email"
    ? { id: icon.id, platform: "email", address: icon.address.trim() }
    : { id: icon.id, platform: icon.platform, url: icon.url.trim() };
}

/** One store button of a book or app block (M9-20, M9-21): its id, the store and the trimmed address. */
function publishStoreLink<L extends { id: string; store: string; url: string }>(link: L) {
  return { id: link.id, store: link.store, url: link.url.trim() };
}

export function publishBlock(block: Block): Block | null {
  const base = { id: block.id, visible: true } as const;
  switch (block.type) {
    case "link":
      return {
        ...base,
        type: "link",
        label: block.label.trim(),
        url: block.url.trim(),
        ...linkDecorations(block),
        ...cleanOverrides(block.overrides),
      };
    case "card":
      return {
        ...base,
        type: "card",
        title: block.title.trim(),
        caption: block.caption.trim(),
        url: block.url.trim(),
        image: imageRefWithFocus(block.image),
        ...cleanOverrides(block.overrides),
      };
    case "header":
      return {
        ...base,
        type: "header",
        text: block.text.trim(),
        ...cleanOverrides(block.overrides),
      };
    case "text": {
      // The text trimmed and its marks shifted and clipped with it (M6-28); no `marks` key when none are left.
      const { text, marks } = publishTextAndMarks(block.text, block.marks);
      return {
        ...base,
        type: "text",
        text,
        ...(marks.length > 0 ? { marks } : {}),
        ...cleanOverrides(block.overrides),
      };
    }
    case "image": {
      const link = block.url?.trim() ?? "";
      const shape = pickShape(block.shape);
      return {
        ...base,
        type: "image",
        image: imageRefWithFocus(block.image),
        ...(shape ? { shape } : {}),
        alt: block.alt.trim(),
        ...(link === "" ? {} : { url: link }),
        ...cleanOverrides(block.overrides),
      };
    }
    case "social":
      return {
        ...base,
        type: "social",
        icons: block.icons.map(publishIcon),
        ...cleanOverrides(block.overrides),
      };
    case "embed":
      return {
        ...base,
        type: "embed",
        url: block.url.trim(),
        caption: block.caption.trim(),
        ...cleanOverrides(block.overrides),
      };
    case "grid":
      return {
        ...base,
        type: "grid",
        cells: block.cells.map((cell) => ({
          id: cell.id,
          title: cell.title.trim(),
          subtitle: cell.subtitle.trim(),
          url: cell.url.trim(),
        })),
        ...cleanOverrides(block.overrides),
      };
    case "divider":
      return { ...base, type: "divider", ...cleanOverrides(block.overrides) };
    case "faq":
      return {
        ...base,
        type: "faq",
        items: block.items.map((item) => ({
          id: item.id,
          question: item.question.trim(),
          answer: publishLines(item.answer),
        })),
        ...cleanOverrides(block.overrides),
      };
    case "contact":
      return {
        ...base,
        type: "contact",
        name: block.name.trim(),
        phone: block.phone.trim(),
        email: block.email.trim(),
        hours: publishLines(block.hours),
        ...cleanOverrides(block.overrides),
      };
    case "discount": {
      const link = block.url?.trim() ?? "";
      return {
        ...base,
        type: "discount",
        code: block.code.trim(),
        description: block.description.trim(),
        ...(link === "" ? {} : { url: link }),
        ...cleanOverrides(block.overrides),
      };
    }
    case "book":
      return {
        ...base,
        type: "book",
        title: block.title.trim(),
        author: block.author.trim(),
        // A cover is a plain reference: no focus (it is always cropped from its middle).
        cover: imageRef(block.cover),
        links: block.links.map(publishStoreLink),
        ...cleanOverrides(block.overrides),
      };
    case "apps":
      return {
        ...base,
        type: "apps",
        links: block.links.map(publishStoreLink),
        ...cleanOverrides(block.overrides),
      };
    case "map":
      return {
        ...base,
        type: "map",
        name: block.name.trim(),
        address: block.address.trim(),
        googleId: block.googleId,
        appleId: block.appleId,
        ...cleanOverrides(block.overrides),
      };
    case "page_link":
      return {
        ...base,
        type: "page_link",
        label: block.label.trim(),
        target: block.target.trim(),
        ...cleanOverrides(block.overrides),
      };
    default:
      // Not a block this version knows (only reachable with unparsed data): never published.
      return null;
  }
}

/**
 * Deep equality for JSON documents that ignores object key order (Postgres `jsonb` does not keep
 * it) and treats a missing key like an `undefined` one. Use it to compare `toPublishForm(draft)`
 * with a parsed `pages.published`.
 */
export function publishFormsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => publishFormsEqual(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!publishFormsEqual(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Every image reference in a document: the profile photo, card images and image blocks, and the
 * share image (M6-32), last.
 */
export function collectImageRefs(doc: {
  profile: { photo: ImageRef | null; logo?: ImageRef | null | undefined };
  share?: { image?: ImageRef | null } | undefined;
  blocks: readonly Block[];
}): ImageRef[] {
  const refs: ImageRef[] = [];
  if (doc.profile.photo) refs.push(doc.profile.photo);
  // The profile's logo (M9-24) is an image of the owner's folder like the photo.
  if (doc.profile.logo) refs.push(doc.profile.logo);
  for (const block of doc.blocks) {
    if ((block.type === "card" || block.type === "image") && block.image) refs.push(block.image);
    if (block.type === "link" && block.icon?.type === "image") refs.push(block.icon.image);
    // A book's cover (M9-20) is an image of the owner's folder like a card's.
    if (block.type === "book" && block.cover) refs.push(block.cover);
  }
  if (doc.share?.image) refs.push(doc.share.image);
  return refs;
}

/** One reason a draft cannot be published. */
export interface PublishError {
  /** The block that failed, or null for the profile and document-level problems. */
  blockId: string | null;
  /** The social icon or grid cell that failed, when the problem is inside one. */
  itemId?: string;
  /** `profile.name`, `profile.bio`, `blocks`, or the block field (`label`, `url`, `image`, `alt`...). */
  field: string;
  /** Copy for the editor, for example "Add a link label.". */
  message: string;
  /**
   * Set when the problem is on a sub-page (M11-05), never for Home: the page's id and the title the
   * message names it by, so the editor can open that page.
   */
  subPageId?: string;
  pageTitle?: string;
}

type Raw = Record<string, unknown> | undefined;
const asRecord = (value: unknown): Raw =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/**
 * Runs `publishDocSchema` on a raw draft and maps each issue to the block (and icon or cell) that
 * caused it, one error per field. Safe on garbage input: ids are read defensively from the raw JSON.
 * Returns an empty list when the draft can be published.
 */
export function collectPublishErrors(draft: unknown): PublishError[] {
  const result = publishDocSchema.safeParse(draft);
  if (result.success) return [];
  return mapPublishIssues(result.error.issues, draft);
}

/**
 * Maps the issues of a document schema to the block (and icon or cell) that caused each, one error
 * per field. Shared by Home's `collectPublishErrors` and the sub-pages' (`collectSubPagePublishErrors`):
 * both documents hold the same `blocks`.
 */
export function mapPublishIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  draft: unknown,
): PublishError[] {
  const rawBlocks = asRecord(draft)?.blocks;
  const errors: PublishError[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const path = issue.path;
    let error: PublishError;
    if (path[0] === "blocks" && typeof path[1] === "number") {
      const rawBlock = Array.isArray(rawBlocks) ? asRecord(rawBlocks[path[1]]) : undefined;
      const blockId = typeof rawBlock?.id === "string" ? rawBlock.id : null;
      const rest = path.slice(2);
      const list =
        rest[0] === "icons" ||
        rest[0] === "cells" ||
        rest[0] === "marks" ||
        rest[0] === "items" ||
        rest[0] === "links"
          ? rawBlock?.[rest[0]]
          : undefined;
      if (Array.isArray(list) && typeof rest[1] === "number") {
        const rawItem = asRecord(list[rest[1]]);
        const itemId = typeof rawItem?.id === "string" ? rawItem.id : undefined;
        error = {
          blockId,
          ...(itemId ? { itemId } : {}),
          // A bold or italic mark has no id: its problems belong to the block's `marks`.
          field:
            rest[0] === "marks" && !itemId ? "marks" : rest.slice(2).join(".") || String(rest[0]),
          message: issue.message,
        };
      } else {
        // A focus outside the picture (M6-23) is one error on the block's `focus`, not one per axis.
        // A lock (M9-29) is one error on the block's `lock`, whichever of its parts is wrong.
        const field =
          rest[0] === "image" && rest[1] === "focus"
            ? "focus"
            : rest[0] === "lock"
              ? "lock"
              : rest.join(".") || "type";
        error = { blockId, field, message: issue.message };
      }
    } else {
      error = { blockId: null, field: path.join(".") || "document", message: issue.message };
    }
    const key = `${error.blockId ?? ""}|${error.itemId ?? ""}|${error.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push(error);
  }
  return errors;
}
