import { describe, expect, it } from "vitest";
import {
  FONT_ALLOWLIST,
  FONT_GENERIC,
  SYSTEM_DEFAULT_TOKENS,
  TOKEN_KEYS,
  tokenCssVarName,
  tokensToCssVars,
  type TokenSet,
} from "@/lib/theme";
import { noirTokens } from "./fixtures/page-document";

describe("tokensToCssVars", () => {
  const vars = tokensToCssVars(noirTokens);

  it("emits one variable per token, all with the --t- prefix and none with --hl-", () => {
    expect(Object.keys(vars)).toHaveLength(TOKEN_KEYS.length);
    for (const name of Object.keys(vars)) {
      expect(name).toMatch(/^--t-[a-z]+(?:-[a-z]+)*$/);
      expect(name.startsWith("--hl-")).toBe(false);
    }
  });

  it("uses kebab-case names for multi-word keys", () => {
    expect(tokenCssVarName("textMuted")).toBe("--t-text-muted");
    expect(Object.keys(vars)).toEqual(
      expect.arrayContaining([
        "--t-bg",
        "--t-text-muted",
        "--t-button-bg",
        "--t-button-text",
        "--t-font-heading",
        "--t-font-body",
        "--t-weight-heading",
        "--t-letter-case",
        "--t-border-width",
        "--t-button-style",
        "--t-max-width",
        "--t-bg-type",
        "--t-bg-image",
        "--t-overlay-opacity",
      ]),
    );
  });

  it("passes colors and enums through", () => {
    expect(vars["--t-bg"]).toBe("#16120E");
    expect(vars["--t-accent"]).toBe("#C9A86A");
    expect(vars["--t-button-style"]).toBe("fill");
    expect(vars["--t-density"]).toBe("regular");
    expect(vars["--t-align"]).toBe("center");
    expect(vars["--t-bg-type"]).toBe("solid");
    expect(vars["--t-letter-case"]).toBe("none");
  });

  it("adds px to radius, border width, max width and blur only", () => {
    const tokens: TokenSet = { ...noirTokens, radius: 12, borderWidth: 2, maxWidth: 520, blur: 8 };
    const out = tokensToCssVars(tokens);
    expect(out["--t-radius"]).toBe("12px");
    expect(out["--t-border-width"]).toBe("2px");
    expect(out["--t-max-width"]).toBe("520px");
    expect(out["--t-blur"]).toBe("8px");
  });

  it("keeps scale, weight and overlay opacity unitless", () => {
    const out = tokensToCssVars({
      ...noirTokens,
      scale: 1.125,
      weightHeading: 700,
      overlayOpacity: 0.4,
    });
    expect(out["--t-scale"]).toBe("1.125");
    expect(out["--t-weight-heading"]).toBe("700");
    expect(out["--t-overlay-opacity"]).toBe("0.4");
  });

  it("quotes font families and adds a generic fallback", () => {
    expect(vars["--t-font-heading"]).toBe('"Instrument Serif", serif');
    expect(vars["--t-font-body"]).toBe('"Geist", sans-serif');
    expect(tokensToCssVars({ ...noirTokens, fontBody: "Space Mono" })["--t-font-body"]).toBe(
      '"Space Mono", monospace',
    );
  });

  it("produces a quoted stack for every allowlisted font", () => {
    for (const family of FONT_ALLOWLIST) {
      const out = tokensToCssVars({ ...noirTokens, fontHeading: family });
      expect(out["--t-font-heading"]).toBe(`"${family}", ${FONT_GENERIC[family]}`);
    }
  });

  it("emits none for a null background image and url() for a real one", () => {
    expect(vars["--t-bg-image"]).toBe("none");
    const out = tokensToCssVars({
      ...noirTokens,
      bgType: "image",
      bgImage: "https://images.example.com/bg.webp?v=2",
    });
    expect(out["--t-bg-image"]).toBe('url("https://images.example.com/bg.webp?v=2")');
  });

  it("is deterministic and does not mutate its input", () => {
    const input = structuredClone(noirTokens);
    expect(tokensToCssVars(input)).toEqual(tokensToCssVars(input));
    expect(input).toEqual(noirTokens);
  });

  describe("defense in depth for values that bypassed validation", () => {
    const hostile = (patch: Record<string, unknown>) =>
      tokensToCssVars({ ...noirTokens, ...patch } as unknown as TokenSet);

    it("replaces an invalid color with the system default", () => {
      const out = hostile({ bg: "red; } body { display: none" });
      expect(out["--t-bg"]).toBe(SYSTEM_DEFAULT_TOKENS.bg);
      expect(JSON.stringify(out)).not.toContain("display");
    });

    it("replaces a font outside the allowlist", () => {
      const out = hostile({ fontHeading: 'x"; } @import url(//evil.example/a.css); a{' });
      expect(out["--t-font-heading"]).toBe('"Inter", sans-serif');
    });

    it("replaces an unsafe background image", () => {
      expect(hostile({ bgImage: "javascript:alert(1)" })["--t-bg-image"]).toBe("none");
      expect(hostile({ bgImage: 'https://a.example/x");}</style>' })["--t-bg-image"]).toBe("none");
    });

    it("replaces out-of-range and non-numeric numbers", () => {
      expect(hostile({ radius: 9999 })["--t-radius"]).toBe("12px");
      expect(hostile({ blur: "8px; color: red" })["--t-blur"]).toBe("0px");
    });
  });
});
