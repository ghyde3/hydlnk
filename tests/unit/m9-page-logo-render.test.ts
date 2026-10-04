// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import {
  LOGO_PLACEMENTS,
  NAME_SIZES,
  draftDocSchema,
  toPublishForm,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { FONT_ALLOWLIST } from "@/lib/theme";
import { OWNER_UID, blocks, draftWith, noirTokens } from "./fixtures/page-document";

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

const { tenantInlineCss, pageFeaturesOf, pageRulesCss } = await import("@/lib/tenant-assets/css");
const { renderLivePage } = await import("@/lib/tenant-render/live-page");
const { tenantFontPreloads } = await import("@/lib/tenant-assets");

/**
 * M9-24: the logo and the name's own style in the shared profile component. One component draws
 * them for the live page and the editor preview; a page that uses none of the keys has exactly the
 * markup and the stylesheet it always had.
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b9";
const logo = { path: `${OWNER_UID}/logo-aaaaaaaa1111.webp`, width: 600, height: 200 };
const NAME = "Mara Okafor";

const draftOf = (profile: Record<string, unknown> = {}): DraftDoc =>
  draftDocSchema.parse({
    ...(draftWith(blocks.link) as object),
    profile: { name: NAME, bio: "Orlando, FL", photo: null, ...profile },
  }) as DraftDoc;
const formOf = (profile: Record<string, unknown> = {}, tokens = noirTokens): PublishDoc =>
  toPublishForm(draftOf(profile), tokens);
const draw = (doc: PublishDoc, mode: "live" | "preview" = "live"): string =>
  renderToStaticMarkup(createElement(PageRenderer, { doc, pageId: PAGE_ID, mode }));
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html");
const header = (html: string) => dom(html).querySelector("header.pg-profile")!;

describe("M9-24 a page that uses none of the keys is unchanged", () => {
  it("draws the profile exactly as before: the same classes, attributes and order", () => {
    const html = draw(formOf());
    expect(header(html).outerHTML).toBe(
      '<header class="pg-profile">' +
        '<div class="pg-avatar" data-profile-part="avatar" data-shape="circle" data-size="medium" data-border="page"><span aria-hidden="true">MO</span></div>' +
        '<h1 class="pg-name" data-profile-part="name">Mara Okafor</h1>' +
        '<p class="pg-bio" data-profile-part="bio">Orlando, FL</p>' +
        "</header>",
    );
    expect(html).not.toContain("pg-logo");
    expect(html).not.toContain("pg-name-");
    expect(html).not.toContain("--t-font-name");
  });

  it("stored defaults draw the same markup as none", () => {
    expect(draw(formOf({ nameSize: "medium", logoPlacement: "beside" }))).toBe(draw(formOf()));
  });

  it("the stylesheet of such a page has none of the new rules", () => {
    const css = tenantInlineCss({
      blocks: [{ type: "link" }],
      tokens: noirTokens,
      profile: {},
    });
    for (const marker of [
      ".pg-logo",
      ".pg-name-s",
      ".pg-name-l",
      ".pg-name-xl",
      ".pg-name-font",
      "--t-font-name",
    ]) {
      expect(css, marker).not.toContain(marker);
    }
    // And it is the same text whether or not the caller passes the (empty) profile.
    expect(css).toBe(tenantInlineCss({ blocks: [{ type: "link" }], tokens: noirTokens }));
    expect(pageFeaturesOf({ profile: {} })).toEqual([]);
    // The name rule itself is exactly what it was.
    expect(css).toContain(
      ".pg-name{max-width:100%;min-width:0;margin:8px 0 0;font-family:var(--t-font-heading);font-size:calc(40px * var(--t-scale));font-weight:var(--t-weight-heading);line-height:1.05;text-transform:var(--t-letter-case);overflow-wrap:anywhere}",
    );
  });
});

describe("M9-24 the logo, beside the name and instead of it", () => {
  it("beside (the default): a row with the logo (alt empty) and the name's h1 side by side", () => {
    const html = draw(formOf({ logo }));
    const row = header(html).querySelector(".pg-logo-row")!;
    expect([...row.children].map((el) => el.tagName)).toEqual(["IMG", "H1"]);
    const img = row.querySelector("img")!;
    expect(img.className).toBe("pg-logo");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toBe(`https://media.test/page-media/${logo.path}`);
    expect(img.getAttribute("width")).toBe("600");
    expect(img.getAttribute("height")).toBe("200");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(row.querySelector("h1")!.textContent).toBe(NAME);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("instead: the h1 holds the logo with the display name as its alt and no visible text", () => {
    const html = draw(formOf({ logo, logoPlacement: "instead" }));
    const h1 = header(html).querySelector("h1")!;
    expect(h1.className).toBe("pg-name");
    expect(h1.textContent).toBe("");
    const img = h1.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe(NAME);
    expect(img.className).toBe("pg-logo");
    expect(header(html).querySelector(".pg-logo-row")).toBeNull();
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it.each(LOGO_PLACEMENTS)(
    "%s: exactly one h1 whose accessible name is the display name, in every combination of the switches",
    (logoPlacement) => {
      for (const showName of [true, false]) {
        for (const showBio of [true, false]) {
          for (const showPhoto of [true, false]) {
            const html = draw(formOf({ logo, logoPlacement, showName, showBio, showPhoto }));
            const h1s = [...dom(html).querySelectorAll("h1")];
            expect(h1s, JSON.stringify({ showName, showBio, showPhoto })).toHaveLength(1);
            const h1 = h1s[0]!;
            const accessible =
              (h1.textContent || h1.querySelector("img")?.getAttribute("alt")) ?? "";
            expect(accessible).toBe(NAME);
            // The logo always shows (a hidden name keeps its heading for assistive technology).
            expect(dom(html).querySelectorAll("img.pg-logo")).toHaveLength(1);
          }
        }
      }
    },
  );

  it("a hidden name with a logo shows the logo alone, and the heading is the visually hidden one", () => {
    const html = draw(formOf({ logo, showName: false }));
    const h1 = dom(html).querySelector("h1")!;
    expect(h1.hasAttribute("data-visually-hidden")).toBe(true);
    expect(h1.textContent).toBe(NAME);
    const row = dom(html).querySelector(".pg-logo-row")!;
    expect(row.querySelector("h1")).toBeNull();
    expect(row.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("with every part hidden but the logo there is still a header, and with none at all only the hidden heading", () => {
    const only = draw(formOf({ logo, showName: false, showBio: false, showPhoto: false }));
    expect(dom(only).querySelector("header.pg-profile .pg-logo-row")).not.toBeNull();
    const none = draw(formOf({ showName: false, showBio: false, showPhoto: false }));
    expect(dom(none).querySelector("header.pg-profile")).toBeNull();
    expect(dom(none).querySelectorAll("h1")).toHaveLength(1);
  });

  it("an empty display name with a logo draws the logo and no heading", () => {
    const doc = formOf({ logo });
    const html = draw({ ...doc, profile: { ...doc.profile, name: "" } });
    expect(dom(html).querySelectorAll("h1")).toHaveLength(0);
    expect(dom(html).querySelectorAll("img.pg-logo")).toHaveLength(1);
  });

  it("a display name that is markup stays text, as visible text and as the alt", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    for (const logoPlacement of LOGO_PLACEMENTS) {
      const doc = formOf({ logo, logoPlacement });
      const html = draw({ ...doc, profile: { ...doc.profile, name: hostile } });
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(dom(html).querySelectorAll("img")).toHaveLength(1);
    }
  });

  it("the preview and the live page draw the same profile for each placement and size", () => {
    for (const logoPlacement of LOGO_PLACEMENTS) {
      for (const nameSize of NAME_SIZES) {
        const doc = formOf({ logo, logoPlacement, nameSize, nameFont: "Fraunces" });
        expect(header(draw(doc, "preview")).outerHTML).toBe(header(draw(doc, "live")).outerHTML);
      }
    }
  });
});

describe("M9-24 the name's size and font", () => {
  it.each([
    ["small", "pg-name pg-name-s"],
    ["medium", "pg-name"],
    ["large", "pg-name pg-name-l"],
    ["xlarge", "pg-name pg-name-xl"],
  ])("size %s is the class list '%s'", (nameSize, classes) => {
    expect(header(draw(formOf({ nameSize }))).querySelector("h1")!.className).toBe(classes);
  });

  it("the size class goes on the row too when a logo is beside the name (the logo follows the name's size)", () => {
    const row = header(draw(formOf({ logo, nameSize: "xlarge" }))).querySelector(".pg-logo-row")!;
    expect(row.className).toBe("pg-logo-row pg-name-xl");
    expect(header(draw(formOf({ logo }))).querySelector(".pg-logo-row")!.className).toBe(
      "pg-logo-row",
    );
  });

  it.each([...FONT_ALLOWLIST])(
    "name font %s: pg-name-font and its stack from the allowlist constant",
    (nameFont) => {
      const h1 = header(draw(formOf({ nameFont }))).querySelector<HTMLElement>("h1")!;
      expect(h1.className).toBe("pg-name pg-name-font");
      const style = h1.getAttribute("style") ?? "";
      expect(style).toMatch(
        new RegExp(`^--t-font-name:"${nameFont}", (sans-serif|serif|monospace);?$`),
      );
    },
  );

  it("a value outside the lists draws the default: no class, no style, nothing of the string", () => {
    const doc = formOf();
    const hostile = {
      ...doc,
      profile: {
        ...doc.profile,
        nameFont: "x;}</style><script>alert(1)</script>",
        nameSize: "huge",
        logoPlacement: "left",
        logo,
      },
    } as unknown as PublishDoc;
    const html = draw(hostile);
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("--t-font-name");
    expect(html).not.toContain("pg-name-");
    expect(dom(html).querySelector(".pg-logo-row")!.className).toBe("pg-logo-row");
  });

  it("the heading, the bio and the blocks keep their fonts: only the name's element is styled", () => {
    const html = draw(formOf({ nameFont: "Lora" }));
    expect((html.match(/--t-font-name/g) ?? []).length).toBe(1);
    expect(dom(html).querySelector(".pg-bio")!.getAttribute("style")).toBeNull();
  });
});

describe("M9-24 the stylesheet carries the rules only for what the page uses", () => {
  const css = (profile: Record<string, unknown>) =>
    tenantInlineCss({ blocks: [{ type: "link" }], tokens: noirTokens, profile });

  it("a logo brings the logo rules, and not the size or font rules", () => {
    const out = css({ logo });
    expect(out).toContain(".pg-logo-row");
    expect(out).toContain(".pg-logo{");
    expect(out).toContain("height:1.25em");
    expect(out).not.toContain(".pg-name-xl");
    expect(out).not.toContain(".pg-name-font");
  });

  it("a size brings its class rules (wide and narrow container), and a font brings pg-name-font", () => {
    const sized = css({ nameSize: "xlarge" });
    expect(sized).toContain(".pg-name-xl{font-size:calc(40px * 1.5 * var(--t-scale))}");
    expect(sized).toContain("calc(26px * 1.5 * var(--t-scale))");
    expect(sized).not.toContain(".pg-logo");
    const fonted = css({ nameFont: "Lora" });
    expect(fonted).toContain(".pg-name-font{font-family:var(--t-font-name)}");
  });

  it("a hostile style value adds no rule", () => {
    expect(css({ nameSize: "huge", nameFont: "Comic Sans" })).toBe(css({}));
    expect(pageFeaturesOf({ profile: { nameSize: "huge", nameFont: "x;}" } })).toEqual([]);
    expect(pageFeaturesOf({ profile: { nameSize: "small" } })).toEqual(["name-style"]);
    expect(pageFeaturesOf({ profile: { nameSize: "medium" } })).toEqual([]);
    expect(pageFeaturesOf({ profile: { logo } })).toEqual(["logo"]);
    expect(pageFeaturesOf({ banner: {}, profile: { logo, nameFont: "Lora" } })).toEqual([
      "banner",
      "logo",
      "name-style",
    ]);
  });

  it("uses tokens and container units only: no color literal, no viewport unit", () => {
    const added = pageRulesCss(["link"], ["logo", "name-style"]).replace(
      pageRulesCss(["link"]),
      "",
    );
    expect(added.length).toBeGreaterThan(0);
    expect(pageRulesCss(["link"], ["logo", "name-style"])).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|rgba?\(|\d(?:vw|vh)\b/,
    );
  });
});

describe("M9-24 the live page document", () => {
  const urls = { page: "http://mara.localhost:3000/", image: "http://mara.localhost:3000/og" };
  const live = (profile: Record<string, unknown>, tokens = noirTokens) =>
    renderLivePage({ pageId: PAGE_ID, document: formOf(profile, tokens), plan: "pro", urls });
  const style = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  const faces = (html: string) => (style(html).match(/@font-face/g) ?? []).length;
  const preloads = (html: string) => (html.match(/<link rel="preload" as="font"/g) ?? []).length;

  it("a page without the keys has the document it always had: two faces, two preloads", () => {
    const plain = live({});
    expect(preloads(plain)).toBe(2);
    expect(plain).not.toContain("pg-logo");
  });

  it("a name font equal to the heading font loads nothing extra", () => {
    const base = live({});
    const same = live({ nameFont: noirTokens.fontHeading });
    expect(faces(same)).toBe(faces(base));
    expect(preloads(same)).toBe(preloads(base));
  });

  it("a name font that is a third family adds exactly that family's latin file at the heading weight", () => {
    const base = live({});
    const third = live({ nameFont: "Fraunces" });
    expect(preloads(third)).toBe(preloads(base) + 1);
    expect(style(third)).toContain('font-family:"Fraunces"');
    expect(style(base)).not.toContain("Fraunces");
    const files = [...third.matchAll(/<link rel="preload" as="font" href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(files).size).toBe(files.length);
    expect(files.every((f) => f!.startsWith("/_t/f/"))).toBe(true);
    // No request but the page's own host.
    expect(/fonts\.(googleapis|gstatic)/.test(third)).toBe(false);
  });

  it("the preloads helper matches the rules: one latin face per family used", () => {
    expect(tenantFontPreloads({ ...noirTokens, nameFont: "Fraunces" }).length).toBe(
      tenantFontPreloads(noirTokens).length + 1,
    );
    expect(tenantFontPreloads({ ...noirTokens, nameFont: "Comic Sans" })).toEqual(
      tenantFontPreloads(noirTokens),
    );
  });

  it("a hostile nameFont writes no rule and no font request", () => {
    const doc = formOf({});
    const hostile = {
      ...doc,
      profile: { ...doc.profile, nameFont: "x;}</style><script>alert(1)</script>" },
    } as unknown as PublishDoc;
    const html = renderLivePage({ pageId: PAGE_ID, document: hostile, plan: "pro", urls });
    expect(html).not.toContain("alert(1)");
    expect(faces(html)).toBe(faces(live({})));
    expect(preloads(html)).toBe(2);
  });

  it("the logo is above the fold: React hoists an image preload for it into the head, once", () => {
    const html = live({ logo });
    expect((html.match(/<link rel="preload" as="image"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('class="pg-logo"');
    expect(html).toContain('loading="eager"');
  });
});
