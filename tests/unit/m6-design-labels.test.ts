import { describe, expect, it } from "vitest";
import { collectPublishErrors, type DraftDoc } from "@/lib/document";
import {
  COLOR_TOKEN_KEYS,
  FONT_TOKEN_KEYS,
  TOKEN_KEYS,
  TOKEN_LABELS,
  tokenLabel,
  tokenSetSchema,
} from "@/lib/theme";
import { friendlyPublishError, friendlyPublishErrors } from "@/lib/themes/publish-errors";
import { fullDraft } from "./fixtures/page-document";

/**
 * M6-47: one label map names every design setting in plain words, for the Design screen and for
 * the Publish messages. No label may look like a token key.
 */

describe("M6-47 the label map", () => {
  it("has a plain label for every token key, and for nothing else", () => {
    expect(Object.keys(TOKEN_LABELS).sort()).toEqual([...TOKEN_KEYS].sort());
    for (const key of TOKEN_KEYS) {
      expect(typeof TOKEN_LABELS[key], key).toBe("string");
      expect(TOKEN_LABELS[key].trim().length, key).toBeGreaterThan(0);
    }
  });

  it("no label contains a camelCase key, a raw key as a word, or developer words", () => {
    for (const key of TOKEN_KEYS) {
      const label = TOKEN_LABELS[key];
      // camelCase: a lowercase letter followed by an uppercase one.
      expect(label, `${key} camelCase`).not.toMatch(/[a-z][A-Z]/);
      expect(label, `${key} token key`).not.toMatch(
        /\b(bg|textMuted|buttonBg|buttonText|borderWidth|weightHeading|letterCase|maxWidth|overlayOpacity|bgType|bgImage|fontHeading|fontBody|gradientAngle|gradientFrom|gradientTo)\b/,
      );
      expect(label, `${key} jargon`).not.toMatch(/token|override|css|hex/i);
      // Plain words: letters and spaces only, first letter capital, the rest sentence case.
      expect(label, `${key} shape`).toMatch(/^[A-Z][a-z]+(?: [a-z]+)*$/);
    }
  });

  it("labels are unique, so two settings are never confused", () => {
    const labels = TOKEN_KEYS.map((key) => TOKEN_LABELS[key]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("the eight color rows read as the Design screen names them", () => {
    expect(
      ["bg", "surface", "text", "textMuted", "accent", "buttonBg", "buttonText", "border"].map(
        (key) => TOKEN_LABELS[key as keyof typeof TOKEN_LABELS],
      ),
    ).toEqual([
      "Page background",
      "Cards and panels",
      "Text",
      "Secondary text",
      "Accent",
      "Button color",
      "Button text",
      "Lines and borders",
    ]);
  });

  it("the old control names are the new labels", () => {
    expect(TOKEN_LABELS.borderWidth).toBe("Border thickness");
    expect(TOKEN_LABELS.density).toBe("Space between blocks");
    expect(TOKEN_LABELS.maxWidth).toBe("Page width");
    expect(TOKEN_LABELS.align).toBe("Text alignment");
    expect(TOKEN_LABELS.weightHeading).toBe("Heading boldness");
    expect(TOKEN_LABELS.letterCase).toBe("Capital letters");
    expect(TOKEN_LABELS.overlayOpacity).toBe("Image overlay");
    expect(TOKEN_LABELS.blur).toBe("Image blur");
  });

  it("tokenLabel returns the label for a key and null for anything else", () => {
    expect(tokenLabel("bg")).toBe("Page background");
    expect(tokenLabel("customCss")).toBeNull();
    expect(tokenLabel("__proto__")).toBeNull();
    expect(tokenLabel("constructor")).toBeNull();
    expect(tokenLabel("")).toBeNull();
  });

  it("the color and font key sets match the schema", () => {
    const colorSchemaKeys = TOKEN_KEYS.filter((key) => {
      const probe = tokenSetSchema.shape[key];
      return probe.safeParse("#FFFFFF").success;
    });
    expect([...COLOR_TOKEN_KEYS].sort()).toEqual([...colorSchemaKeys].sort());
    expect([...FONT_TOKEN_KEYS].sort()).toEqual(["fontBody", "fontHeading"]);
  });
});

describe("M6-47 Publish messages use the same names", () => {
  const themeError = (key: string, message = "Must be a #RRGGBB hex color") =>
    friendlyPublishError({ blockId: null, field: `theme.overrides.${key}`, message }).message;

  it("name a color, a font and the other settings the way the Design screen does", () => {
    expect(themeError("bg")).toBe(
      "Publish stopped: Page background isn’t a valid color. Reset it in Design.",
    );
    expect(themeError("fontHeading")).toBe(
      "Publish stopped: Heading font isn’t an available font. Reset it in Design.",
    );
    expect(themeError("fontBody")).toBe(
      "Publish stopped: Body font isn’t an available font. Reset it in Design.",
    );
    expect(themeError("radius")).toBe(
      "Publish stopped: Corner radius isn’t valid. Reset it in Design.",
    );
    expect(themeError("bgImage")).toContain("Background image isn’t one of your uploaded images");
  });

  it("every token key produces a message that has its label and no raw key", () => {
    for (const key of TOKEN_KEYS) {
      const message = themeError(key);
      expect(message, key).toContain(TOKEN_LABELS[key]);
      expect(message, key).not.toMatch(/[a-z][A-Z]/);
      expect(message, key).toMatch(/^Publish stopped: /);
    }
  });

  it("an unknown key never becomes a label, and the page overrides are not called overrides", () => {
    expect(themeError("customCss")).toBe(
      "Publish stopped: A design setting isn’t valid. Reset it in Design.",
    );
    const message = friendlyPublishError({
      blockId: null,
      field: "theme.overrides",
      message: 'Unrecognized key: "customCss"',
    }).message;
    expect(message).not.toMatch(/override/i);
    expect(message).toContain("customCss");
  });

  it("a real invalid draft is reported with plain names", () => {
    const draft = {
      ...structuredClone(fullDraft),
      theme: { ref: null, overrides: { bg: "red;}", fontHeading: "Evil;}", scale: 9 } },
    } as unknown as DraftDoc;
    const messages = friendlyPublishErrors(collectPublishErrors(draft)).map(
      (error) => error.message,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        "Publish stopped: Page background isn’t a valid color. Reset it in Design.",
        "Publish stopped: Heading font isn’t an available font. Reset it in Design.",
        "Publish stopped: Text size isn’t valid. Reset it in Design.",
      ]),
    );
  });
});
