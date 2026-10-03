import {
  BLOCK_OVERRIDE_KEYS,
  resolveTokens,
  type BlockOverrides,
  type TokenSet,
} from "@/lib/theme";
import { resolveProfileOptions } from "./profile-options";
import {
  publishDocSchema,
  type Block,
  type DraftDoc,
  type ImageRef,
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
  return {
    version: 1,
    profile: {
      name: draft.profile.name.trim(),
      bio: draft.profile.bio.trim(),
      photo: imageRef(draft.profile.photo),
      // Always written, every one filled (M6-15, M6-17), so the form deep-equals a stored
      // document that the strict schema has parsed (which fills the same defaults).
      ...resolveProfileOptions(draft.profile),
    },
    theme: { ref: draft.theme.ref, overrides: { ...draft.theme.overrides } },
    tokens: resolveTokens(themeTokens, draft.theme.overrides),
    blocks,
  };
}

function imageRef(ref: ImageRef | null): ImageRef | null {
  return ref ? { path: ref.path, width: ref.width, height: ref.height } : null;
}

function cleanOverrides(overrides: BlockOverrides | undefined): { overrides?: BlockOverrides } {
  if (!overrides) return {};
  const kept: Record<string, unknown> = {};
  for (const key of BLOCK_OVERRIDE_KEYS) {
    if (overrides[key] !== undefined) kept[key] = overrides[key];
  }
  return Object.keys(kept).length > 0 ? { overrides: kept as BlockOverrides } : {};
}

function publishIcon(icon: SocialIcon): SocialIcon {
  return icon.platform === "email"
    ? { id: icon.id, platform: "email", address: icon.address.trim() }
    : { id: icon.id, platform: icon.platform, url: icon.url.trim() };
}

function publishBlock(block: Block): Block | null {
  const base = { id: block.id, visible: true } as const;
  switch (block.type) {
    case "link":
      return {
        ...base,
        type: "link",
        label: block.label.trim(),
        url: block.url.trim(),
        ...cleanOverrides(block.overrides),
      };
    case "card":
      return {
        ...base,
        type: "card",
        title: block.title.trim(),
        caption: block.caption.trim(),
        url: block.url.trim(),
        image: imageRef(block.image),
        ...cleanOverrides(block.overrides),
      };
    case "header":
      return { ...base, type: "header", text: block.text.trim() };
    case "text":
      return { ...base, type: "text", text: block.text.trim() };
    case "image": {
      const link = block.url?.trim() ?? "";
      return {
        ...base,
        type: "image",
        image: imageRef(block.image),
        alt: block.alt.trim(),
        ...(link === "" ? {} : { url: link }),
      };
    }
    case "social":
      return { ...base, type: "social", icons: block.icons.map(publishIcon) };
    case "embed":
      return { ...base, type: "embed", url: block.url.trim(), caption: block.caption.trim() };
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
      };
    case "divider":
      return { ...base, type: "divider" };
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

/** Every image reference in a document: the profile photo, card images and image blocks. */
export function collectImageRefs(doc: {
  profile: { photo: ImageRef | null };
  blocks: readonly Block[];
}): ImageRef[] {
  const refs: ImageRef[] = [];
  if (doc.profile.photo) refs.push(doc.profile.photo);
  for (const block of doc.blocks) {
    if ((block.type === "card" || block.type === "image") && block.image) refs.push(block.image);
  }
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
  const rawBlocks = asRecord(draft)?.blocks;
  const errors: PublishError[] = [];
  const seen = new Set<string>();

  for (const issue of result.error.issues) {
    const path = issue.path;
    let error: PublishError;
    if (path[0] === "blocks" && typeof path[1] === "number") {
      const rawBlock = Array.isArray(rawBlocks) ? asRecord(rawBlocks[path[1]]) : undefined;
      const blockId = typeof rawBlock?.id === "string" ? rawBlock.id : null;
      const rest = path.slice(2);
      const list = rest[0] === "icons" || rest[0] === "cells" ? rawBlock?.[rest[0]] : undefined;
      if (Array.isArray(list) && typeof rest[1] === "number") {
        const rawItem = asRecord(list[rest[1]]);
        const itemId = typeof rawItem?.id === "string" ? rawItem.id : undefined;
        error = {
          blockId,
          ...(itemId ? { itemId } : {}),
          field: rest.slice(2).join(".") || String(rest[0]),
          message: issue.message,
        };
      } else {
        error = { blockId, field: rest.join(".") || "type", message: issue.message };
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
