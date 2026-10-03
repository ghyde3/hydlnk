import type { PublishError } from "@/lib/document";
import { COLOR_TOKEN_KEYS, FONT_TOKEN_KEYS, tokenLabel } from "@/lib/theme/labels";

/**
 * Publish error copy for theme and override problems (M3-05, M3-18). `collectPublishErrors` names
 * the failing field with the schema's own wording ("Must be a #RRGGBB hex color", "Too small:
 * expected number to be >=0"); this rewrites the ones about design values into what the person
 * can act on: which field, and how to fix it. Everything else passes through unchanged.
 *
 *   theme.overrides.bg        "Publish stopped: Page background isn’t a valid color. Reset it in Design."
 *   theme.overrides.fontBody  "Publish stopped: Body font isn’t an available font. Reset it in Design."
 *   overrides.radius (block)  "Corner radius isn’t valid. Use 0 to 32, or reset it to the theme default."
 *
 * A design field is named the way the Design screen names it (M6-47): `tokenLabel` is the one map
 * both use, so a person never reads a setting key such as `bg` or `fontBody`.
 */

/** Prefix of every design-level Publish failure. */
export const PUBLISH_STOPPED = "Publish stopped:";

/**
 * The words for a design field in a sentence. A key that is not a design setting (a stored document
 * is tenant data) gets a generic name, never the raw key.
 */
const nameOf = (key: string): string => tokenLabel(key) ?? "A design setting";

function themeFieldMessage(key: string): string {
  const name = nameOf(key);
  if (COLOR_TOKEN_KEYS.has(key)) {
    return `${PUBLISH_STOPPED} ${name} isn’t a valid color. Reset it in Design.`;
  }
  if (FONT_TOKEN_KEYS.has(key)) {
    return `${PUBLISH_STOPPED} ${name} isn’t an available font. Reset it in Design.`;
  }
  if (key === "bgImage") {
    return `${PUBLISH_STOPPED} ${name} isn’t one of your uploaded images. Pick the background image again in Design.`;
  }
  return `${PUBLISH_STOPPED} ${name} isn’t valid. Reset it in Design.`;
}

/** The message for a block-level override field (`overrides.radius`, `overrides.accent`...). */
function blockFieldMessage(key: string): string {
  if (key === "radius")
    return "Corner radius isn’t valid. Use 0 to 32, or reset it to the theme default.";
  if (key === "borderWidth") {
    return "Border thickness isn’t valid. Use 0 to 4, or reset it to the theme default.";
  }
  if (key === "buttonStyle") {
    return "Button style isn’t valid. Pick one from the list, or reset it to the theme default.";
  }
  if (COLOR_TOKEN_KEYS.has(key)) {
    return "Color isn’t a valid hex color. Use #RRGGBB, or reset it to the theme default.";
  }
  return `${nameOf(key)} isn’t valid. Reset it to the theme default.`;
}

function unrecognizedKeys(message: string): string {
  const keys = [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
  return keys.length > 0 ? keys.join(", ") : "an unknown setting";
}

/** One publish error, with design problems worded for the person fixing them. */
export function friendlyPublishError(error: PublishError): PublishError {
  const { field } = error;

  if (error.blockId === null) {
    if (field.startsWith("theme.overrides.")) {
      const key = field.slice("theme.overrides.".length).split(".")[0]!;
      return { ...error, message: themeFieldMessage(key) };
    }
    if (field === "theme.overrides") {
      return {
        ...error,
        message: `${PUBLISH_STOPPED} ${unrecognizedKeys(error.message)} isn’t a design setting. Reset your page’s design settings in Design.`,
      };
    }
    if (field === "theme.ref") {
      return {
        ...error,
        message: `${PUBLISH_STOPPED} the theme reference isn’t valid. Pick a theme in Design.`,
      };
    }
    if (field === "theme") {
      return {
        ...error,
        message: `${PUBLISH_STOPPED} the theme settings aren’t valid. Pick a theme in Design.`,
      };
    }
    return error;
  }

  if (field.startsWith("overrides.")) {
    const key = field.slice("overrides.".length).split(".")[0]!;
    return { ...error, message: blockFieldMessage(key) };
  }
  if (field === "overrides") {
    return {
      ...error,
      message: "This block’s own style isn’t valid. Reset it to the theme default.",
    };
  }
  return error;
}

export function friendlyPublishErrors(errors: PublishError[]): PublishError[] {
  return errors.map(friendlyPublishError);
}
