import {
  BLOCK_TYPE_LABELS,
  PHOTO_BORDERS,
  PHOTO_SHAPES,
  PHOTO_SIZES,
  applyProfileOption,
  blockDefaults,
  blockSchema,
  changeSocialPlatform,
  DAY_KEYS,
  HOME_TARGET,
  collectPublishErrors,
  collectSubPagePublishErrors,
  draftDocSchema,
  draftSubPageSchema,
  publishedSubPageSchema,
  toSubPagePublishForm,
  newListItem,
  isHoursTimezone,
  newAppLink,
  newBookLink,
  newFaqItem,
  newGridCell,
  newSocialIcon,
  normalizeUrl,
  publishBlockSchema,
  publishedDocSchema,
  publishFormsEqual,
  resolveProfileOptions,
  singleLine,
  stripHiddenCharacters,
  toPublishForm,
  type Block,
  type BlockType,
  type DraftDoc,
  type ImageRef,
  type SocialPlatform,
  type SubPageDraft,
} from "@/lib/document";
import { SOCIAL_PLATFORMS } from "@/lib/document";
import { computePublishStatus, type PublishStatus } from "@/lib/editor/status";
import { resolveTokens, type TokenSet } from "@/lib/theme";
import { friendlyPublishError, friendlyPublishErrors } from "@/lib/themes/publish-errors";
import { MESSAGES, ToolFailure, type ToolIssue } from "./errors";
import { imageIdOf } from "./images";
import { HOURS_TIMEZONE_LIST, SOCIAL_PLATFORM_LIST, type ParsedFields } from "./block-fields";

/**
 * The AI-friendly layer over the page document (M10-24..M10-27). Two halves, both pure:
 *
 *   view   a draft as the JSON `get_page` returns: concise, with the ids a tool needs, images as
 *          `{imageId, width, height}`, and nothing secret (a lock shows that it is locked and its
 *          kind, never its hash; a map's analytics ids and a text block's mark ids are left out).
 *   patch  the fields a write tool takes, applied to a block and then checked by the document's own
 *          schemas, so there is no second rule set: a visible block must pass `publishBlockSchema`,
 *          a hidden one `blockSchema`, and the whole draft passes `draftDocSchema` in `writeDraft`.
 *
 * The write helpers throw `ToolFailure('invalid_input', ...)` with the document's own wording.
 */

// ---------------------------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------------------------

/** A one-line field: line breaks become spaces, hidden and bidirectional characters go. */
export function cleanLine(value: string): string {
  return stripHiddenCharacters(singleLine(value));
}

/** A multi-line field (a text block, a FAQ answer, the contact hours): LF line breaks, hidden characters out. */
export function cleanMultiline(value: string): string {
  return stripHiddenCharacters(value.replace(/\r\n?/g, "\n"), { multiline: true });
}

/** A web address as the editor's field writes it back on blur. It never alters an unsafe one. */
export function cleanUrl(value: string): string {
  return normalizeUrl(value);
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

/** 'a link block', 'an image block', 'an FAQ block': the noun a sentence uses for a block type. */
export function blockPhrase(type: BlockType): string {
  const label = BLOCK_TYPE_LABELS[type];
  const noun = label === "FAQ" ? label : label.toLowerCase();
  return `${/^(?:[aeiou]|faq)/i.test(noun) ? "an" : "a"} ${noun} block`;
}

export interface ImageView {
  imageId: string;
  width: number;
  height: number;
}

export function imageView(ref: ImageRef | null | undefined): ImageView | null {
  if (!ref) return null;
  return { imageId: imageIdOf(ref), width: ref.width, height: ref.height };
}

type Rec = Record<string, unknown>;
const asRec = (value: unknown): Rec => (value ?? {}) as Rec;

function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** '2 links, bold and italic': what a text block's formatting holds, without the ranges or ids. */
export function formattingSentence(marks: unknown): string | null {
  if (!Array.isArray(marks) || marks.length === 0) return null;
  const types = new Map<string, number>();
  for (const mark of marks) {
    const type = String(asRec(mark).type);
    types.set(type, (types.get(type) ?? 0) + 1);
  }
  const parts: string[] = [];
  const links = types.get("link") ?? 0;
  if (links > 0) parts.push(`${links} ${links === 1 ? "link" : "links"}`);
  for (const [type, label] of [
    ["bold", "bold"],
    ["italic", "italic"],
    ["strike", "strikethrough"],
    ["underline", "underline"],
    ["align", "alignment"],
  ] as const) {
    if (types.has(type)) parts.push(label);
  }
  if (parts.length === 0) return null;
  return `${listPhrase(parts)}. Tools can’t edit formatting, and changing the text clears it.`;
}

function overridesView(block: Rec): Rec {
  const overrides = block.overrides;
  if (!overrides || typeof overrides !== "object") return {};
  const kept = Object.fromEntries(
    Object.entries(overrides as Rec).filter(([, value]) => value !== undefined),
  );
  return Object.keys(kept).length > 0 ? { overrides: kept } : {};
}

/** One block as `get_page` shows it: `{ id, type, visible, ...the fields the write tools take }`. */
export function blockView(input: Block): Rec {
  const block = input as unknown as Rec;
  const base = { id: block.id, type: block.type, visible: block.visible !== false };
  const extras = overridesView(block);
  switch (block.type as BlockType) {
    case "link": {
      const icon = block.icon as Rec | undefined;
      const lock = block.lock as Rec | undefined;
      return {
        ...base,
        label: block.label,
        url: block.url,
        ...(icon
          ? {
              icon:
                icon.type === "image"
                  ? imageView(icon.image as ImageRef)
                  : String(asRec(icon).name),
            }
          : {}),
        ...(block.featured !== undefined ? { featured: block.featured } : {}),
        ...(lock ? { lock: { locked: true, kind: lock.kind } } : {}),
        ...(block.utm ? { utm: block.utm } : {}),
        ...extras,
      };
    }
    case "card":
      return {
        ...base,
        title: block.title,
        caption: block.caption,
        url: block.url,
        image: imageView(block.image as ImageRef | null),
        ...extras,
      };
    case "header":
      return { ...base, text: block.text, ...extras };
    case "text": {
      const formatting = formattingSentence(block.marks);
      return { ...base, text: block.text, ...(formatting ? { formatting } : {}), ...extras };
    }
    case "image":
      return {
        ...base,
        image: imageView(block.image as ImageRef | null),
        alt: block.alt,
        ...(block.url ? { url: block.url } : {}),
        ...(block.shape ? { shape: block.shape } : {}),
        ...extras,
      };
    case "social":
      return {
        ...base,
        icons: (block.icons as Rec[]).map((icon) => ({
          id: icon.id,
          platform: icon.platform,
          ...(icon.platform === "email" ? { address: icon.address } : { url: icon.url }),
        })),
        ...extras,
      };
    case "embed":
      return { ...base, url: block.url, caption: block.caption, ...extras };
    case "grid":
      return {
        ...base,
        cells: (block.cells as Rec[]).map((cell) => ({
          id: cell.id,
          title: cell.title,
          subtitle: cell.subtitle,
          url: cell.url,
        })),
        ...extras,
      };
    case "divider":
      return { ...base, ...extras };
    case "faq":
      return {
        ...base,
        items: (block.items as Rec[]).map((item) => ({
          id: item.id,
          question: item.question,
          answer: item.answer,
        })),
        ...extras,
      };
    case "contact":
      return {
        ...base,
        name: block.name,
        phone: block.phone ?? "",
        email: block.email ?? "",
        hours: block.hours ?? "",
        ...extras,
      };
    case "discount":
      return {
        ...base,
        code: block.code,
        description: block.description ?? "",
        ...(block.url ? { url: block.url } : {}),
        ...extras,
      };
    case "book":
      return {
        ...base,
        title: block.title,
        author: block.author,
        cover: imageView((block.cover as ImageRef | null) ?? null),
        links: (block.links as Rec[]).map((link) => ({
          id: link.id,
          store: link.store,
          url: link.url,
        })),
        ...extras,
      };
    case "apps":
      return {
        ...base,
        links: (block.links as Rec[]).map((link) => ({
          id: link.id,
          store: link.store,
          url: link.url,
        })),
        ...extras,
      };
    case "map":
      return { ...base, name: block.name, address: block.address, ...extras };
    case "page_link":
      return { ...base, label: block.label, target: block.target, ...extras };
    case "items":
      return {
        ...base,
        ...(block.heading ? { heading: block.heading } : {}),
        layout: block.layout,
        items: (block.items as Rec[]).map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          description: item.description,
          ...(item.image ? { image: imageView(item.image as ImageRef) } : {}),
          ...(item.url ? { url: item.url } : {}),
          sold: item.sold === true,
        })),
        ...extras,
      };
    case "hours":
      return {
        ...base,
        timezone: block.timezone,
        days: block.days,
        ...(block.note ? { note: block.note } : {}),
        ...extras,
      };
    default:
      return { ...base };
  }
}

export interface ProfileView {
  name: string;
  bio: string;
  photo: ImageView | null;
  photoShape: string;
  photoSize: string;
  photoBorder: string;
  showPhoto: boolean;
  showName: boolean;
  showBio: boolean;
}

export function profileView(profile: DraftDoc["profile"]): ProfileView {
  const options = resolveProfileOptions(profile);
  return {
    name: profile.name,
    bio: profile.bio,
    photo: imageView(profile.photo),
    ...options,
  };
}

export interface ThemeInfo {
  id: string;
  name: string;
  system: boolean;
  tokens: Partial<TokenSet>;
}

export function themeView(theme: DraftDoc["theme"], row: ThemeInfo | null): Rec {
  const resolved = resolveTokens(row?.tokens ?? null, theme.overrides);
  return {
    kind: row ? (row.system ? "system" : "saved") : "none",
    id: row?.id ?? null,
    name: row?.name ?? null,
    overrides: { ...theme.overrides },
    resolved: {
      bg: resolved.bg,
      text: resolved.text,
      accent: resolved.accent,
      fontHeading: resolved.fontHeading,
      fontBody: resolved.fontBody,
      buttonStyle: resolved.buttonStyle,
      radius: resolved.radius,
    },
  };
}

/** The page-level settings present in the draft that no tool can change, named for the person. */
export function alsoSetInTheApp(doc: DraftDoc): string[] {
  const names: string[] = [];
  if (doc.banner) names.push("banner");
  if (doc.share && (doc.share.title || doc.share.description || doc.share.image)) {
    names.push("share card");
  }
  if (doc.utm && Object.values(doc.utm).some((value) => value !== undefined && value !== "")) {
    names.push("UTM tags");
  }
  if (doc.redirect) names.push("redirect mode");
  return names;
}

export interface PublishIssueView {
  blockId: string | null;
  field: string;
  message: string;
}

/** What Publish would refuse, in Publish's own words (at most 20). */
export function publishIssues(rawDraft: unknown): PublishIssueView[] {
  return friendlyPublishErrors(collectPublishErrors(rawDraft))
    .slice(0, 20)
    .map((error) => ({
      blockId: error.blockId,
      field: error.itemId ? `${error.field} (item ${error.itemId})` : error.field,
      message: error.message,
    }));
}

/**
 * The publish state exactly as the editor's status chip computes it: the draft's publish form
 * against `pages.published`.
 */
export function publishStatusOf(input: {
  draft: DraftDoc;
  published: unknown;
  publishedAt: string | null;
  themeTokens: Partial<TokenSet> | null;
}): PublishStatus {
  const parsed =
    input.published === null || input.published === undefined
      ? null
      : publishedDocSchema.safeParse(input.published);
  return computePublishStatus({
    hasPublished: input.publishedAt !== null,
    published: parsed?.success ? parsed.data : null,
    form: toPublishForm(input.draft, input.themeTokens),
  });
}

/** The stored draft, parsed; null when it cannot be read. */
export function readDraft(raw: unknown): DraftDoc | null {
  const parsed = draftDocSchema.safeParse(raw);
  return parsed.success ? (parsed.data as unknown as DraftDoc) : null;
}

/** The stored draft of a sub-page, parsed; null when it cannot be read. */
export function readSubPageDraft(raw: unknown): SubPageDraft | null {
  const parsed = draftSubPageSchema.safeParse(raw);
  return parsed.success ? (parsed.data as unknown as SubPageDraft) : null;
}

/**
 * A sub-page's state in the words Home's `publishStatus` uses: never published is `not-published`,
 * the draft's publish form equal to what is live is `published`, anything else `unpublished-changes`.
 * Compared the way Publish compares (hidden blocks and key order do not count).
 */
export function subPageStatusOf(input: { draft: SubPageDraft; published: unknown }): PublishStatus {
  const parsed =
    input.published === null || input.published === undefined
      ? null
      : publishedSubPageSchema.safeParse(input.published);
  if (input.published === null || input.published === undefined) return "not-published";
  const live = parsed?.success ? parsed.data : null;
  if (live === null) return "unpublished-changes";
  return publishFormsEqual(toSubPagePublishForm(input.draft), live)
    ? "published"
    : "unpublished-changes";
}

/** What Publish would refuse on a sub-page, in Publish's own words (at most 20). */
export function subPagePublishIssues(rawDraft: unknown): PublishIssueView[] {
  return friendlyPublishErrors(collectSubPagePublishErrors(rawDraft))
    .slice(0, 20)
    .map((error) => ({
      blockId: error.blockId,
      field: error.itemId ? `${error.field} (item ${error.itemId})` : error.field,
      message: error.message,
    }));
}

// ---------------------------------------------------------------------------------------------
// Patch
// ---------------------------------------------------------------------------------------------

/** The images a call refers to, already resolved from the caller's own pages. */
export type ResolvedImages = ReadonlyMap<string, ImageRef>;

type ImageInput = string | { imageId: string };
const imageIdOfInput = (input: ImageInput): string =>
  typeof input === "string" ? input : input.imageId;

/** Every `imageId` the fields refer to, so the caller can resolve them before the patch. */
export function imageIdsIn(type: BlockType, fields: ParsedFields): string[] {
  const ids: string[] = [];
  const add = (value: unknown) => {
    if (value === null || value === undefined) return;
    ids.push(imageIdOfInput(value as ImageInput));
  };
  if (type === "card" || type === "image") add(fields.image);
  if (type === "book") add(fields.cover);
  if (type === "items" && Array.isArray(fields.items)) {
    for (const item of fields.items as Rec[]) add(item.image);
  }
  if (type === "link" && fields.icon && typeof fields.icon === "object") {
    add((fields.icon as { imageId: string }).imageId);
  }
  return ids;
}

function refOf(images: ResolvedImages, input: ImageInput, keepFocus: boolean): ImageRef {
  const ref = images.get(imageIdOfInput(input));
  if (!ref) throw new ToolFailure("image_not_found", MESSAGES.image_not_found);
  return keepFocus ? { ...ref } : { path: ref.path, width: ref.width, height: ref.height };
}

function fail(path: string, message: string): never {
  throw new ToolFailure("invalid_input", message, { issues: [{ path, message }] });
}

/** `overrides` merged key by key; a `null` removes that setting; nothing left removes the key. */
function mergeOverrides(current: unknown, given: Rec): Rec | undefined {
  const next: Rec = { ...asRec(current) };
  for (const [key, value] of Object.entries(given)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

type ItemMerge = {
  key: string;
  label: string;
  makeNew: () => Rec;
  merge: (item: Rec, given: Rec, path: string, images: ResolvedImages) => Rec;
};

/**
 * A list field replaced by the given items. An item that names an `id` must name one of THIS block's
 * items and keeps it; an item with no id keeps the id of the item at the same position; extra items
 * get new ids and dropped ones disappear. A given item is merged over the item it matches, so a field
 * it leaves out stays.
 */
function mergeItems(
  block: Rec,
  given: Rec[],
  spec: ItemMerge,
  images: ResolvedImages = new Map(),
): Rec[] {
  const existing = (block[spec.key] as Rec[]) ?? [];
  const existingIds = new Set(existing.map((item) => String(item.id)));
  // Ids the caller named on purpose: no other item may take one of them by position.
  const claimed = new Set(
    given.flatMap((entry) => (typeof entry.id === "string" ? [entry.id] : [])),
  );
  const used = new Set<string>();
  const out = given.map((entry, index) => {
    const path = `fields.${spec.key}[${index}]`;
    let match: Rec | undefined;
    if (entry.id !== undefined) {
      if (typeof entry.id !== "string" || !existingIds.has(entry.id)) {
        fail(
          `${path}.id`,
          `That id isn’t one of this block’s ${spec.label}. Call get_page for the ids.`,
        );
      }
      match = existing.find((item) => item.id === entry.id);
    } else {
      const positional = existing[index];
      match = positional && !claimed.has(String(positional.id)) ? positional : undefined;
    }
    const base = match ? { ...match } : spec.makeNew();
    const id = String(base.id);
    if (used.has(id)) fail(`${path}.id`, `Two ${spec.label} use the same id.`);
    used.add(id);
    const { id: _ignored, ...rest } = entry;
    void _ignored;
    return spec.merge(base, rest, path, images);
  });
  return out;
}

function checkPlatform(platform: unknown, path: string): SocialPlatform {
  if (typeof platform !== "string" || !(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    fail(`${path}.platform`, `Choose a platform from: ${SOCIAL_PLATFORM_LIST}.`);
  }
  return platform as SocialPlatform;
}

const SOCIAL_MERGE: ItemMerge = {
  key: "icons",
  label: "icons",
  makeNew: () => ({ ...newSocialIcon("instagram") }) as Rec,
  merge(item, given, path) {
    let icon = item as Rec;
    if (given.platform !== undefined) {
      const platform = checkPlatform(given.platform, path);
      icon = changeSocialPlatform(icon as never, platform) as unknown as Rec;
    } else if (item.platform === undefined) {
      fail(`${path}.platform`, "This is required.");
    }
    if (icon.platform === "email") {
      if (given.url !== undefined) {
        fail(`${path}.url`, "An email icon takes address, not url.");
      }
      if (given.address !== undefined)
        icon = { ...icon, address: cleanLine(String(given.address)) };
    } else {
      if (given.address !== undefined) {
        fail(`${path}.address`, "Only an email icon takes address. Use url for this platform.");
      }
      if (given.url !== undefined) icon = { ...icon, url: cleanUrl(String(given.url)) };
    }
    return icon;
  },
};

const GRID_MERGE: ItemMerge = {
  key: "cells",
  label: "cells",
  makeNew: () => ({ ...newGridCell() }) as Rec,
  merge(item, given) {
    const out = { ...item };
    if (given.title !== undefined) out.title = cleanLine(String(given.title));
    if (given.subtitle !== undefined) out.subtitle = cleanLine(String(given.subtitle));
    if (given.url !== undefined) out.url = cleanUrl(String(given.url));
    return out;
  },
};

const FAQ_MERGE: ItemMerge = {
  key: "items",
  label: "questions",
  makeNew: () => ({ ...newFaqItem() }) as Rec,
  merge(item, given) {
    const out = { ...item };
    if (given.question !== undefined) out.question = cleanLine(String(given.question));
    if (given.answer !== undefined) out.answer = cleanMultiline(String(given.answer));
    return out;
  },
};

function storeMerge(label: string, make: () => Rec): ItemMerge {
  return {
    key: "links",
    label,
    makeNew: make,
    merge(item, given) {
      const out = { ...item };
      if (given.store !== undefined) out.store = String(given.store).trim();
      if (given.url !== undefined) out.url = cleanUrl(String(given.url));
      return out;
    },
  };
}
const BOOK_MERGE = storeMerge("store links", () => ({ ...newBookLink() }) as Rec);
const APPS_MERGE = storeMerge("store links", () => ({ ...newAppLink() }) as Rec);

const ITEMS_MERGE: ItemMerge = {
  key: "items",
  label: "items",
  makeNew: () => ({ ...newListItem() }) as Rec,
  merge(item, given, _path, images) {
    const out = { ...item };
    if (given.name !== undefined) out.name = cleanLine(String(given.name));
    if (given.price !== undefined) out.price = cleanLine(String(given.price));
    if (given.description !== undefined) out.description = cleanLine(String(given.description));
    if (given.sold !== undefined) out.sold = given.sold === true;
    if (given.url !== undefined) {
      const url = given.url === null ? "" : cleanUrl(String(given.url));
      if (url === "") delete out.url;
      else out.url = url;
    }
    if (given.image !== undefined) {
      if (given.image === null) delete out.image;
      else out.image = refOf(images, given.image as ImageInput, false);
    }
    return out;
  },
};

/** The page a `page_link` points at as it is stored: "home", or a lower-case page id. */
export function cleanPageTarget(value: string): string {
  const target = cleanLine(value).trim();
  return target.toLowerCase() === HOME_TARGET ? HOME_TARGET : target.toLowerCase();
}

/** A day of an hours block from the fields of a call, laid over the day it already has. */
function mergeDay(current: Rec, given: Rec, path: string): Rec {
  const ranges = given.ranges as Rec[] | undefined;
  if (given.closed === undefined && ranges === undefined) {
    fail(path, 'Give closed: true, or ranges such as [{ open: "09:00", close: "17:00" }].');
  }
  if (given.closed === true && ranges && ranges.length > 0) {
    fail(path, "A closed day takes no ranges. Send closed: true alone, or ranges alone.");
  }
  if (given.closed === undefined && ranges && ranges.length === 0) {
    fail(path, "Add opening times, or set closed to true.");
  }
  const closed = given.closed === true;
  const next: Rec = { ...current };
  next.closed = given.closed === undefined ? false : closed;
  if (closed) next.ranges = [];
  else if (ranges) {
    next.ranges = ranges.map((range) => ({
      open: cleanLine(String(range.open)),
      close: cleanLine(String(range.close)),
    }));
  }
  return next;
}

export interface PatchResult {
  block: Block;
  /** A text block lost its formatting because its text changed. */
  formattingCleared: boolean;
}

/**
 * `fields` applied to `current`: a scalar that is given replaces, one that is not stays, `null`
 * clears an optional field, a list replaces the list (see `mergeItems`), `overrides` merge key by
 * key. The block's `id` and `type` never change. Nothing is validated here except what is needed to
 * apply the field; `validateBlock` runs the document's rules on the result.
 */
export function patchBlock(
  current: Block,
  fields: ParsedFields,
  images: ResolvedImages,
  visible?: boolean,
): PatchResult {
  const block = structuredClone(current) as unknown as Rec;
  const type = block.type as BlockType;
  let formattingCleared = false;
  const line = (key: string) => {
    if (fields[key] !== undefined) block[key] = cleanLine(String(fields[key]));
  };
  const url = (key: string, nullTo?: string) => {
    if (fields[key] === undefined) return;
    block[key] = fields[key] === null ? (nullTo ?? "") : cleanUrl(String(fields[key]));
  };
  const image = (key: string, keepFocus: boolean) => {
    if (fields[key] === undefined) return;
    block[key] = fields[key] === null ? null : refOf(images, fields[key] as ImageInput, keepFocus);
  };

  switch (type) {
    case "link": {
      line("label");
      url("url");
      if (fields.icon !== undefined) {
        if (fields.icon === null) delete block.icon;
        else if (typeof fields.icon === "string") {
          block.icon = { type: "builtin", name: fields.icon.trim() };
        } else {
          block.icon = {
            type: "image",
            image: refOf(images, (fields.icon as { imageId: string }).imageId, false),
          };
        }
      }
      if (fields.featured !== undefined) {
        if (fields.featured === null) delete block.featured;
        else block.featured = String(fields.featured).trim();
      }
      break;
    }
    case "card":
      line("title");
      line("caption");
      url("url");
      image("image", true);
      break;
    case "header":
      line("text");
      break;
    case "text":
      if (fields.text !== undefined) {
        const next = cleanMultiline(String(fields.text));
        if (next !== block.text) {
          if (Array.isArray(block.marks) && block.marks.length > 0) formattingCleared = true;
          delete block.marks;
        }
        block.text = next;
      }
      break;
    case "image":
      image("image", true);
      line("alt");
      url("url");
      if (fields.shape !== undefined) {
        if (fields.shape === null) delete block.shape;
        else block.shape = String(fields.shape).trim();
      }
      break;
    case "social":
      if (fields.icons !== undefined) {
        block.icons = mergeItems(block, fields.icons as Rec[], SOCIAL_MERGE);
      }
      break;
    case "embed":
      url("url");
      line("caption");
      break;
    case "grid":
      if (fields.cells !== undefined) {
        block.cells = mergeItems(block, fields.cells as Rec[], GRID_MERGE);
      }
      break;
    case "divider":
      break;
    case "faq":
      if (fields.items !== undefined) {
        block.items = mergeItems(block, fields.items as Rec[], FAQ_MERGE);
      }
      break;
    case "contact":
      line("name");
      line("phone");
      line("email");
      if (fields.hours !== undefined) block.hours = cleanMultiline(String(fields.hours));
      break;
    case "discount":
      line("code");
      line("description");
      url("url");
      break;
    case "book":
      line("title");
      line("author");
      image("cover", false);
      if (fields.links !== undefined) {
        block.links = mergeItems(block, fields.links as Rec[], BOOK_MERGE);
      }
      break;
    case "apps":
      if (fields.links !== undefined) {
        block.links = mergeItems(block, fields.links as Rec[], APPS_MERGE);
      }
      break;
    case "map":
      line("name");
      line("address");
      break;
    case "page_link":
      line("label");
      if (fields.target !== undefined) block.target = cleanPageTarget(String(fields.target));
      break;
    case "items":
      if (fields.heading !== undefined) {
        if (fields.heading === null) delete block.heading;
        else block.heading = cleanLine(String(fields.heading));
      }
      if (fields.layout !== undefined) {
        const layout = String(fields.layout).trim();
        if (layout !== "list" && layout !== "grid") fail("fields.layout", "Choose list or grid.");
        block.layout = layout;
      }
      if (fields.items !== undefined) {
        block.items = mergeItems(block, fields.items as Rec[], ITEMS_MERGE, images);
      }
      break;
    case "hours": {
      if (fields.timezone !== undefined) {
        const zone = String(fields.timezone).trim();
        if (!isHoursTimezone(zone)) {
          fail("fields.timezone", `Choose a time zone from: ${HOURS_TIMEZONE_LIST}.`);
        }
        block.timezone = zone;
      }
      if (fields.days !== undefined) {
        const days = { ...asRec(block.days) };
        for (const key of DAY_KEYS) {
          const given = (fields.days as Rec)[key];
          if (given !== undefined)
            days[key] = mergeDay(asRec(days[key]), given as Rec, `fields.days.${key}`);
        }
        block.days = days;
      }
      if (fields.note !== undefined) {
        if (fields.note === null) delete block.note;
        else block.note = cleanLine(String(fields.note));
      }
      break;
    }
  }

  if (fields.overrides !== undefined) {
    const merged = mergeOverrides(block.overrides, fields.overrides as Rec);
    if (merged) block.overrides = merged;
    else delete block.overrides;
  }
  if (visible !== undefined) block.visible = visible;
  return { block: block as unknown as Block, formattingCleared };
}

/** A new block of `type`: the defaults of the editor's chip, with `fields` applied and a fresh id. */
export function buildBlock(
  type: BlockType,
  fields: ParsedFields,
  images: ResolvedImages,
  visible: boolean,
): Block {
  const base = blockDefaults[type]() as unknown as Rec;
  // The editor's chips start with sample items and Monday to Friday hours; a block built from a
  // call holds only what the call says, so sample text never reaches a page by accident.
  if (type === "items") base.items = [];
  if (type === "hours") {
    base.days = Object.fromEntries(DAY_KEYS.map((key) => [key, { closed: true, ranges: [] }]));
  }
  return patchBlock(base as unknown as Block, fields, images, visible).block;
}

/** The path of a zod issue as `fields.items[1].answer`, with the block's own keys under `fields`. */
function issuePath(path: readonly PropertyKey[]): string {
  let out = "fields";
  for (const part of path) out += typeof part === "number" ? `[${part}]` : `.${String(part)}`;
  return out;
}

export interface ValidatedBlock {
  block: Block;
}

/**
 * The document's own rules on one block. A visible block must pass the Publish block schema, so the
 * AI learns about a problem now and not when the person presses Publish; a hidden block only has to
 * be well formed (it is dropped at Publish). `only` limits the report to the fields a call touched,
 * so changing a label is not refused for a different field that was already incomplete. The result
 * is the schema's canonical form (trimmed, defaults filled).
 */
export function validateBlock(
  block: Block,
  options: { visible: boolean; only?: readonly string[] | null },
): ValidatedBlock {
  const visible = options.visible;
  const schema = visible ? publishBlockSchema : blockSchema;
  const parsed = schema.safeParse(block);
  if (parsed.success) return { block: parsed.data as Block };
  const issues: ToolIssue[] = [];
  for (const issue of parsed.error.issues) {
    const head = String(issue.path[0] ?? "");
    if (options.only && !options.only.includes(head) && issue.path.length > 0) continue;
    const field = issue.path.map(String).join(".");
    const friendly = friendlyPublishError({
      blockId: String((block as unknown as Rec).id),
      field,
      message: issue.message,
    });
    issues.push({ path: issuePath(issue.path), message: friendly.message.slice(0, 200) });
  }
  if (issues.length === 0) {
    // The block was already incomplete before the call and the call did not touch what is wrong:
    // the canonical form of a lenient parse is what is stored.
    const lenient = blockSchema.safeParse(block);
    if (lenient.success) return { block: lenient.data as Block };
  }
  const bounded = issues.slice(0, 10);
  throw new ToolFailure("invalid_input", bounded[0]?.message ?? "That block isn’t valid.", {
    issues: bounded,
  });
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

export interface ProfileChange {
  name?: string;
  bio?: string;
  photo?: ImageRef | null;
  photoShape?: string;
  photoSize?: string;
  photoBorder?: string;
  showPhoto?: boolean;
  showName?: boolean;
  showBio?: boolean;
}

export const PROFILE_LIST_HINT = {
  photoShape: PHOTO_SHAPES.join(", "),
  photoSize: PHOTO_SIZES.join(", "),
  photoBorder: PHOTO_BORDERS.join(", "),
} as const;

/** The profile with the given fields applied through the document's own option helper. */
export function patchProfile(
  profile: DraftDoc["profile"],
  change: ProfileChange,
): DraftDoc["profile"] {
  let next: DraftDoc["profile"] = { ...profile };
  if (change.name !== undefined) next = { ...next, name: cleanLine(change.name) };
  if (change.bio !== undefined) next = { ...next, bio: cleanLine(change.bio) };
  if (change.photo !== undefined) next = { ...next, photo: change.photo };
  for (const key of [
    "photoShape",
    "photoSize",
    "photoBorder",
    "showPhoto",
    "showName",
    "showBio",
  ] as const) {
    if (change[key] !== undefined) next = applyProfileOption(next, { key, value: change[key] });
  }
  return next;
}
