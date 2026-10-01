import { describe, expect, it } from "vitest";
import {
  SYSTEM_DEFAULT_TOKENS,
  resolveBlockTokens,
  resolveTokens,
  tokenSetSchema,
  type BlockOverrides,
  type TokenSet,
} from "@/lib/theme";
import { noirTokens } from "./fixtures/page-document";

describe("resolveTokens", () => {
  it("returns the system default when given nothing", () => {
    expect(resolveTokens()).toEqual(SYSTEM_DEFAULT_TOKENS);
    expect(resolveTokens(null, undefined)).toEqual(SYSTEM_DEFAULT_TOKENS);
    expect(resolveTokens(null, {})).toEqual(SYSTEM_DEFAULT_TOKENS);
  });

  it("theme beats system default", () => {
    const resolved = resolveTokens(noirTokens);
    expect(resolved).toEqual(noirTokens);
    expect(resolved.bg).not.toBe(SYSTEM_DEFAULT_TOKENS.bg);
  });

  it("page overrides beat the theme, key by key", () => {
    const resolved = resolveTokens(noirTokens, { accent: "#FF0000", radius: 4 });
    expect(resolved.accent).toBe("#FF0000");
    expect(resolved.radius).toBe(4);
    expect(resolved.bg).toBe(noirTokens.bg);
    expect(resolved.fontHeading).toBe(noirTokens.fontHeading);
  });

  it("page overrides apply over the system default when there is no theme", () => {
    const resolved = resolveTokens(null, { fontHeading: "Fraunces" });
    expect(resolved.fontHeading).toBe("Fraunces");
    expect(resolved.fontBody).toBe(SYSTEM_DEFAULT_TOKENS.fontBody);
  });

  it("applies system -> theme -> page -> block, later layers winning", () => {
    const pageResolved = resolveTokens(noirTokens, { accent: "#00AA00", buttonStyle: "pill" });
    const blockResolved = resolveBlockTokens(pageResolved, { accent: "#0000FF", radius: 0 });

    expect(blockResolved.accent).toBe("#0000FF"); // block
    expect(blockResolved.radius).toBe(0); // block
    expect(blockResolved.buttonStyle).toBe("pill"); // page
    expect(blockResolved.bg).toBe(noirTokens.bg); // theme
    expect(blockResolved.maxWidth).toBe(noirTokens.maxWidth); // theme, same as system here
    expect(pageResolved.accent).toBe("#00AA00"); // block layer did not leak back
  });

  it("null is a real value: a page can clear a theme's background image", () => {
    const themed: TokenSet = {
      ...noirTokens,
      bgType: "image",
      bgImage: "https://x.example/bg.webp",
    };
    expect(resolveTokens(themed, { bgImage: null }).bgImage).toBeNull();
  });

  it("undefined in a layer does not wipe the layer below", () => {
    const resolved = resolveTokens(noirTokens, { accent: undefined, radius: undefined });
    expect(resolved.accent).toBe(noirTokens.accent);
    expect(resolved.radius).toBe(noirTokens.radius);
  });

  it("ignores unknown keys at runtime", () => {
    const sneaky = { accent: "#123456", customCss: "body{display:none}" } as never;
    const resolved = resolveTokens(null, sneaky);
    expect(resolved.accent).toBe("#123456");
    expect(resolved).not.toHaveProperty("customCss");
  });

  it("completes an incomplete theme row from the system default", () => {
    const partialTheme = { bg: "#000000", accent: "#C9A86A" };
    const resolved = resolveTokens(partialTheme);
    expect(resolved.bg).toBe("#000000");
    expect(tokenSetSchema.safeParse(resolved).success).toBe(true);
  });

  it("always returns a complete, valid TokenSet", () => {
    expect(tokenSetSchema.safeParse(resolveTokens(noirTokens, { blur: 6 })).success).toBe(true);
  });

  it("never mutates its inputs or hands back the shared default", () => {
    const theme = structuredClone(noirTokens);
    const overrides = { accent: "#ABCDEF" } as const;
    const before = structuredClone({ theme, overrides });

    const resolved = resolveTokens(theme, overrides);
    resolved.accent = "#000000";

    expect({ theme, overrides }).toEqual(before);
    const fromDefault = resolveTokens();
    expect(fromDefault).not.toBe(SYSTEM_DEFAULT_TOKENS);
    fromDefault.accent = "#000000";
    expect(SYSTEM_DEFAULT_TOKENS.accent).not.toBe("#000000");
  });
});

describe("resolveBlockTokens", () => {
  const page = resolveTokens(noirTokens);

  it("returns the page tokens unchanged when there are no overrides", () => {
    expect(resolveBlockTokens(page)).toEqual(page);
    expect(resolveBlockTokens(page, {})).toEqual(page);
  });

  it("applies every allowed key", () => {
    const overrides: BlockOverrides = {
      accent: "#111111",
      buttonBg: "#222222",
      buttonText: "#333333",
      text: "#444444",
      surface: "#555555",
      border: "#666666",
      buttonStyle: "shadow",
      radius: 20,
    };
    expect(resolveBlockTokens(page, overrides)).toEqual({ ...page, ...overrides });
  });

  it("has no effect for a fontHeading (or any other disallowed key) passed at runtime", () => {
    const sneaky = {
      fontHeading: "Fraunces",
      fontBody: "Lora",
      bg: "#FFFFFF",
      maxWidth: 720,
      density: "airy",
      customCss: "x",
      accent: "#ABCDEF", // the one legitimate key still applies
    } as unknown as BlockOverrides;

    const resolved = resolveBlockTokens(page, sneaky);

    expect(resolved).toEqual({ ...page, accent: "#ABCDEF" });
    expect(resolved).not.toHaveProperty("customCss");
  });

  it("ignores undefined values and does not mutate the page tokens", () => {
    const before = structuredClone(page);
    const resolved = resolveBlockTokens(page, { accent: undefined, radius: 2 });
    expect(resolved.accent).toBe(page.accent);
    expect(resolved.radius).toBe(2);
    expect(page).toEqual(before);
    expect(resolved).not.toBe(page);
  });
});
