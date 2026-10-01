import { describe, expect, it } from "vitest";
import {
  BLOCK_OVERRIDE_KEYS,
  FONT_ALLOWLIST,
  FONT_GENERIC,
  SYSTEM_DEFAULT_TOKENS,
  TOKEN_KEYS,
  blockOverridesSchema,
  tokenOverridesSchema,
  tokenSetSchema,
} from "@/lib/theme";
import { noirTokens } from "./fixtures/page-document";

describe("FONT_ALLOWLIST", () => {
  it("has 12-20 unique families including the required ones", () => {
    expect(FONT_ALLOWLIST.length).toBeGreaterThanOrEqual(12);
    expect(FONT_ALLOWLIST.length).toBeLessThanOrEqual(20);
    expect(new Set(FONT_ALLOWLIST).size).toBe(FONT_ALLOWLIST.length);
    for (const family of [
      "Instrument Serif",
      "Fraunces",
      "Inter",
      "DM Sans",
      "Space Grotesk",
      "Playfair Display",
      "Manrope",
      "Geist",
    ]) {
      expect(FONT_ALLOWLIST).toContain(family);
    }
  });

  it("has a generic fallback for every family", () => {
    for (const family of FONT_ALLOWLIST) {
      expect(["sans-serif", "serif", "monospace"]).toContain(FONT_GENERIC[family]);
    }
  });
});

describe("tokenSetSchema", () => {
  it("accepts the system default and a complete theme", () => {
    expect(tokenSetSchema.safeParse(SYSTEM_DEFAULT_TOKENS).success).toBe(true);
    expect(tokenSetSchema.safeParse(noirTokens).success).toBe(true);
  });

  it("requires every key and rejects unknown ones", () => {
    const missingAccent: Record<string, unknown> = { ...noirTokens };
    delete missingAccent.accent;
    expect(tokenSetSchema.safeParse(missingAccent).success).toBe(false);
    expect(tokenSetSchema.safeParse({ ...noirTokens, customCss: "body{}" }).success).toBe(false);
  });

  it("covers exactly the 23 contract keys", () => {
    expect([...TOKEN_KEYS].sort()).toEqual(
      [
        "bg",
        "surface",
        "text",
        "textMuted",
        "accent",
        "buttonBg",
        "buttonText",
        "border",
        "fontHeading",
        "fontBody",
        "scale",
        "weightHeading",
        "letterCase",
        "radius",
        "borderWidth",
        "buttonStyle",
        "density",
        "maxWidth",
        "align",
        "bgType",
        "bgImage",
        "overlayOpacity",
        "blur",
      ].sort(),
    );
  });

  it.each([
    ["short hex", { accent: "#FFF" }],
    ["named color", { accent: "red" }],
    ["color with alpha", { accent: "#C9A86AFF" }],
    ["font outside the allowlist", { fontHeading: "Comic Sans MS" }],
    ["scale too small", { scale: 0.8 }],
    ["scale too large", { scale: 1.3 }],
    ["weight not offered", { weightHeading: 300 }],
    ["radius over 32", { radius: 33 }],
    ["negative border width", { borderWidth: -1 }],
    ["border width over 4", { borderWidth: 5 }],
    ["max width under 360", { maxWidth: 359 }],
    ["max width over 720", { maxWidth: 721 }],
    ["overlay over 1", { overlayOpacity: 1.1 }],
    ["blur over 20", { blur: 21 }],
    ["unknown button style", { buttonStyle: "neon" }],
    ["unknown density", { density: "huge" }],
    ["javascript: background image", { bgImage: "javascript:alert(1)" }],
  ])("rejects %s", (_name, patch) => {
    expect(tokenSetSchema.safeParse({ ...noirTokens, ...patch }).success).toBe(false);
  });

  it("accepts the range edges and an https background image", () => {
    const edges = {
      ...noirTokens,
      scale: 0.875,
      radius: 32,
      borderWidth: 4,
      maxWidth: 720,
      overlayOpacity: 1,
      blur: 20,
      weightHeading: 800,
      bgType: "image",
      bgImage: "https://images.example.com/bg.webp",
    };
    expect(tokenSetSchema.safeParse(edges).success).toBe(true);
  });
});

describe("tokenOverridesSchema", () => {
  it("accepts any subset, including none", () => {
    expect(tokenOverridesSchema.safeParse({}).success).toBe(true);
    expect(tokenOverridesSchema.safeParse({ fontHeading: "Fraunces", blur: 8 }).success).toBe(true);
  });

  it("still validates values and rejects unknown keys", () => {
    expect(tokenOverridesSchema.safeParse({ radius: 99 }).success).toBe(false);
    expect(tokenOverridesSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe("blockOverridesSchema", () => {
  it("allows exactly the eight block-level keys", () => {
    expect([...BLOCK_OVERRIDE_KEYS].sort()).toEqual([
      "accent",
      "border",
      "buttonBg",
      "buttonStyle",
      "buttonText",
      "radius",
      "surface",
      "text",
    ]);
    const everyKey = {
      accent: "#111111",
      buttonBg: "#222222",
      buttonText: "#333333",
      text: "#444444",
      surface: "#555555",
      border: "#666666",
      buttonStyle: "soft",
      radius: 8,
    };
    expect(blockOverridesSchema.safeParse(everyKey).success).toBe(true);
    expect(blockOverridesSchema.safeParse({}).success).toBe(true);
  });

  it.each(["fontHeading", "fontBody", "bg", "maxWidth", "density", "scale"])(
    "rejects a block override for %s",
    (key) => {
      const value = key.startsWith("font") ? "Inter" : key === "bg" ? "#000000" : 1;
      expect(blockOverridesSchema.safeParse({ [key]: value }).success).toBe(false);
    },
  );

  it("still validates the values of allowed keys", () => {
    expect(blockOverridesSchema.safeParse({ radius: 40 }).success).toBe(false);
    expect(blockOverridesSchema.safeParse({ accent: "teal" }).success).toBe(false);
  });
});
