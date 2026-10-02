// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TOKEN_KEYS, resolveTokens, tokenCssVarName } from "@/lib/theme";
import type { Block, LinkBlock, PublishDoc, SocialIcon } from "@/lib/document";
import { PageRenderer, type PageRendererProps } from "@/components/page/page-renderer";
import { initialsOf } from "@/components/page/initials";
import { mailtoLink, outboundHref } from "@/components/page/outbound";
import { blocks, fullPublished, noirTokens, photoRef } from "./fixtures/page-document";

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

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

function doc(overrides: Partial<PublishDoc> = {}, docBlocks: Block[] = []): PublishDoc {
  return {
    version: 1,
    profile: { name: "Mara Okafor", bio: "Photographer", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: noirTokens,
    blocks: docBlocks,
    ...overrides,
  };
}

function render(document: PublishDoc, props: Partial<Omit<PageRendererProps, "doc">> = {}): string {
  return renderToStaticMarkup(
    createElement(PageRenderer, { doc: document, pageId: PAGE_ID, mode: "live", ...props }),
  );
}

/** Parses the markup into a DOM, so assertions read attributes instead of matching strings. */
function dom(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

describe("M2-05 initials", () => {
  it.each([
    ["Mara Okafor", "MO"],
    ["Prince", "P"],
    ["jean claude van damme", "JD"],
    ["  mara   okafor  ", "MO"],
    ["", "?"],
    ["   ", "?"],
    ["Émile Zola", "ÉZ"],
    ["😀 Smile", "😀S"],
    ["O'Brien-Smith", "O"],
  ])("%j gives %j", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});

describe("M2-05 root and profile", () => {
  it("carries every token as a --t- variable on [data-page-root]", () => {
    const html = render(doc());
    const root = dom(html).querySelector("[data-page-root]") as HTMLElement;
    expect(root).not.toBeNull();
    const style = root.getAttribute("style") ?? "";
    for (const key of TOKEN_KEYS) expect(style).toContain(`${tokenCssVarName(key)}:`);
    expect(style).toContain("--t-bg:#16120E");
    expect(style).toContain("--t-text-muted:#A79E90");
    expect(style).not.toContain("--hl-");
    expect(root.getAttribute("data-density")).toBe("regular");
    expect(root.getAttribute("data-align")).toBe("center");
  });

  it("shows the photo with the display name as alt, or the initials without one", () => {
    const withPhoto = dom(
      render(doc({ profile: { name: "Mara Okafor", bio: "", photo: photoRef } })),
    );
    const img = withPhoto.querySelector(".pg-avatar img");
    expect(img?.getAttribute("alt")).toBe("Mara Okafor");
    expect(img?.getAttribute("src")).toBe(`https://media.test/page-media/${photoRef.path}`);
    expect(withPhoto.querySelector(".pg-avatar")?.textContent).toBe("");

    const without = dom(render(doc()));
    expect(without.querySelector(".pg-avatar img")).toBeNull();
    expect(without.querySelector(".pg-avatar")?.textContent).toBe("MO");
  });

  it("renders the name in one h1 and the bio in a p, and no empty element for either", () => {
    const full = dom(render(doc()));
    expect(full.querySelectorAll("h1")).toHaveLength(1);
    expect(full.querySelector("h1")?.textContent).toBe("Mara Okafor");
    expect(full.querySelector(".pg-bio")?.tagName).toBe("P");

    const bare = dom(render(doc({ profile: { name: "", bio: "", photo: null } })));
    expect(bare.querySelector("h1")).toBeNull();
    expect(bare.querySelector(".pg-bio")).toBeNull();
    expect(bare.querySelector(".pg-avatar")?.textContent).toBe("?");
  });

  it("escapes a hostile name: visible text, no element, no attribute", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = render(doc({ profile: { name: evil, bio: evil, photo: null } }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    const parsed = dom(html);
    expect(parsed.querySelector("h1")?.textContent).toBe(evil);
    expect(parsed.querySelector("img")).toBeNull();
  });
});

describe("M2-05 blocks", () => {
  it("renders the visible blocks in array order inside <main>, each with id and type", () => {
    const parsed = dom(render(fullPublished));
    const main = parsed.querySelector("main")!;
    const rendered = Array.from(main.children).map((el) => [
      el.getAttribute("data-block-id"),
      el.getAttribute("data-block-type"),
    ]);
    expect(rendered).toEqual(fullPublished.blocks.map((block) => [block.id, block.type]));
    expect(parsed.querySelectorAll("[data-block-id]")).toHaveLength(fullPublished.blocks.length);
  });

  it("puts data-item-id on social icons and grid cells", () => {
    const parsed = dom(render(fullPublished));
    const icons = Array.from(parsed.querySelectorAll("[data-block-type=social] [data-item-id]"));
    expect(icons.map((el) => el.getAttribute("data-item-id"))).toEqual([
      "icon-instagram",
      "icon-threads-1",
      "icon-email-001",
    ]);
    const cells = Array.from(parsed.querySelectorAll("[data-block-type=grid] [data-item-id]"));
    expect(cells.map((el) => el.getAttribute("data-item-id"))).toEqual([
      "cell-prints-01",
      "cell-works-001",
    ]);
  });

  it("skips hidden blocks and renders an unknown type as nothing, without throwing", () => {
    const hidden = { ...blocks.header, id: "hidden-block-1", text: "Secret", visible: false };
    const unknown = { id: "unknown-blk-1", type: "carousel", visible: true } as unknown as Block;
    const html = render(doc({}, [blocks.header, hidden, unknown, blocks.divider]));
    expect(html).not.toContain("Secret");
    expect(html).not.toContain("unknown-blk-1");
    const ids = Array.from(dom(html).querySelectorAll("[data-block-id]")).map((el) =>
      el.getAttribute("data-block-id"),
    );
    expect(ids).toEqual([blocks.header.id, blocks.divider.id]);
  });

  it("renders the same markup in preview and live mode for a complete page", () => {
    const chrome = { badge: true, reportHref: `/report?page=${PAGE_ID}` };
    expect(render(fullPublished, { mode: "preview", chrome })).toBe(
      render(fullPublished, { mode: "live", chrome }),
    );
  });

  it("never emits raw HTML: a hostile value in every text field stays text", () => {
    const evil = "<script>alert(1)</script>";
    const html = render(
      doc({}, [
        { ...blocks.link, label: evil },
        { ...blocks.header, text: evil },
        { ...blocks.text, text: evil },
        { ...blocks.card, title: evil, caption: evil, image: null },
        { ...blocks.grid, cells: blocks.grid.cells.map((c) => ({ ...c, title: evil })) },
        { ...blocks.embed, caption: evil },
      ]),
    );
    expect(html).not.toContain("<script>");
    expect(dom(html).querySelectorAll("script")).toHaveLength(0);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("M2-05 outbound links", () => {
  it("outboundHref returns the validated URL and the one rel", () => {
    const target = { pageId: PAGE_ID, id: "block-id-001" };
    expect(outboundHref("https://example.com/x", target)).toEqual({
      href: "https://example.com/x",
      rel: "nofollow noopener",
    });
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example",
      "",
      "x",
      null,
    ]) {
      expect(outboundHref(bad, target).href).toBeUndefined();
    }
    expect(outboundHref("https://u:p@example.com", target).href).toBeUndefined();
  });

  it("mailtoLink builds mailto: for a valid address only", () => {
    expect(mailtoLink("hello@maraokafor.com")).toEqual({
      href: "mailto:hello@maraokafor.com",
      rel: "nofollow noopener",
    });
    expect(mailtoLink("a@b.co?subject=x").href).toBeUndefined();
    expect(mailtoLink("").href).toBeUndefined();
  });

  it("every anchor on a full page has rel nofollow noopener except the footer's", () => {
    const parsed = dom(
      render(fullPublished, { chrome: { badge: true, reportHref: "/report?page=x" } }),
    );
    const anchors = Array.from(parsed.querySelectorAll("main a"));
    expect(anchors.length).toBeGreaterThan(5);
    for (const a of anchors) expect(a.getAttribute("rel")).toBe("nofollow noopener");
  });
});

describe("M2-15 link block", () => {
  const link = (extra: Partial<LinkBlock> = {}): LinkBlock => ({ ...blocks.link, ...extra });

  it("renders one anchor with the label, the url and no target", () => {
    const parsed = dom(render(doc({}, [link()])));
    const a = parsed.querySelector("a[data-block-type=link]")!;
    expect(a.getAttribute("href")).toBe(blocks.link.url);
    expect(a.getAttribute("rel")).toBe("nofollow noopener");
    expect(a.textContent).toBe(blocks.link.label);
    expect(a.hasAttribute("target")).toBe(false);
  });

  it.each(["", "   ", "javascript:alert(1)", "maraokafor.com/x", "data:text/html,hi"])(
    "renders without href for the url %j (a draft)",
    (url) => {
      const a = dom(render(doc({}, [link({ url })]))).querySelector("a[data-block-type=link]")!;
      expect(a.hasAttribute("href")).toBe(false);
    },
  );

  it("escapes a hostile label", () => {
    const html = render(doc({}, [link({ label: "<img src=x onerror=alert(1)>" })]));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("sets data-button-style from the token and lets a block override win", () => {
    const fill = { ...noirTokens, buttonStyle: "fill" as const };
    const plain = dom(render(doc({ tokens: fill }, [link()]))).querySelector("a")!;
    expect(plain.getAttribute("data-button-style")).toBe("fill");
    expect(plain.getAttribute("style")).toBeNull();

    const pill = dom(
      render(doc({ tokens: fill }, [link({ overrides: { buttonStyle: "pill" } })])),
    ).querySelector("a")!;
    expect(pill.getAttribute("data-button-style")).toBe("pill");
  });

  it("applies only the overridden keys as --t- variables on the block", () => {
    const a = dom(
      render(doc({}, [link({ overrides: { accent: "#9DB3C4", radius: 4, buttonStyle: "soft" } })])),
    ).querySelector("a")!;
    const style = a.getAttribute("style") ?? "";
    expect(style).toContain("--t-accent:#9DB3C4");
    expect(style).toContain("--t-radius:4px");
    expect(style).toContain("--t-button-style:soft");
    expect(style).not.toContain("--t-bg");
    expect(style).not.toContain("--t-text:");
  });
});

describe("M2-16 header, text and divider", () => {
  it("renders an h2, a p that keeps line breaks and an hr", () => {
    const parsed = dom(render(doc({}, [blocks.header, blocks.text, blocks.divider])));
    expect(parsed.querySelector("h2[data-block-type=header]")?.textContent).toBe("Book a session");
    const text = parsed.querySelector("p[data-block-type=text]")!;
    expect(text.textContent).toBe(blocks.text.text);
    expect(text.textContent).toContain("\n");
    expect(parsed.querySelector("hr[data-block-type=divider]")).not.toBeNull();
    expect(parsed.querySelector("[data-block-type=text] a")).toBeNull();
  });

  it("does not turn urls or javascript: text into links", () => {
    const html = render(
      doc({}, [{ ...blocks.text, text: "javascript:alert(1) and https://example.com" }]),
    );
    const parsed = dom(html);
    expect(parsed.querySelector("[data-block-type=text] a")).toBeNull();
    expect(parsed.querySelector("[data-block-type=text]")?.textContent).toBe(
      "javascript:alert(1) and https://example.com",
    );
  });
});

describe("M2-17 social block", () => {
  const social = (icons: SocialIcon[]): Block => ({ ...blocks.social, icons });

  it("renders a labelled nav of anchors named after the platform, with mailto for email", () => {
    const parsed = dom(render(doc({}, [blocks.social])));
    const nav = parsed.querySelector("nav[data-block-type=social]")!;
    expect(nav.getAttribute("aria-label")).toBe("Social");
    const anchors = Array.from(nav.querySelectorAll("a"));
    expect(anchors.map((a) => a.getAttribute("aria-label"))).toEqual([
      "Instagram",
      "Threads",
      "Email",
    ]);
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
      "https://instagram.com/maraokafor",
      "https://www.threads.net/@maraokafor",
      "mailto:hello@maraokafor.com",
    ]);
    for (const a of anchors) {
      expect(a.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(a.textContent).toBe("");
    }
  });

  it("renders every platform's glyph", () => {
    const platforms = [
      "instagram",
      "tiktok",
      "youtube",
      "x",
      "facebook",
      "linkedin",
      "github",
      "threads",
      "website",
    ] as const;
    const icons = [
      ...platforms.map((platform, i) => ({
        id: `icon-plat-${i}`,
        platform,
        url: "https://example.com",
      })),
      { id: "icon-mail-01", platform: "email" as const, address: "a@b.co" },
    ];
    const parsed = dom(render(doc({}, [social(icons)])));
    const svgs = parsed.querySelectorAll("nav a svg");
    expect(svgs).toHaveLength(10);
    for (const svg of Array.from(svgs)) expect(svg.children.length).toBeGreaterThan(0);
  });

  it("drops the href of an icon with an unsafe url or a bad address", () => {
    const parsed = dom(
      render(
        doc({}, [
          social([
            { id: "icon-bad-url1", platform: "x", url: "javascript:alert(1)" },
            { id: "icon-bad-mail", platform: "email", address: "not an address" },
          ]),
        ]),
      ),
    );
    for (const a of Array.from(parsed.querySelectorAll("nav a"))) {
      expect(a.hasAttribute("href")).toBe(false);
    }
  });
});

describe("M2-18 grid block", () => {
  it("renders one anchor per cell with title and subtitle and the cell id", () => {
    const parsed = dom(render(doc({}, [blocks.grid])));
    const cells = Array.from(parsed.querySelectorAll("[data-block-type=grid] a"));
    expect(cells).toHaveLength(2);
    expect(cells[0]!.getAttribute("data-item-id")).toBe("cell-prints-01");
    expect(cells[0]!.getAttribute("href")).toBe("https://maraokafor.com/prints");
    expect(cells[0]!.textContent).toBe("PrintsShop the archive");
  });

  it("omits the subtitle element when empty and the href when the url is invalid", () => {
    const grid = {
      ...blocks.grid,
      cells: [
        { id: "cell-a-000001", title: "A", subtitle: "", url: "javascript:alert(1)" },
        { id: "cell-b-000001", title: "B", subtitle: "Sub", url: "https://example.com" },
      ],
    };
    const parsed = dom(render(doc({}, [grid])));
    const [a, b] = Array.from(parsed.querySelectorAll("[data-block-type=grid] a"));
    expect(a!.hasAttribute("href")).toBe(false);
    expect(a!.querySelector(".pg-cell-subtitle")).toBeNull();
    expect(b!.querySelector(".pg-cell-subtitle")?.textContent).toBe("Sub");
  });
});

describe("M2-21 card block", () => {
  it("is one anchor: a banner with the title, a footer with the caption and an aria-hidden arrow", () => {
    const parsed = dom(render(doc({}, [{ ...blocks.card, image: null }])));
    const card = parsed.querySelector("[data-block-type=card]")!;
    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toBe(blocks.card.url);
    expect(card.querySelectorAll("a")).toHaveLength(0);
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector(".pg-card-banner")?.hasAttribute("data-has-image")).toBe(false);
    expect(card.querySelector(".pg-card-title")?.textContent).toBe("Night Market");
    expect(card.querySelector(".pg-card-caption")?.textContent).toBe("View the gallery");
    const arrow = card.querySelector(".pg-card-arrow")!;
    expect(arrow.textContent).toBe("→");
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
  });

  it("defaults the caption to View and shows an uploaded image with an empty alt", () => {
    const parsed = dom(render(doc({}, [{ ...blocks.card, caption: "" }])));
    expect(parsed.querySelector(".pg-card-caption")?.textContent).toBe("View");
    const img = parsed.querySelector(".pg-card-banner img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toBe(
      `https://media.test/page-media/${blocks.card.image!.path}`,
    );
    expect(parsed.querySelector(".pg-card-banner")?.getAttribute("data-has-image")).toBe("true");
    expect(parsed.querySelector(".pg-card-title")?.textContent).toBe("Night Market");
  });

  it("renders without href for an invalid url and escapes the title", () => {
    const html = render(
      doc({}, [
        { ...blocks.card, url: "javascript:alert(1)", title: "<img src=x onerror=alert(1)>" },
      ]),
    );
    expect(dom(html).querySelector("[data-block-type=card]")?.hasAttribute("href")).toBe(false);
    expect(html).not.toContain("<img src=x");
  });
});

describe("M2-20 image block", () => {
  it("renders an img with size attributes, lazy loading and alt, linked when a url is set", () => {
    const parsed = dom(render(doc({}, [blocks.image])));
    const img = parsed.querySelector("[data-block-type=image] img")!;
    expect(img.getAttribute("src")).toBe(
      `https://media.test/page-media/${blocks.image.image!.path}`,
    );
    expect(img.getAttribute("width")).toBe(String(blocks.image.image!.width));
    expect(img.getAttribute("height")).toBe(String(blocks.image.image!.height));
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("alt")).toBe(blocks.image.alt);
    const link = parsed.querySelector("[data-block-type=image] a")!;
    expect(link.getAttribute("href")).toBe(blocks.image.url);
    expect(link.contains(img)).toBe(true);
  });

  it("has no anchor without a url", () => {
    const parsed = dom(render(doc({}, [{ ...blocks.image, url: "" }])));
    expect(parsed.querySelector("[data-block-type=image] a")).toBeNull();
    const none = dom(render(doc({}, [{ ...blocks.image, url: undefined }])));
    expect(none.querySelector("[data-block-type=image] a")).toBeNull();
  });

  it("shows a dashed placeholder in preview, nothing live, when no image is uploaded", () => {
    const empty = { ...blocks.image, image: null };
    const preview = dom(render(doc({}, [empty]), { mode: "preview" }));
    expect(preview.querySelector("[data-block-type=image]")?.textContent).toBe("Image");
    expect(preview.querySelector("img")).toBeNull();
    expect(
      dom(render(doc({}, [empty]), { mode: "live" })).querySelector("[data-block-id]"),
    ).toBeNull();
  });
});

describe("M2-19 embed block", () => {
  const yt = { ...blocks.embed };
  const sp = (kind: string) => ({
    ...blocks.embed,
    id: `embed-sp-${kind}`,
    url: `https://open.spotify.com/${kind}/37i9dQZF1DXcBWIGoYBM5M`,
    caption: "Studio playlist",
  });

  it("renders a YouTube facade: a play button, no iframe, and the caption with the provider", () => {
    const html = render(doc({}, [yt]));
    const parsed = dom(html);
    expect(parsed.querySelector("iframe")).toBeNull();
    const button = parsed.querySelector("[data-block-type=embed] button")!;
    expect(button.getAttribute("aria-label")).toBe("Play video: Behind the lens, ep. 4");
    expect(button.getAttribute("type")).toBe("button");
    expect(parsed.querySelector(".pg-embed-caption")?.textContent).toBe(
      "Behind the lens, ep. 4 · YouTube",
    );
    // No request to a third party before the click: no thumbnail, no preconnect, no script.
    expect(html).not.toMatch(/youtube\.com|youtube-nocookie|youtu\.be|google/);
    expect(html).not.toContain("ytimg");
    expect(html).not.toContain("<script");
  });

  it("names the button 'Play video' and the caption 'YouTube' when the caption is empty", () => {
    const parsed = dom(render(doc({}, [{ ...yt, caption: "" }])));
    expect(parsed.querySelector("button")?.getAttribute("aria-label")).toBe("Play video");
    expect(parsed.querySelector(".pg-embed-caption")?.textContent).toBe("YouTube");
  });

  it.each([
    ["track", 152],
    ["episode", 152],
    ["album", 352],
    ["playlist", 352],
    ["show", 352],
    ["artist", 352],
  ])("renders a lazy Spotify %s iframe %ipx tall from the rebuilt embed url", (kind, height) => {
    const parsed = dom(render(doc({}, [sp(kind)])));
    const frame = parsed.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(
      `https://open.spotify.com/embed/${kind}/37i9dQZF1DXcBWIGoYBM5M`,
    );
    expect(frame.getAttribute("height")).toBe(String(height));
    expect(frame.getAttribute("width")).toBe("100%");
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(frame.getAttribute("title")).toBe("Studio playlist (Spotify player)");
    expect(frame.getAttribute("allow")).toContain("encrypted-media");
    expect(parsed.querySelector("button")).toBeNull();
  });

  it("builds the iframe src from the parsed id, never from the typed url", () => {
    const tricky = {
      ...sp("track"),
      url: "https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M?x=%22%20onload%3Dalert(1)",
    };
    const frame = dom(render(doc({}, [tricky]))).querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(
      "https://open.spotify.com/embed/track/37i9dQZF1DXcBWIGoYBM5M",
    );
  });

  it.each([
    "https://evil.example/x",
    "https://vimeo.com/76979871",
    "https://www.youtube.com/@maraokafor",
    "https://youtube.com.evil.example/watch?v=jNQXAC9IVRw",
    "javascript:alert(1)",
    "",
  ])("renders nothing live and a placeholder in preview for %j", (url) => {
    const bad = { ...yt, url };
    const live = render(doc({}, [bad]), { mode: "live" });
    expect(dom(live).querySelector("[data-block-id]")).toBeNull();
    expect(live).not.toContain("<iframe");
    const preview = dom(render(doc({}, [bad]), { mode: "preview" }));
    expect(preview.querySelector("[data-block-type=embed]")?.textContent).toBe("Embed");
    expect(preview.querySelector("iframe")).toBeNull();
    expect(preview.querySelector("button")).toBeNull();
  });
});

describe("M2-05 footer slot", () => {
  const chrome = (badge: boolean, reportHref: string | null) => ({ badge, reportHref });

  it("renders the badge and the report link, in that order, after the blocks", () => {
    const parsed = dom(
      render(doc({}, [blocks.header]), { chrome: chrome(true, "/report?page=p1") }),
    );
    const footer = parsed.querySelector("footer")!;
    expect(footer.hasAttribute("data-block-id")).toBe(false);
    const links = Array.from(footer.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Made with HYDLNK", "Report this page"]);
    expect(links[0]!.getAttribute("href")).toBe("http://localhost:3000");
    expect(links[0]!.getAttribute("rel")).toBe("noopener");
    expect(links[1]!.getAttribute("href")).toBe("/report?page=p1");
    expect(parsed.querySelector("main")!.compareDocumentPosition(footer)).toBe(4); // follows
  });

  it("renders no footer when there is nothing to show, and one link when only one applies", () => {
    expect(dom(render(doc())).querySelector("footer")).toBeNull();
    expect(dom(render(doc(), { chrome: chrome(false, null) })).querySelector("footer")).toBeNull();
    const onlyReport = dom(render(doc(), { chrome: chrome(false, "/report?page=p1") }));
    expect(Array.from(onlyReport.querySelectorAll("footer a")).map((a) => a.textContent)).toEqual([
      "Report this page",
    ]);
    const onlyBadge = dom(render(doc(), { chrome: chrome(true, null) }));
    expect(Array.from(onlyBadge.querySelectorAll("footer a")).map((a) => a.textContent)).toEqual([
      "Made with HYDLNK",
    ]);
  });

  it("is not driven by the document: an unknown key in the published json changes nothing", () => {
    const sneaky = {
      ...doc(),
      settings: { hideReport: true, hideBadge: true },
    } as unknown as PublishDoc;
    const links = dom(render(sneaky, { chrome: chrome(true, "/report?page=p1") })).querySelectorAll(
      "footer a",
    );
    expect(links).toHaveLength(2);
  });

  it("resolves tokens for a default theme too (no theme row)", () => {
    const html = render(doc({ tokens: resolveTokens() }));
    expect(html).toContain("--t-bg:#F7F7F5");
  });
});

describe("M2-05 the stress fixture", () => {
  it("is a valid published document (so it can be published to a test page)", async () => {
    const { publishedDocSchema } = await import("@/lib/document");
    const { rendererFixtureDoc } = await import("@/components/page/fixture-doc");
    const result = publishedDocSchema.safeParse(rendererFixtureDoc());
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    const fixture = rendererFixtureDoc();
    expect(Array.from(fixture.profile.name)).toHaveLength(60);
    expect(fixture.profile.name).not.toMatch(/\s/);
  });
});
