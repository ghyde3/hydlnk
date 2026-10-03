// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { gradientIsCustom } from "@/components/page/background";
import {
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { PUBLIC_READ_CACHE_VERSION } from "@/lib/publish/tags";
import {
  BLOCK_OVERRIDE_KEYS,
  GRADIENT_ANGLES,
  SYSTEM_DEFAULT_TOKENS,
  TOKEN_KEYS,
  blockOverridesSchema,
  resolveTokens,
  storedTokenSetSchema,
  tokenOverridesSchema,
  tokenSetSchema,
  tokensToCssVars,
  type TokenSet,
} from "@/lib/theme";
import { friendlyPublishErrors } from "@/lib/themes/publish-errors";
import { fullDraft, noirTokens } from "./fixtures/page-document";
import legacy from "./fixtures/pre-gradient-rows.json";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M6-41: the three gradient tokens (gradientAngle, gradientFrom, gradientTo). Strict values, CSS
 * variables that never carry a rejected value, stored documents from before the change that still
 * parse and render the same, and the renderer's two gradient rules.
 */

const KEYS = ["gradientAngle", "gradientFrom", "gradientTo"] as const;
const shape = tokenSetSchema.shape;
const ok = (key: (typeof KEYS)[number], value: unknown) => shape[key].safeParse(value).success;
const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

describe("M6-41 the token set has 26 keys", () => {
  it("three tokens join the 23 existing ones", () => {
    expect(TOKEN_KEYS).toHaveLength(26);
    for (const key of KEYS) expect(TOKEN_KEYS).toContain(key);
    expect(Object.keys(SYSTEM_DEFAULT_TOKENS)).toHaveLength(26);
  });

  it("the defaults are today's gradient: 180 degrees, no custom colors", () => {
    expect(SYSTEM_DEFAULT_TOKENS.gradientAngle).toBe(180);
    expect(SYSTEM_DEFAULT_TOKENS.gradientFrom).toBeNull();
    expect(SYSTEM_DEFAULT_TOKENS.gradientTo).toBeNull();
    expect(tokenSetSchema.safeParse(SYSTEM_DEFAULT_TOKENS).success).toBe(true);
  });
});

describe("M6-41 gradientAngle", () => {
  it("accepts exactly 0, 45, 90, 135, 180, 225, 270 and 315", () => {
    expect([...GRADIENT_ANGLES]).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    for (const angle of GRADIENT_ANGLES)
      expect(ok("gradientAngle", angle), String(angle)).toBe(true);
    for (let n = -400; n <= 720; n++) {
      if ((GRADIENT_ANGLES as readonly number[]).includes(n)) continue;
      expect(ok("gradientAngle", n), String(n)).toBe(false);
    }
  });

  it("rejects 181, 360, -45, NaN, infinity, fractions, numeric strings and every string at all", () => {
    for (const bad of [
      181,
      360,
      -45,
      44.9,
      90.0001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "180",
      "45",
      "0",
      "45deg",
      "180deg",
      "180deg; background:url(//evil.example/x)",
      "to bottom",
      "",
      " 180",
      null,
      undefined,
      true,
      [180],
      { value: 180 },
    ]) {
      expect(ok("gradientAngle", bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("M6-41 gradientFrom and gradientTo", () => {
  it.each(["gradientFrom", "gradientTo"] as const)(
    "%s accepts #RGB, #RRGGBB, #RRGGBBAA and null",
    (key) => {
      for (const value of ["#FFF", "#fff", "#C46A4F", "#c46a4f", "#C46A4F80", "#00000000", null]) {
        expect(ok(key, value), `${key} ${String(value)}`).toBe(true);
      }
    },
  );

  it.each(["gradientFrom", "gradientTo"] as const)("%s rejects everything else", (key) => {
    for (const bad of [
      "red",
      "rgb(0,0,0)",
      "url(x)",
      "#fff;}body{display:none",
      "#FFF;}</style><script>window.__x=1</script>",
      "45deg",
      "180deg; background:url(//evil.example/x)",
      "#C46A4F80F", // 9 digits
      "#C46A4F8000", // 10 characters
      "#1234567890123456",
      "#ABCD",
      "#12345",
      "#1234567",
      "#GGGGGG",
      "#",
      "",
      "C46A4F",
      " #C46A4F",
      "#C46A4F ",
      "#C46A4F\n",
      "transparent",
      "var(--x)",
      "#FFF/**/",
      "0",
      0,
      180,
      Number.NaN,
      undefined,
      true,
      [],
      {},
    ]) {
      expect(ok(key, bad), `${key} ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("no string longer than 9 characters is accepted", () => {
    for (let length = 10; length <= 40; length++) {
      const value = `#${"A".repeat(length - 1)}`;
      expect(ok("gradientFrom", value), String(length)).toBe(false);
    }
  });
});

describe("M6-41 overrides and block overrides", () => {
  it("page-level overrides accept any subset of the new keys", () => {
    for (const subset of [
      {},
      { gradientAngle: 90 },
      { gradientFrom: "#C46A4F" },
      { gradientTo: null },
      { bgType: "gradient", gradientAngle: 135, gradientFrom: "#C46A4F", gradientTo: "#1B1814" },
    ]) {
      expect(tokenOverridesSchema.safeParse(subset).success, JSON.stringify(subset)).toBe(true);
    }
  });

  it("page-level overrides still reject unknown keys and bad values of the new ones", () => {
    expect(tokenOverridesSchema.safeParse({ gradientDirection: 90 }).success).toBe(false);
    expect(tokenOverridesSchema.safeParse({ customCss: "x" }).success).toBe(false);
    expect(tokenOverridesSchema.safeParse({ gradientAngle: 181 }).success).toBe(false);
    expect(tokenOverridesSchema.safeParse({ gradientFrom: "red" }).success).toBe(false);
  });

  it("overrides do not gain the defaults of keys that were left out", () => {
    // A page that sets only a direction must not also say "no custom colors": that would hide a
    // gradient the theme carries.
    expect(tokenOverridesSchema.parse({ gradientAngle: 90 })).toEqual({ gradientAngle: 90 });
    expect(tokenOverridesSchema.parse({})).toEqual({});
  });

  it("block-level overrides do not accept them (M6-45)", () => {
    for (const key of KEYS) expect(BLOCK_OVERRIDE_KEYS as readonly string[]).not.toContain(key);
    expect(blockOverridesSchema.safeParse({ gradientAngle: 90 }).success).toBe(false);
    expect(blockOverridesSchema.safeParse({ gradientFrom: "#C46A4F" }).success).toBe(false);
    expect(blockOverridesSchema.safeParse({ accent: "#C46A4F" }).success).toBe(true);
  });

  it("the draft and publish schemas apply the same rules to theme.overrides", () => {
    const withOverrides = (overrides: Record<string, unknown>) => ({
      ...structuredClone(fullDraft),
      theme: { ref: null, overrides },
    });
    expect(draftDocSchema.safeParse(withOverrides({ gradientAngle: 225 })).success).toBe(true);
    expect(publishDocSchema.safeParse(withOverrides({ gradientAngle: 225 })).success).toBe(true);
    expect(draftDocSchema.safeParse(withOverrides({ gradientAngle: "45deg" })).success).toBe(false);
    expect(publishDocSchema.safeParse(withOverrides({ gradientTo: "red" })).success).toBe(false);
  });
});

describe("M6-41 CSS variables", () => {
  it("emit --t-gradient-angle as '<n>deg'", () => {
    for (const angle of GRADIENT_ANGLES) {
      const vars = tokensToCssVars({ ...noirTokens, gradientAngle: angle });
      expect(vars["--t-gradient-angle"]).toBe(`${angle}deg`);
    }
  });

  it("emit the stored hex, or the resolved surface and bg colors when the value is null", () => {
    const own = tokensToCssVars({
      ...noirTokens,
      gradientFrom: "#C46A4F",
      gradientTo: "#1B1814",
    });
    expect(own["--t-gradient-from"]).toBe("#C46A4F");
    expect(own["--t-gradient-to"]).toBe("#1B1814");

    const followed = tokensToCssVars(noirTokens);
    expect(followed["--t-gradient-from"]).toBe(noirTokens.surface);
    expect(followed["--t-gradient-to"]).toBe(noirTokens.bg);

    const half = tokensToCssVars({ ...noirTokens, gradientTo: "#00AA00" });
    expect(half["--t-gradient-from"]).toBe(noirTokens.surface);
    expect(half["--t-gradient-to"]).toBe("#00AA00");
  });

  it("still emits one variable per token, all --t-", () => {
    const vars = tokensToCssVars(noirTokens);
    expect(Object.keys(vars)).toHaveLength(26);
    expect(Object.keys(vars).every((name) => name.startsWith("--t-"))).toBe(true);
  });

  it("replaces a value that fails its schema with the default, and never concatenates it", () => {
    const hostile = [
      ["gradientAngle", "45deg; background:url(//evil.example/x)"],
      ["gradientAngle", 181],
      ["gradientAngle", "180"],
      ["gradientAngle", Number.NaN],
      ["gradientFrom", "#FFF;}</style><script>window.__x=1</script>"],
      ["gradientFrom", "red"],
      ["gradientFrom", "url(//evil.example/x)"],
      ["gradientTo", "red"],
      ["gradientTo", "#123;}"],
      ["gradientTo", 12],
    ] as const;
    for (const [key, value] of hostile) {
      const vars = tokensToCssVars({ ...noirTokens, [key]: value } as unknown as TokenSet);
      const everything = Object.values(vars).join("\n");
      expect(everything, `${key} ${String(value)}`).not.toMatch(/evil|script|<|\}|url\(\/\/|45deg/);
      if (key === "gradientAngle") expect(vars["--t-gradient-angle"]).toBe("180deg");
      if (key === "gradientFrom") expect(vars["--t-gradient-from"]).toBe(noirTokens.surface);
      if (key === "gradientTo") expect(vars["--t-gradient-to"]).toBe(noirTokens.bg);
    }
  });

  it("a token set without the gradient keys (an old object) falls back to the defaults", () => {
    const old = { ...noirTokens } as Partial<TokenSet>;
    for (const key of KEYS) delete old[key];
    const vars = tokensToCssVars(old as TokenSet);
    expect(vars["--t-gradient-angle"]).toBe("180deg");
    expect(vars["--t-gradient-from"]).toBe(noirTokens.surface);
    expect(vars["--t-gradient-to"]).toBe(noirTokens.bg);
  });
});

describe("M6-41 resolving", () => {
  it("page overrides beat the theme, which beats the default", () => {
    const theme = { gradientAngle: 90, gradientFrom: "#112233", gradientTo: "#445566" } as const;
    expect(resolveTokens(null, {}).gradientAngle).toBe(180);
    expect(resolveTokens(theme, {})).toMatchObject(theme);
    expect(resolveTokens(theme, { gradientAngle: 45 })).toMatchObject({
      gradientAngle: 45,
      gradientFrom: "#112233",
    });
    // null is a real value: a page can go back to following the page's own colors.
    expect(resolveTokens(theme, { gradientFrom: null }).gradientFrom).toBeNull();
  });

  it("a theme row with the old 23 keys resolves to a complete set with the default gradient", () => {
    const row = legacy.noirTheme as Partial<TokenSet>;
    expect(Object.keys(row)).toHaveLength(23);
    const resolved = resolveTokens(row, {});
    expect(Object.keys(resolved)).toHaveLength(26);
    expect(resolved).toMatchObject({ gradientAngle: 180, gradientFrom: null, gradientTo: null });
    expect(tokenSetSchema.partial().safeParse(row).success).toBe(true);
  });
});

describe("M6-41 publish freezes the three tokens", () => {
  const draftWith = (overrides: Record<string, unknown>): DraftDoc =>
    ({ ...structuredClone(fullDraft), theme: { ref: null, overrides } }) as DraftDoc;

  it("page overrides, then the theme, then the defaults", () => {
    const theme = { ...noirTokens, gradientAngle: 90 as const, gradientFrom: "#112233" };
    const tokens = toPublishForm(draftWith({ gradientAngle: 45 }), theme).tokens;
    expect(tokens.gradientAngle).toBe(45); // page
    expect(tokens.gradientFrom).toBe("#112233"); // theme
    expect(tokens.gradientTo).toBeNull(); // default
    expect(Object.keys(tokens)).toHaveLength(26);
    expect(publishedDocSchema.safeParse(toPublishForm(draftWith({}), noirTokens)).success).toBe(
      true,
    );
  });

  it("a form written now carries all 26 keys", () => {
    const form = toPublishForm(draftWith({}), null);
    expect(Object.keys(form.tokens).sort()).toEqual([...TOKEN_KEYS].sort());
  });

  it("the cache version of the public read is '3'", () => {
    expect(PUBLIC_READ_CACHE_VERSION).toBe("3");
  });
});

describe("M6-41 a document stored before the change", () => {
  const stored = () => structuredClone(legacy.published);
  /** The stored page without its blocks: the gradient is the page root's, and block markup is other features'. */
  const storedWithoutBlocks = () => ({ ...stored(), blocks: [] });

  it("the fixture is a real pre-change row: 23 token keys, none of the new ones", () => {
    const tokens = stored().tokens as Record<string, unknown>;
    expect(Object.keys(tokens)).toHaveLength(23);
    for (const key of KEYS) expect(tokens).not.toHaveProperty(key);
  });

  it("still parses with publishedDocSchema and resolves the three tokens to their defaults", () => {
    const parsed = publishedDocSchema.safeParse(stored());
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.tokens).toMatchObject({
      gradientAngle: 180,
      gradientFrom: null,
      gradientTo: null,
    });
    expect(Object.keys(parsed.data.tokens)).toHaveLength(26);
  });

  it("the strict complete-set schema alone still requires every key (only stored documents are lenient)", () => {
    const tokens = (stored().tokens ?? {}) as Record<string, unknown>;
    expect(tokenSetSchema.safeParse(tokens).success).toBe(false);
    expect(storedTokenSetSchema.safeParse(tokens).success).toBe(true);
  });

  it("renders markup and styles identical to the same document with the defaults written out", () => {
    const old = publishedDocSchema.parse(storedWithoutBlocks()) as PublishDoc;
    const explicit = {
      ...old,
      tokens: { ...old.tokens, gradientAngle: 180, gradientFrom: null, gradientTo: null },
    } as PublishDoc;
    const props = { pageId: PAGE_ID, mode: "live" as const };
    const a = renderToStaticMarkup(createElement(PageRenderer, { doc: old, ...props }));
    const b = renderToStaticMarkup(createElement(PageRenderer, { doc: explicit, ...props }));
    expect(a).toBe(b);
    expect(a).not.toContain("data-gradient");
    expect(a).toContain("--t-gradient-angle:180deg");
  });

  it("a stored gradient page (Smoke, 23 keys) keeps today's stops: no data-gradient attribute", () => {
    const old = publishedDocSchema.parse({
      ...storedWithoutBlocks(),
      tokens: legacy.smokeTheme,
    }) as PublishDoc;
    expect(old.tokens.bgType).toBe("gradient");
    const html = renderToStaticMarkup(
      createElement(PageRenderer, { doc: old, pageId: PAGE_ID, mode: "live" }),
    );
    const root = new DOMParser()
      .parseFromString(`<body>${html}</body>`, "text/html")
      .querySelector("[data-page-root]")!;
    expect(root.getAttribute("data-bg-type")).toBe("gradient");
    expect(root.hasAttribute("data-gradient")).toBe(false);
    const style = root.getAttribute("style") ?? "";
    expect(style).toContain("--t-gradient-angle:180deg");
    expect(style).toContain(`--t-gradient-from:${old.tokens.surface}`);
    expect(style).toContain(`--t-gradient-to:${old.tokens.bg}`);
  });

  it("a hostile value in a stored document is refused, never defaulted (fail closed)", () => {
    for (const key of ["gradientFrom", "gradientTo"] as const) {
      for (const bad of [
        "#FFF;}</style><script>window.__x=1</script>",
        "red",
        "url(//evil.example/x)",
      ]) {
        const row = { ...stored(), tokens: { ...(stored().tokens as object), [key]: bad } };
        expect(publishedDocSchema.safeParse(row).success, `${key} ${bad}`).toBe(false);
      }
    }
    for (const bad of ["45deg; background:url(//evil.example/x)", 181, "180", null]) {
      const row = { ...stored(), tokens: { ...(stored().tokens as object), gradientAngle: bad } };
      expect(publishedDocSchema.safeParse(row).success, String(bad)).toBe(false);
    }
    const hostileTheme = { ...legacy.noirTheme, gradientFrom: "#FFF;}</style>" };
    expect(tokenSetSchema.partial().safeParse(hostileTheme).success).toBe(false);
  });
});

describe("M6-41 the renderer's gradient", () => {
  const renderRoot = (tokens: Partial<TokenSet>): Element => {
    const doc = publishedDocSchema.parse({
      ...structuredClone(legacy.published),
      blocks: [],
    }) as PublishDoc;
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        doc: { ...doc, tokens: { ...doc.tokens, ...tokens } },
        pageId: PAGE_ID,
        mode: "live",
      }),
    );
    return new DOMParser()
      .parseFromString(`<body>${html}</body>`, "text/html")
      .querySelector("[data-page-root]")!;
  };

  it("marks a gradient with colors of its own, and only that", () => {
    expect(renderRoot({ bgType: "gradient" }).hasAttribute("data-gradient")).toBe(false);
    expect(
      renderRoot({ bgType: "gradient", gradientAngle: 135 }).hasAttribute("data-gradient"),
    ).toBe(false);
    expect(
      renderRoot({ bgType: "gradient", gradientFrom: "#C46A4F" }).getAttribute("data-gradient"),
    ).toBe("custom");
    expect(
      renderRoot({ bgType: "gradient", gradientTo: "#1B1814" }).getAttribute("data-gradient"),
    ).toBe("custom");
    // A solid page with stored gradient colors is still solid.
    expect(
      renderRoot({ bgType: "solid", gradientFrom: "#C46A4F" }).hasAttribute("data-gradient"),
    ).toBe(false);
  });

  it("gradientIsCustom is false for a token set without the keys", () => {
    expect(gradientIsCustom({ bgType: "gradient" } as TokenSet)).toBe(false);
    expect(gradientIsCustom({ bgType: "gradient", gradientFrom: null, gradientTo: null })).toBe(
      false,
    );
    expect(gradientIsCustom({ bgType: "gradient", gradientFrom: "#FFF", gradientTo: null })).toBe(
      true,
    );
  });

  const css = readFileSync(
    resolve(process.cwd(), "src/components/page/page-renderer.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("the stylesheet draws the default gradient with today's stops and a custom one end to end", () => {
    const rule = (selector: string): string => {
      const start = css.indexOf(selector);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start)).replace(/\s+/g, " ");
    };
    const standard = rule('[data-page-root][data-bg-type="gradient"] {');
    expect(standard).toContain("var(--t-gradient-angle)");
    expect(standard).toContain("var(--t-gradient-from) 0%");
    expect(standard).toContain("var(--t-gradient-to) 55%");
    const custom = rule('[data-page-root][data-bg-type="gradient"][data-gradient="custom"] {');
    expect(custom).toContain("var(--t-gradient-from) 0%");
    expect(custom).toContain("var(--t-gradient-to) 100%");
  });

  it("the stylesheet gains no color literal", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css.match(/\brgba?\s*\(/gi) ?? []).toEqual([]);
  });
});

describe("M6-41 publish messages for the gradient fields", () => {
  const message = (overrides: Record<string, unknown>): string => {
    const draft = { ...structuredClone(fullDraft), theme: { ref: null, overrides } };
    const errors = friendlyPublishErrors(collectPublishErrors(draft));
    return errors.map((error) => error.message).join("\n");
  };

  it("name the field in plain words and never echo the value", () => {
    expect(message({ gradientAngle: "45deg; background:url(//evil.example/x)" })).toBe(
      "Publish stopped: Gradient direction isn’t valid. Reset it in Design.",
    );
    expect(message({ gradientAngle: 181 })).toBe(
      "Publish stopped: Gradient direction isn’t valid. Reset it in Design.",
    );
    expect(message({ gradientFrom: "#FFF;}</style><script>window.__x=1</script>" })).toBe(
      "Publish stopped: Gradient start color isn’t a valid color. Reset it in Design.",
    );
    expect(message({ gradientTo: "red" })).toBe(
      "Publish stopped: Gradient end color isn’t a valid color. Reset it in Design.",
    );
  });
});
