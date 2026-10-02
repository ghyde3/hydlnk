import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_DEFAULT_TOKENS,
  TOKEN_KEYS,
  tokenCssVarName,
  tokenOverridesSchema,
  tokenSetSchema,
  tokensToCssVars,
  type TokenSet,
} from "@/lib/theme";
import { isProjectMediaUrl } from "@/lib/theme/tokens";
import { noirTokens } from "./fixtures/page-document";

/** M3-02: strict token values and injection-safe CSS variables. */

const COLOR_KEYS = [
  "bg",
  "surface",
  "text",
  "textMuted",
  "accent",
  "buttonBg",
  "buttonText",
  "border",
] as const;

const shape = tokenSetSchema.shape;
const ok = (key: keyof TokenSet, value: unknown) =>
  shape[key].safeParse(value).success;

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const LOCAL = "http://127.0.0.1:54321";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOCAL);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("M3-02 color tokens", () => {
  it.each(COLOR_KEYS)("%s accepts #RGB, #RRGGBB and #RRGGBBAA", (key) => {
    for (const value of ["#FFF", "#fff", "#C9A86A", "#c9a86a", "#C9A86A80", "#00000000"]) {
      expect(ok(key, value), `${key} ${value}`).toBe(true);
    }
  });

  it.each(COLOR_KEYS)("%s rejects names, functions, bad digits and long strings", (key) => {
    for (const value of [
      "red",
      "rgb(0,0,0)",
      "#GGGGGG",
      "url(x)",
      "#fff;}body{display:none",
      "#C9A86A80F", // 9 digits
      "#C9A86A8000", // longer than 9 characters
      "#1234567890123456",
      "#ABCD", // 4 digits
      "#12345", // 5 digits
      "#1234567", // 7 digits
      "#",
      "",
      "C9A86A",
      " #C9A86A",
      "#C9A86A ",
      "#C9A86A\n",
      "transparent",
      "var(--x)",
      "#FFF/**/",
      12,
      null,
      undefined,
    ]) {
      expect(ok(key, value), `${key} ${JSON.stringify(value)}`).toBe(false);
    }
  });
});

describe("M3-02 enum tokens", () => {
  const cases: [keyof TokenSet, string[]][] = [
    ["buttonStyle", ["fill", "outline", "soft", "shadow", "pill"]],
    ["density", ["compact", "regular", "airy"]],
    ["bgType", ["solid", "gradient", "image"]],
    ["align", ["left", "center"]],
    ["letterCase", ["normal", "uppercase", "lowercase"]],
  ];

  it.each(cases)("%s accepts only its documented values", (key, values) => {
    for (const value of values) expect(ok(key, value), value).toBe(true);
    for (const bad of [
      "",
      "neon",
      "Fill",
      "FILL",
      "fill;}",
      "capitalize",
      "right",
      "full",
      " fill",
      1,
      true,
      null,
    ]) {
      if (values.includes(bad as string)) continue;
      expect(ok(key, bad), `${key} ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("no longer accepts the legacy `none` spelling of letterCase (a migration rewrote it to normal)", () => {
    expect(ok("letterCase", "none")).toBe(false);
    expect(ok("letterCase", "normal")).toBe(true);
  });
});

describe("M3-02 numeric tokens", () => {
  const ranges: [keyof TokenSet, number, number][] = [
    ["radius", 0, 32],
    ["borderWidth", 0, 4],
    ["scale", 0.8, 1.3],
    ["maxWidth", 360, 720],
    ["overlayOpacity", 0, 1],
    ["blur", 0, 24],
  ];

  it.each(ranges)("%s accepts %d to %d and rejects just outside", (key, min, max) => {
    expect(ok(key, min)).toBe(true);
    expect(ok(key, max)).toBe(true);
    expect(ok(key, (min + max) / 2)).toBe(true);
    expect(ok(key, min - 0.01)).toBe(false);
    expect(ok(key, max + 0.01)).toBe(false);
  });

  it.each(ranges)("%s rejects NaN, infinity, negatives and numeric strings", (key, min, max) => {
    expect(ok(key, Number.NaN)).toBe(false);
    expect(ok(key, Number.POSITIVE_INFINITY)).toBe(false);
    expect(ok(key, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(ok(key, -1)).toBe(false);
    expect(ok(key, String(max))).toBe(false);
    expect(ok(key, `${min}px`)).toBe(false);
    expect(ok(key, null)).toBe(false);
    expect(ok(key, undefined)).toBe(false);
  });

  it("weightHeading is one of 400, 500, 600 or 700", () => {
    for (const weight of [400, 500, 600, 700]) expect(ok("weightHeading", weight)).toBe(true);
    for (const bad of [300, 450, 800, 900, 0, -400, Number.NaN, "400", "bold", null]) {
      expect(ok("weightHeading", bad), String(bad)).toBe(false);
    }
  });
});

describe("M3-02 bgImage", () => {
  const good = `${LOCAL}/storage/v1/object/public/page-media/${UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.jpg`;

  it("is nullable and accepts a page-media object of this project", () => {
    expect(ok("bgImage", null)).toBe(true);
    expect(ok("bgImage", good)).toBe(true);
    expect(isProjectMediaUrl(good)).toBe(true);
    expect(ok("bgImage", good.replace(".jpg", ".webp"))).toBe(true);
  });

  it("accepts https on the project host of a production deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdef.supabase.co");
    const prod = `https://abcdef.supabase.co/storage/v1/object/public/page-media/${UID}/night-market-banner.png`;
    expect(ok("bgImage", prod)).toBe(true);
    // http on a production host, and the local stack from a production build, are refused.
    expect(ok("bgImage", prod.replace("https:", "http:"))).toBe(false);
    expect(ok("bgImage", good)).toBe(false);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["another host", "https://evil.example/x.png"],
    ["another host with the right path", `https://evil.example/storage/v1/object/public/page-media/${UID}/abcdefgh.png`],
    ["http on a production host", `http://abcdef.supabase.co/storage/v1/object/public/page-media/${UID}/abcdefgh.png`],
    ["a different bucket", `${LOCAL}/storage/v1/object/public/other/${UID}/abcdefgh.png`],
    ["a private object path", `${LOCAL}/storage/v1/object/sign/page-media/${UID}/abcdefgh.png`],
    ["a double quote", `${LOCAL}/storage/v1/object/public/page-media/${UID}/abcdefgh.png"`],
    ["a single quote", `${LOCAL}/storage/v1/object/public/page-media/${UID}/abc'defgh.png`],
    ["parentheses", `${LOCAL}/storage/v1/object/public/page-media/${UID}/abc(defgh).png`],
    ["a closing style tag", `${LOCAL}/storage/v1/object/public/page-media/${UID}/a.png</style>`],
    ["a query string", `${good}?x=1`],
    ["a fragment", `${good}#x`],
    ["path traversal", `${LOCAL}/storage/v1/object/public/page-media/../../x.png`],
    ["credentials", `http://user:pw@127.0.0.1:54321/storage/v1/object/public/page-media/${UID}/abcdefgh.png`],
    ["a wrong extension", `${LOCAL}/storage/v1/object/public/page-media/${UID}/abcdefgh.svg`],
    ["a whitespace", `${good} `],
    ["an empty string", ""],
    ["an plain http URL", "http://example.com/x.png"],
    ["a protocol-relative URL", `//127.0.0.1:54321/storage/v1/object/public/page-media/${UID}/abcdefgh.png`],
    ["a non-string", 5],
  ])("rejects %s", (_name, value) => {
    expect(ok("bgImage", value)).toBe(false);
  });

  it("accepts nothing but null when the project URL is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(ok("bgImage", good)).toBe(false);
    expect(ok("bgImage", null)).toBe(true);
  });
});

describe("M3-02 page-level overrides schema", () => {
  it("accepts any subset of the token keys, including none", () => {
    expect(tokenOverridesSchema.safeParse({}).success).toBe(true);
    expect(tokenOverridesSchema.safeParse({ radius: 20 }).success).toBe(true);
    expect(
      tokenOverridesSchema.safeParse({ accent: "#C46A4F", fontHeading: "Fraunces", scale: 1.1 })
        .success,
    ).toBe(true);
    for (const key of TOKEN_KEYS) {
      const value = key === "bgImage" ? null : SYSTEM_DEFAULT_TOKENS[key];
      expect(tokenOverridesSchema.safeParse({ [key]: value }).success, key).toBe(true);
    }
  });

  it.each(["fontHeadingg", "customCss", "css", "__proto__x", "Accent", "background"])(
    "rejects the unknown key %s",
    (key) => {
      expect(tokenOverridesSchema.safeParse({ [key]: "x" }).success).toBe(false);
      expect(tokenOverridesSchema.safeParse({ radius: 12, [key]: "x" }).success).toBe(false);
    },
  );

  it("rejects a hostile value for a known key", () => {
    expect(
      tokenOverridesSchema.safeParse({ bg: "red;}</style><script>window.__x=1</script>" }).success,
    ).toBe(false);
    expect(tokenOverridesSchema.safeParse({ fontHeading: "Evil;}" }).success).toBe(false);
  });
});

describe("M3-02 CSS variable serializer", () => {
  it("emits one --t-* custom property per token, named after its key", () => {
    const vars = tokensToCssVars(noirTokens);
    expect(Object.keys(vars).sort()).toEqual(TOKEN_KEYS.map((key) => tokenCssVarName(key)).sort());
    for (const name of Object.keys(vars)) {
      expect(name).toMatch(/^--t-[a-z]+(?:-[a-z]+)*$/);
      expect(name.startsWith("--hl-")).toBe(false);
    }
  });

  it("drops a value that fails its token schema and uses the system default for that token", () => {
    const hostile = {
      ...noirTokens,
      bg: "red;}</style><script>window.__x=1</script>",
      accent: "url(//evil.example/a)",
      fontHeading: 'Evil"; } @import url(//evil.example/a.css); a{',
      fontBody: "Geist, sans-serif",
      radius: "12px; background:red",
      scale: 99,
      blur: Number.NaN,
      weightHeading: 800,
      letterCase: "capitalize",
      buttonStyle: "neon",
      bgImage: "https://evil.example/x.png",
    } as unknown as TokenSet;
    const vars = tokensToCssVars(hostile);
    const d = SYSTEM_DEFAULT_TOKENS;
    expect(vars["--t-bg"]).toBe(d.bg);
    expect(vars["--t-accent"]).toBe(d.accent);
    expect(vars["--t-font-heading"]).toBe('"Inter", sans-serif');
    expect(vars["--t-font-body"]).toBe('"Inter", sans-serif');
    expect(vars["--t-radius"]).toBe(`${d.radius}px`);
    expect(vars["--t-scale"]).toBe(String(d.scale));
    expect(vars["--t-blur"]).toBe(`${d.blur}px`);
    expect(vars["--t-weight-heading"]).toBe(String(d.weightHeading));
    expect(vars["--t-letter-case"]).toBe("none");
    expect(vars["--t-button-style"]).toBe(d.buttonStyle);
    expect(vars["--t-bg-image"]).toBe("none");
    // Untouched tokens keep their own value.
    expect(vars["--t-surface"]).toBe(noirTokens.surface);
    const text = JSON.stringify(vars);
    for (const needle of ["script", "evil", "Evil", "@import", "url(//", "display"]) {
      expect(text).not.toContain(needle);
    }
  });

  it("never emits a value that could end a declaration, a rule or the style element", () => {
    const bad = ["};", "</style>", "<", ">", "{", "\n", "expression("];
    for (const key of TOKEN_KEYS) {
      for (const payload of bad) {
        const vars = tokensToCssVars({ ...noirTokens, [key]: payload } as unknown as TokenSet);
        for (const [name, value] of Object.entries(vars)) {
          expect(`${name}:${value}`, `${key} <- ${payload}`).not.toMatch(/[;{}<>\n]/);
        }
      }
    }
  });

  it("serializes the three letter cases as valid text-transform values", () => {
    expect(tokensToCssVars({ ...noirTokens, letterCase: "normal" })["--t-letter-case"]).toBe("none");
    expect(tokensToCssVars({ ...noirTokens, letterCase: "uppercase" })["--t-letter-case"]).toBe(
      "uppercase",
    );
    expect(tokensToCssVars({ ...noirTokens, letterCase: "lowercase" })["--t-letter-case"]).toBe(
      "lowercase",
    );
  });

  it("writes a valid background image as a quoted url() and #RGB / #RRGGBBAA colors as they are", () => {
    const good = `${LOCAL}/storage/v1/object/public/page-media/${UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.png`;
    const vars = tokensToCssVars({ ...noirTokens, bgType: "image", bgImage: good, bg: "#FFF", border: "#C9A86A80" });
    expect(vars["--t-bg-image"]).toBe(`url("${good}")`);
    expect(vars["--t-bg"]).toBe("#FFF");
    expect(vars["--t-border"]).toBe("#C9A86A80");
  });
});
