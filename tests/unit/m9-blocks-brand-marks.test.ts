// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as simpleIcons from "simple-icons";
import {
  siDiscord,
  siFacebook,
  siGithub,
  siInstagram,
  siPinterest,
  siReddit,
  siSnapchat,
  siSpotify,
  siThreads,
  siTiktok,
  siTwitch,
  siX,
  siYoutube,
} from "simple-icons";
import { describe, expect, it, vi } from "vitest";
import { BRAND_MARK_NAMES, LINKEDIN_MARK_PATH, brandMarkPath } from "@/components/page/brand-marks";
import { LinkGlyph } from "@/components/page/link-icon";
import { SocialGlyph } from "@/components/page/social-icons";
import {
  LINK_ICONS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  changeSocialPlatform,
  toPublishForm,
  type Block,
  type DraftDoc,
  type LinkIconName,
  type SocialIcon,
  type SocialPlatform,
} from "@/lib/document";
import { pageRulesCss } from "@/lib/tenant-assets/css";
import { PreviewBezel } from "@/components/workspace/preview-bezel";
import { pageChrome } from "@/lib/publish/chrome";
import { noirTokens } from "./fixtures/page-document";
import { importsOf, tenantGraph } from "./m9-icons-helpers";

vi.mock("server-only", () => ({}));
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
vi.mock("@/lib/publish/actions", () => ({ publishPage: vi.fn() }));
vi.mock("@/lib/publish/unpublish-action", () => ({ unpublishSite: vi.fn() }));

const { renderLivePage } = await import("@/lib/tenant-render/live-page");
const { provideEmbedFacade } = await import("@/components/page/embed-slot");
const { EmbedFacade } = await import("@/components/page/embed-facade");
const { EmbedFacadeMarkup } = await import("@/components/page/embed-facade-markup");

/**
 * M9-04: real brand marks from Simple Icons in the social row and the link icons. The marks are the
 * package's own path data, byte for byte; LinkedIn (not in the package) is one drawn path; the
 * public page gets them as inline SVG and no library JS; the generic glyphs render the bytes they
 * rendered before.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

/** The thirteen brands Simple Icons has, and the path it holds for each. */
const SIMPLE: Array<[string, { path: string; slug: string }]> = [
  ["instagram", siInstagram],
  ["tiktok", siTiktok],
  ["youtube", siYoutube],
  ["x", siX],
  ["facebook", siFacebook],
  ["github", siGithub],
  ["threads", siThreads],
  ["reddit", siReddit],
  ["snapchat", siSnapchat],
  ["pinterest", siPinterest],
  ["discord", siDiscord],
  ["twitch", siTwitch],
  ["spotify", siSpotify],
];

const pathsOf = (markup: string) => [...markup.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1]!);

describe("M9-04 the marks are the package's own path data", () => {
  it.each(SIMPLE)(
    "%s: the rendered <path d> equals the package's path byte for byte",
    (name, icon) => {
      const markup = html(createElement(SocialGlyph, { platform: name as SocialPlatform }));
      expect(pathsOf(markup)).toEqual([icon.path]);
      expect(brandMarkPath(name)).toBe(icon.path);
      expect(icon.slug).toBe(name);
    },
  );

  it.each(SIMPLE)(
    "%s: one filled path in the 24x24 box, no transform, no paint of its own",
    (name) => {
      const markup = html(createElement(SocialGlyph, { platform: name as SocialPlatform }));
      expect(markup.match(/<path /g)).toHaveLength(1);
      expect(markup).toMatch(
        /^<svg class="pg-social-glyph pg-social-glyph-brand" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="[^"]+"><\/path><\/svg>$/,
      );
      expect(markup).not.toMatch(
        /transform|style=|fill=|stroke=|width=|height=|<title|<g[ >]|href|xlink/i,
      );
    },
  );

  it("there are fourteen marks: the thirteen and LinkedIn, in the order of the social row's", () => {
    expect([...BRAND_MARK_NAMES]).toEqual([
      "instagram",
      "tiktok",
      "youtube",
      "x",
      "facebook",
      "linkedin",
      "github",
      "threads",
      "reddit",
      "snapchat",
      "pinterest",
      "discord",
      "twitch",
      "spotify",
    ]);
    // Every platform of the social row has a glyph: a brand mark or one of the two outline drawings.
    for (const platform of SOCIAL_PLATFORMS) {
      expect(html(createElement(SocialGlyph, { platform })), platform).toMatch(/^<svg /);
    }
    expect(SOCIAL_PLATFORMS.filter((p) => brandMarkPath(p) === null)).toEqual(["email", "website"]);
  });

  it("Simple Icons is pinned at 16.34.0 and is CC0-1.0", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["simple-icons"]).toBe("16.34.0");
    const installed = JSON.parse(read("node_modules/simple-icons/package.json")) as {
      version: string;
      license: string;
    };
    expect(installed.version).toBe("16.34.0");
    expect(installed.license).toBe("CC0-1.0");
  });

  it("a note next to the glyph table says the marks are trademarks, used only to link to the services", () => {
    expect(read("src/components/page/brand-marks.ts")).toMatch(/trademark/i);
    expect(read("src/components/page/brand-marks.ts")).toMatch(/only to link to those services/);
  });
});

describe("M9-04 LinkedIn is drawn, and a Simple Icons upgrade that adds it is noticed", () => {
  it("the pinned package has no LinkedIn export and no LinkedIn slug", () => {
    expect(Object.keys(simpleIcons).filter((key) => /linkedin/i.test(key))).toEqual([]);
    const slugs = Object.values(simpleIcons as unknown as Record<string, { slug?: string }>)
      .map((icon) => icon?.slug)
      .filter((slug): slug is string => typeof slug === "string");
    expect(slugs.length).toBeGreaterThan(3000);
    expect(slugs).not.toContain("linkedin");
  });

  it("its mark is exactly one <path>, at most 1.5 KB of path data, every coordinate inside 0 to 24", () => {
    const markup = html(createElement(SocialGlyph, { platform: "linkedin" }));
    expect(markup.match(/<path /g)).toHaveLength(1);
    expect(pathsOf(markup)).toEqual([LINKEDIN_MARK_PATH]);
    expect(LINKEDIN_MARK_PATH.length).toBeLessThanOrEqual(1500);
    const numbers = [...LINKEDIN_MARK_PATH.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
    expect(numbers.length).toBeGreaterThan(20);
    for (const value of numbers) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(24);
    }
    // The letters are holes in the square: more than one subpath.
    expect(LINKEDIN_MARK_PATH.match(/z/gi)!.length).toBeGreaterThanOrEqual(4);
  });

  it("names its source and says no file was downloaded", () => {
    const source = read("src/components/page/brand-marks.ts");
    expect(source).toMatch(/LinkedIn Brand Guidelines/);
    expect(source).toMatch(/brand\.linkedin\.com/);
    expect(source).toMatch(/checked[\s*]+20\d\d-\d\d-\d\d/);
    expect(source).toMatch(/no[\s*]+file[\s*]+was[\s*]+downloaded/);
  });
});

describe("M9-04 the generic glyphs render the bytes they rendered before", () => {
  // sha256 of the markup HEAD (before this wave) rendered, captured from the old modules.
  const BEFORE: Record<string, string> = {
    "social:email": "73ce5fe331e09aab8a1e5ee376dfbfba50b96b447a0b60df14b3c7c722d8f270",
    "social:website": "8a55424a6efb6c3057b1a348a6a16b7d4f8ba9457ef021104e81395f1f8f98b1",
    "link:link": "164098e1870ce9cbedaf45346d0ace82834e3f996cf617df281073987a09787c",
    "link:mail": "3ab5f9738238a16de3684ecd73247ec06dc02272eeb2b0eaf77ef32c65f65048",
    "link:globe": "a78789f34585d3174cd536a22991b61a87b1b57e1298d845108ba6417eb2f4ff",
    "link:music": "cff5af2da24086bbf5f58a42a150ea1da96e23d34142b7952950af2903bf9025",
    "link:video": "2a15fadad331c6da4a496d39568b9aeaacc0d5c0fa91e8c08da3c2e3255df552",
    "link:mic": "793a9a8816137bd4a73f20328dfcad345d6b41ba01155ca9142ffa2c2e634317",
    "link:camera": "85ee082dcb4e1fa4074ae9e7178a694f9124aa9e8048faa1a52ab9335ec5b53b",
    "link:calendar": "d6b6da72aef2778f66bacb848f77d301f20d8c87a19db6fe59e5ac5ea80065d2",
    "link:bag": "88981a753c9bdcb90b0f71a67dae9b01b4048a63bc061ea2ece4fb77b95b8ba3",
    "link:ticket": "4119d495fbef3bbe6b3c6dbb737e836082271db84ad3d60219f8bf5fd5cc55ad",
    "link:heart": "7f66e7c7487709bbcaf39e4cd51c34caa15a7d2b09be3d5de7eeb628d4677aff",
    "link:star": "f4dd10ba092c2e9b445b3aa1d97e6905cc3e0088768490e15b87460f5084c132",
    "link:book": "5a708629980b38a30c16edba1d4276d84d427b46ea5de3ddb623cd836260dbed",
    "link:gift": "e7f6a4b423e15ba9ce335fd6d42086cd9fdb66a8619ee16fdc53da1e570e1b3f",
    "link:pin": "804dc62014ef72831b0cc7870e8c1a6ec4d55c622bc38568466d06675dc6df56",
    "link:phone": "8c3f2e2510124464795268f6d300419192f3fd6b53a199f1cc6d07a23ccb3065",
  };

  it("the social row's Email and Website: byte-identical, with no modifier class", () => {
    for (const platform of ["email", "website"] as const) {
      const markup = html(createElement(SocialGlyph, { platform }));
      expect(sha(markup), platform).toBe(BEFORE[`social:${platform}`]);
      expect(markup).toContain('class="pg-social-glyph"');
      expect(markup).not.toContain("brand");
    }
  });

  it("the sixteen generic link icons: byte-identical", () => {
    const generic = LINK_ICONS.filter((name) => !BRAND_LINK_ICONS.includes(name));
    expect(generic).toHaveLength(16);
    for (const name of generic) {
      expect(sha(html(createElement(LinkGlyph, { name }))), name).toBe(BEFORE[`link:${name}`]);
    }
  });
});

const BRAND_LINK_ICONS: readonly LinkIconName[] = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "threads",
];

describe("M9-04 the link icons", () => {
  it("LINK_ICONS stays 24 names; the six new brands are not in it", () => {
    expect(LINK_ICONS).toHaveLength(24);
    for (const name of ["reddit", "snapchat", "pinterest", "discord", "twitch", "spotify"]) {
      expect(LINK_ICONS as readonly string[]).not.toContain(name);
    }
    expect(LINK_ICONS.slice(0, 8)).toEqual(BRAND_LINK_ICONS);
  });

  it("the eight brand entries draw the same marks as the social row, filled currentColor at 20px", () => {
    for (const name of BRAND_LINK_ICONS) {
      const link = html(createElement(LinkGlyph, { name }));
      expect(link).toMatch(
        /^<svg class="pg-link-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none" aria-hidden="true" focusable="false"><path d="[^"]+"><\/path><\/svg>$/,
      );
      expect(pathsOf(link), name).toEqual([brandMarkPath(name)]);
      expect(pathsOf(link), name).toEqual(
        pathsOf(html(createElement(SocialGlyph, { platform: name as SocialPlatform }))),
      );
    }
  });
});

describe("M9-04 no string from the document reaches a path, an attribute or a class", () => {
  it.each(["__proto__", "constructor", "toString", "<script>", "hasOwnProperty", "", "Instagram"])(
    "the platform %j has no glyph and does not throw",
    (platform) => {
      expect(brandMarkPath(platform)).toBeNull();
      expect(html(createElement(SocialGlyph, { platform: platform as SocialPlatform }))).toBe("");
      expect(html(createElement(LinkGlyph, { name: platform as LinkIconName }))).toBe("");
    },
  );

  it("a non-string has no mark either", () => {
    for (const value of [null, undefined, 5, {}, ["instagram"]])
      expect(brandMarkPath(value)).toBeNull();
  });

  it("the six new brands are in the social table but not in the link icon list, so a link block cannot draw them", () => {
    expect(brandMarkPath("reddit")).not.toBeNull();
    expect(html(createElement(LinkGlyph, { name: "reddit" as LinkIconName }))).toBe("");
  });
});

describe("M9-04 server render only: no library JS on the public page", () => {
  const graph = tenantGraph();

  it("the tenant module graph reaches simple-icons through the one glyph table, and no client library", () => {
    const simple = importsOf(graph, ["simple-icons"]);
    expect(simple).toEqual(["src/components/page/brand-marks.ts: simple-icons"]);
    expect(
      importsOf(graph, [
        "lucide-react",
        "@radix-ui",
        "@tiptap",
        "react-colorful",
        "react-easy-crop",
        "react-email",
        "@sentry",
        "clsx",
        "tailwind-merge",
        "@dnd-kit",
      ]),
    ).toEqual([]);
  });

  it("simple-icons is plain data: no 'use client' in its entry points, imported by name only", () => {
    for (const file of ["index.mjs", "index.js"]) {
      expect(read(`node_modules/simple-icons/${file}`).slice(0, 400)).not.toMatch(/use client/);
    }
    const source = read("src/components/page/brand-marks.ts");
    expect(source).not.toMatch(/import\s+\*\s+as/);
    expect(source).not.toMatch(/import\s*\(/);
    expect(source).toMatch(/from "simple-icons";/);
  });

  it("the one tenant script knows nothing of marks: it has no import and no path data", () => {
    const script = read("src/lib/tenant-assets/script/tenant.js");
    expect(script).not.toMatch(/simple-icons|brand-marks|pg-social-glyph/);
    expect(script).not.toMatch(/^\s*import\s/m);
  });

  it("the live document holds each mark as an inline svg written by the static renderer", () => {
    const draft = fixtureDraft();
    const live = renderLivePage({
      pageId: PAGE_ID,
      document: toPublishForm(draft, noirTokens),
      plan: "free",
      urls: null,
    });
    expect(live).toContain(
      `<svg class="pg-social-glyph pg-social-glyph-brand" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${siInstagram.path}"></path></svg>`,
    );
    expect(live).not.toMatch(/simple-icons/);
  });

  it("a page with no social block carries no social rule and no mark", () => {
    const draft = {
      ...fixtureDraft(),
      blocks: [LINKS_BLOCK],
    } as DraftDoc;
    const live = renderLivePage({
      pageId: PAGE_ID,
      document: toPublishForm(draft, noirTokens),
      plan: "free",
      urls: null,
    });
    expect(live).not.toMatch(/pg-social/);
    for (const [, icon] of SIMPLE) expect(live).not.toContain(icon.path);
    expect(pageRulesCss(["link"])).not.toMatch(/pg-social/);
  });
});

describe("M9-04 the stylesheet", () => {
  const css = read("src/components/page/page-renderer.css");

  it(".pg-social-glyph keeps the 18px box and the outline paint; the brand modifier fills and drops the stroke", () => {
    expect(css).toMatch(
      /\.pg-social-glyph \{[^}]*width: 18px;[^}]*height: 18px;[^}]*fill: none;[^}]*stroke: currentcolor;/,
    );
    expect(css).toMatch(/\.pg-social-glyph-brand \{\s*fill: currentcolor;\s*stroke: none;\s*\}/);
  });

  it("the brand rule belongs to the social block's CSS: a page without a social block does not carry it", () => {
    const social = pageRulesCss(["social"]);
    expect(social).toContain(".pg-social-glyph-brand");
    expect(pageRulesCss(["link", "header", "text"])).not.toContain("pg-social-glyph");
  });

  it("holds the scans of M2-05 and M6-34: no color literal in the new rule, nothing but prefers-reduced-motion in @media, no --hl- reference", () => {
    const rule = css.slice(css.indexOf(".pg-social-glyph-brand"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(css).not.toMatch(/--hl-/);
    for (const media of css.matchAll(/@media[^{]*/g)) {
      expect(media[0]).toMatch(/prefers-reduced-motion/);
    }
  });
});

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

const iconFor = (platform: string, id: string): SocialIcon =>
  (platform === "email"
    ? { id, platform, address: "hello@maraokafor.com" }
    : { id, platform, url: `https://example.com/${platform}` }) as SocialIcon;

/** Two social blocks of eight (all sixteen platforms: fourteen brand marks, Email, Website). */
const SOCIAL_BLOCKS: Block[] = [
  {
    id: "social-row-m9a",
    type: "social",
    visible: true,
    icons: SOCIAL_PLATFORMS.slice(0, 8).map((p, i) => iconFor(p, `icon-a-0000${i}`)),
  },
  {
    id: "social-row-m9b",
    type: "social",
    visible: true,
    icons: SOCIAL_PLATFORMS.slice(8).map((p, i) => iconFor(p, `icon-b-0000${i}`)),
  },
];

/** A link block for each of the eight brand icons, plus one generic. */
const LINK_BLOCKS: Block[] = [...BRAND_LINK_ICONS, "mail" as LinkIconName].map(
  (name, i): Block => ({
    id: `link-brand-0000${i}`,
    type: "link",
    visible: true,
    label: `Find me on ${name}`,
    url: `https://example.com/${name}`,
    icon: { type: "builtin", name },
  }),
);

const LINKS_BLOCK: Block = {
  id: "link-plain-0001",
  type: "link",
  visible: true,
  label: "Book a session",
  url: "https://example.com/book",
};

function fixtureDraft(): DraftDoc {
  return {
    version: 1,
    rev: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: [
      {
        id: "social-row-0001",
        type: "social",
        visible: true,
        icons: [
          { id: "icon-instagram", platform: "instagram", url: "https://instagram.com/mara" },
          { id: "icon-tiktok-01", platform: "tiktok", url: "https://tiktok.com/@mara" },
          { id: "icon-youtube-1", platform: "youtube", url: "https://youtube.com/@mara" },
          { id: "icon-email-001", platform: "email", address: "hello@maraokafor.com" },
        ],
      },
      LINKS_BLOCK,
    ],
  } as DraftDoc;
}

describe("M9-04 parity: the editor preview and the live page draw the same marks", () => {
  function rootHtml(markup: string): string {
    const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
    return doc.querySelector("[data-page-root]")!.outerHTML;
  }

  it.each([
    ["two social blocks, all sixteen platforms", SOCIAL_BLOCKS],
    ["a link block for each of the eight brand icons", LINK_BLOCKS],
  ] as const)(
    "%s: [data-page-root] is identical through PreviewBezel and the live builder",
    (_name, blocks) => {
      const draft = { ...fixtureDraft(), blocks: [...blocks] } as DraftDoc;
      const doc = toPublishForm(draft, noirTokens);
      provideEmbedFacade(EmbedFacade);
      const preview = renderToStaticMarkup(
        createElement(PreviewBezel, { doc, pageId: PAGE_ID, chrome: pageChrome("free", PAGE_ID) }),
      );
      provideEmbedFacade(EmbedFacadeMarkup);
      const live = renderLivePage({ pageId: PAGE_ID, document: doc, plan: "free", urls: null });
      expect(rootHtml(preview)).toBe(rootHtml(live));
      // Each anchor of the social blocks is named by its platform and goes through /r.
      if (blocks === SOCIAL_BLOCKS) {
        const parsed = new DOMParser().parseFromString(live, "text/html");
        const anchors = [...parsed.querySelectorAll(".pg-social-link")];
        expect(anchors).toHaveLength(16);
        anchors.forEach((anchor, index) => {
          const platform = SOCIAL_PLATFORMS[index]!;
          expect(anchor.getAttribute("aria-label")).toBe(SOCIAL_PLATFORM_LABELS[platform]);
          expect(anchor.getAttribute("href")).toMatch(
            platform === "email" ? /^mailto:/ : new RegExp(`^/r/${PAGE_ID}/icon-[ab]-0000\\d$`),
          );
        });
        expect(parsed.querySelectorAll(".pg-social-glyph-brand")).toHaveLength(14);
        expect(
          parsed.querySelectorAll(".pg-social-glyph:not(.pg-social-glyph-brand)"),
        ).toHaveLength(2);
      }
    },
  );
});

describe("M9-03 the editor's platform change", () => {
  it("changing a row from Email to a new platform clears the address and gives a URL field, and back", () => {
    const email = { id: "icon-chg-00001", platform: "email", address: "a@b.co" } as SocialIcon;
    const reddit = changeSocialPlatform(email, "reddit");
    expect(reddit).toEqual({ id: "icon-chg-00001", platform: "reddit", url: "" });
    const back = changeSocialPlatform(
      { ...reddit, url: "https://reddit.com/u/x" } as SocialIcon,
      "email",
    );
    expect(back).toEqual({ id: "icon-chg-00001", platform: "email", address: "" });
    const swap = changeSocialPlatform(
      { ...reddit, url: "https://reddit.com/u/x" } as SocialIcon,
      "discord",
    );
    expect(swap).toEqual({
      id: "icon-chg-00001",
      platform: "discord",
      url: "https://reddit.com/u/x",
    });
  });
});
