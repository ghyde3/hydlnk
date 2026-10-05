import { z } from "zod";
import {
  APP_STORES,
  BLOCK_TYPES,
  BOOK_STORES,
  LIMITS,
  SOCIAL_PLATFORMS,
  appStoresLimitMessage,
  bookStoresLimitMessage,
  type BlockType,
} from "@/lib/document";
import { IMAGE_SHAPES } from "@/lib/document/focus";
import { LINK_FEATURED, LINK_ICONS } from "@/lib/document/link-icons";
import { BLOCK_OVERRIDE_KEYS } from "@/lib/theme";
import type { ToolIssue } from "./errors";

/**
 * The fields the write tools take for each block type (M10-26, M10-27). These are the AI's names for
 * a block's content; the document's own schemas decide what is valid. A field not listed here is
 * refused by name, and the refusal lists the ones that are allowed. Fields that a tool cannot set
 * (ids, a link's lock and UTM tags, a text block's formatting) are named in `UNSETTABLE`.
 */

/** Keys that exist in a stored block but cannot be set from a tool, and why. */
export const UNSETTABLE: Readonly<Record<string, string>> = {
  id: "Ids are made by HYDLNK. Leave id out.",
  type: "A block’s type can’t change. Add a new block with add_block instead.",
  visible: "visible is its own argument, outside fields.",
  lock: "A link’s lock can only be set in the app.",
  utm: "A link’s UTM tags can only be set in the app.",
  marks: "Text formatting can only be set in the app.",
};

const TYPE_NAMES: Record<BlockType, string> = {
  link: "link",
  card: "card",
  header: "header",
  text: "text",
  image: "image",
  social: "social",
  embed: "embed",
  grid: "grid",
  divider: "divider",
  faq: "FAQ",
  contact: "contact",
  discount: "discount",
  book: "book",
  apps: "app store",
  map: "map",
  // M11-07: sub-page support in MCP is M2. add_block excludes page_link and update_block takes no fields for it.
  page_link: "page link",
  // M12-05 adds items and hours to MCP; add_block excludes them until then.
  items: "items",
  hours: "hours",
};

export type FieldMode = "add" | "update";

const text = z.string();
/** An image the caller already has: its imageId from get_page, alone or in the object get_page returned. */
const imageInput = z.union([z.string(), z.object({ imageId: z.string() })]);

/** A block's own style. In an update, a `null` value removes that one setting. */
function overridesInput(mode: FieldMode) {
  const nullable = <T extends z.ZodType>(schema: T) =>
    mode === "update" ? schema.nullable() : schema;
  return z
    .strictObject({
      accent: nullable(z.string()),
      buttonBg: nullable(z.string()),
      buttonText: nullable(z.string()),
      text: nullable(z.string()),
      textMuted: nullable(z.string()),
      surface: nullable(z.string()),
      border: nullable(z.string()),
      buttonStyle: nullable(z.string()),
      radius: nullable(z.number()),
      borderWidth: nullable(z.number()),
    })
    .partial();
}

function itemId(mode: FieldMode): { id?: z.ZodOptional<z.ZodString> } {
  return mode === "update" ? { id: z.string().optional() } : {};
}

function fieldSchemas(mode: FieldMode): Record<BlockType, z.ZodType> {
  const up = mode === "update";
  const nullable = <T extends z.ZodType>(schema: T) => (up ? schema.nullable() : schema);
  const overrides = overridesInput(mode);

  const socialItem = z.strictObject({
    ...itemId(mode),
    platform: up ? text.optional() : text,
    url: text.optional(),
    address: text.optional(),
  });
  const gridCell = z.strictObject({
    ...itemId(mode),
    title: text.optional(),
    subtitle: text.optional(),
    url: text.optional(),
  });
  const faqItem = z.strictObject({
    ...itemId(mode),
    question: text.optional(),
    answer: text.optional(),
  });
  const storeLink = z.strictObject({
    ...itemId(mode),
    store: up ? text.optional() : text,
    url: text.optional(),
  });
  const iconsMessage = { error: `Use ${LIMITS.socialIconsMin} to ${LIMITS.socialIconsMax} icons.` };
  const cellsMessage = { error: `Use ${LIMITS.gridCellsMin} to ${LIMITS.gridCellsMax} cells.` };

  return {
    link: z
      .strictObject({
        label: text,
        url: text,
        icon: nullable(
          z.union([z.string(), z.strictObject({ type: z.literal("image"), imageId: z.string() })]),
        ),
        featured: nullable(text),
        overrides,
      })
      .partial(),
    card: z
      .strictObject({
        title: text,
        caption: text,
        url: text,
        image: nullable(imageInput),
        overrides,
      })
      .partial(),
    header: z.strictObject({ text, overrides }).partial(),
    text: z.strictObject({ text, overrides }).partial(),
    image: z
      .strictObject({
        image: nullable(imageInput),
        alt: text,
        url: nullable(text),
        shape: nullable(text),
        overrides,
      })
      .partial(),
    social: z
      .strictObject({
        icons: z
          .array(socialItem)
          .min(LIMITS.socialIconsMin, iconsMessage)
          .max(LIMITS.socialIconsMax, iconsMessage),
        overrides,
      })
      .partial(),
    embed: z.strictObject({ url: text, caption: text, overrides }).partial(),
    grid: z
      .strictObject({
        cells: z
          .array(gridCell)
          .min(LIMITS.gridCellsMin, cellsMessage)
          .max(LIMITS.gridCellsMax, cellsMessage),
        overrides,
      })
      .partial(),
    divider: z.strictObject({ overrides }).partial(),
    faq: z
      .strictObject({
        items: z
          .array(faqItem)
          .min(LIMITS.faqItemsMin, { error: "Add at least one question." })
          .max(LIMITS.faqItemsMax, { error: `Use up to ${LIMITS.faqItemsMax} questions.` }),
        overrides,
      })
      .partial(),
    contact: z
      .strictObject({ name: text, phone: text, email: text, hours: text, overrides })
      .partial(),
    discount: z
      .strictObject({ code: text, description: text, url: nullable(text), overrides })
      .partial(),
    book: z
      .strictObject({
        title: text,
        author: text,
        cover: nullable(imageInput),
        links: z
          .array(storeLink)
          .max(LIMITS.bookLinks, { error: bookStoresLimitMessage(LIMITS.bookLinks) }),
        overrides,
      })
      .partial(),
    apps: z
      .strictObject({
        links: z
          .array(storeLink)
          .max(LIMITS.appLinks, { error: appStoresLimitMessage(LIMITS.appLinks) }),
        overrides,
      })
      .partial(),
    map: z.strictObject({ name: text, address: text, overrides }).partial(),
    // M11-07: no fields through MCP until M2 (see TYPE_NAMES).
    page_link: z.strictObject({}),
    // M12-05: no fields through MCP yet.
    items: z.strictObject({}),
    hours: z.strictObject({}),
  };
}

const ADD_SCHEMAS = fieldSchemas("add");
const UPDATE_SCHEMAS = fieldSchemas("update");

/** The field names a block type takes, in the order the docs list them. */
export const BLOCK_FIELD_KEYS: Readonly<Record<BlockType, readonly string[]>> = {
  link: ["label", "url", "icon", "featured", "overrides"],
  card: ["title", "caption", "url", "image", "overrides"],
  header: ["text", "overrides"],
  text: ["text", "overrides"],
  image: ["image", "alt", "url", "shape", "overrides"],
  social: ["icons", "overrides"],
  embed: ["url", "caption", "overrides"],
  grid: ["cells", "overrides"],
  divider: ["overrides"],
  faq: ["items", "overrides"],
  contact: ["name", "phone", "email", "hours", "overrides"],
  discount: ["code", "description", "url", "overrides"],
  book: ["title", "author", "cover", "links", "overrides"],
  apps: ["links", "overrides"],
  map: ["name", "address", "overrides"],
  page_link: [],
  // M12-05: items and hours take no fields through MCP yet.
  items: [],
  hours: [],
};

export const BLOCK_OVERRIDE_NAMES: readonly string[] = BLOCK_OVERRIDE_KEYS;

export type ParsedFields = Record<string, unknown>;

export type ParseFieldsResult =
  { ok: true; fields: ParsedFields } | { ok: false; issues: ToolIssue[] };

function pathText(path: readonly PropertyKey[]): string {
  let out = "fields";
  for (const part of path) out += typeof part === "number" ? `[${part}]` : `.${String(part)}`;
  return out;
}

/** The names a nested list item (an icon, a cell, a question, a store link) takes. */
function nestedKeys(type: BlockType, path: readonly PropertyKey[]): string[] {
  switch (String(path[0])) {
    case "overrides":
      return [...BLOCK_OVERRIDE_NAMES];
    case "icons":
      return ["platform", "url", "address"];
    case "cells":
      return ["title", "subtitle", "url"];
    case "items":
      return ["question", "answer"];
    case "links":
      return ["store", "url"];
    case "icon":
      return type === "link" ? ["type", "imageId"] : [];
    default:
      return [];
  }
}

function shapeMessage(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? `${pathText(issue.path)}: ` : "";
  if (issue.code === "invalid_type") {
    if ((issue as { input?: unknown }).input === undefined) return `${where}This is required.`;
    return `${where}Wrong kind of value. Expected ${String((issue as { expected?: unknown }).expected)}.`;
  }
  if (issue.code === "too_big" || issue.code === "too_small") return issue.message;
  return `${where}${issue.message}`;
}

/**
 * `fields` of a block of `type`, checked by shape: only the type's own field names, each of the
 * right kind. The document's own schemas check the values afterwards.
 */
export function parseBlockFields(
  type: BlockType,
  fields: unknown,
  mode: FieldMode,
): ParseFieldsResult {
  const schema = (mode === "add" ? ADD_SCHEMAS : UPDATE_SCHEMAS)[type];
  const parsed = schema.safeParse(fields ?? {});
  if (parsed.success) return { ok: true, fields: parsed.data as ParsedFields };
  const issues: ToolIssue[] = [];
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const known = UNSETTABLE[key];
        const top = issue.path.length === 0;
        const allowed = top ? BLOCK_FIELD_KEYS[type] : nestedKeys(type, issue.path);
        issues.push({
          path: pathText([...issue.path, key]),
          message:
            known && (top || key === "id")
              ? known
              : `Unknown field “${key.slice(0, 40)}”${top ? "" : ` in ${pathText(issue.path)}`} for a ${TYPE_NAMES[type]} block.${allowed.length > 0 ? ` Allowed: ${allowed.join(", ")}.` : ""}`,
        });
      }
    } else {
      issues.push({ path: pathText(issue.path), message: shapeMessage(issue) });
    }
  }
  return { ok: false, issues };
}

/** Plain lists the AI is given in the tool descriptions and the input descriptions. */
export const SOCIAL_PLATFORM_LIST = SOCIAL_PLATFORMS.join(", ");
export const BOOK_STORE_LIST = BOOK_STORES.join(", ");
export const APP_STORE_LIST = APP_STORES.join(", ");
export const LINK_ICON_LIST = LINK_ICONS.join(", ");
export const LINK_FEATURED_LIST = LINK_FEATURED.join(", ");
export const IMAGE_SHAPE_LIST = IMAGE_SHAPES.join(", ");

export { BLOCK_TYPES };
