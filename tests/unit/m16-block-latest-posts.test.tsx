import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BlockView } from "@/components/page/blocks";
import { PageRenderer } from "@/components/page/page-renderer";
import {
  BLOCK_TYPES,
  blockDefaults,
  draftDocSchema,
  publishedDocSchema,
  toPublishForm,
  type Block,
} from "@/lib/document";
import type { LatestPosts } from "@/lib/blog/types";
import { homeUsesSiteIndex, postsArchiveOf, usesLatestPosts } from "@/lib/site/live";
import { pageRulesCss, tenantInlineCss } from "@/lib/tenant-assets/css";
import { STYLE_SPECS } from "@/lib/themes/overrides";
import { fullDraft, fullPublished, noirTokens } from "./fixtures/page-document";

/**
 * M16-07: the Latest posts block. The schema's accepts and refuses, the renderer's output for
 * three posts (text escaped, hrefs from the vetted builder, block overrides applied), nothing on a
 * live page while the blog is off or empty, and the tags that make a post's publish refresh a Home
 * and a sub-page that hold the block.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));

const CATEGORY = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const block = (over: Record<string, unknown> = {}) => ({
  id: "latest-posts-001",
  type: "latest_posts",
  visible: true,
  count: 3,
  ...over,
});
const post = (n: number, over: Partial<LatestPosts["posts"][number]> = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  slug: `post-${n}`,
  title: `Post ${n}`,
  excerpt: "",
  publishedAt: `2026-11-1${n}T10:00:00.000Z`,
  featuredImage: null,
  categoryIds: n % 2 === 0 ? [CATEGORY] : [],
  ...over,
});
const latest = (posts = [post(5), post(4), post(3), post(2), post(1)]): LatestPosts => ({
  archivePath: "blog",
  posts,
});
const draw = (
  raw: Record<string, unknown>,
  site: { latestPosts?: LatestPosts | null } | undefined,
  extra: Record<string, unknown> = {},
) =>
  renderToStaticMarkup(
    <BlockView
      block={raw as never}
      ctx={{
        pageId: "00000000-0000-4000-8000-0000000000b1",
        tokens: noirTokens,
        mode: "live",
        ...(site ? { site: { hrefs: {}, ...site } } : {}),
        ...extra,
      }}
    />,
  );

const docWith = (raw: Record<string, unknown>) => ({ ...fullDraft, blocks: [raw] });

describe("the schema", () => {
  it("is a block type with a default, a label and style controls", () => {
    expect(BLOCK_TYPES).toContain("latest_posts");
    expect(blockDefaults.latest_posts()).toMatchObject({ type: "latest_posts", count: 3 });
    expect(STYLE_SPECS.latest_posts.controls).toEqual(["color", "radius"]);
  });

  it.each([
    [{}, true],
    [{ heading: "From the blog" }, true],
    [{ count: 1 }, true],
    [{ count: 6 }, true],
    [{ categoryId: CATEGORY }, true],
    [{ count: 0 }, false],
    [{ count: 7 }, false],
    [{ count: 2.5 }, false],
    [{ count: "3" }, false],
    [{ categoryId: "not-a-uuid" }, false],
    [{ categoryId: "javascript:alert(1)" }, false],
    [{ heading: "x".repeat(81) }, false],
    [{ id: "short" }, false],
  ])("%j -> %s (draft and publish agree)", (over, ok) => {
    expect(draftDocSchema.safeParse(docWith(block(over))).success).toBe(ok);
    const published = { ...fullPublished, blocks: [block(over)] };
    expect(publishedDocSchema.safeParse(published).success).toBe(ok);
  });

  it("publish refuses control characters in the heading; a missing count is the default", () => {
    const published = { ...fullPublished, blocks: [block({ heading: "a\u0007b" })] };
    expect(publishedDocSchema.safeParse(published).success).toBe(false);
    const { count: _count, ...rest } = block();
    void _count;
    const parsed = draftDocSchema.parse(docWith(rest));
    expect((parsed.blocks[0] as { count: number }).count).toBe(3);
  });

  it("toPublishForm keeps heading, count, category and valid overrides, and nothing else", () => {
    const form = toPublishForm(
      draftDocSchema.parse(
        docWith(
          block({
            heading: "  From the blog  ",
            count: 4,
            categoryId: CATEGORY.toUpperCase(),
            overrides: { text: "#C46A4F" },
          }),
        ),
      ),
      noirTokens,
    );
    expect(form.blocks[0]).toEqual({
      id: "latest-posts-001",
      type: "latest_posts",
      visible: true,
      heading: "From the blog",
      count: 4,
      categoryId: CATEGORY,
      overrides: { text: "#C46A4F" },
    });
    const bare = toPublishForm(draftDocSchema.parse(docWith(block({ heading: "  " }))), noirTokens);
    expect(bare.blocks[0]).toEqual({
      id: "latest-posts-001",
      type: "latest_posts",
      visible: true,
      count: 3,
    });
  });
});

describe("the renderer", () => {
  it("draws the newest three posts as links to their pages, with the heading and dates", () => {
    const html = draw(block({ heading: "From the blog" }), { latestPosts: latest() });
    expect(html).toBe(
      '<div class="pg-latest hl-latest-posts" data-block-id="latest-posts-001" data-block-type="latest_posts">' +
        '<h2 class="pg-latest-heading">From the blog</h2><ul class="pg-latest-list">' +
        [5, 4, 3]
          .map(
            (n) =>
              `<li class="pg-latest-item"><a class="pg-latest-link" href="/blog/post-${n}">` +
              `<span class="pg-latest-title">Post ${n}</span>` +
              `<time class="pg-latest-date" dateTime="2026-11-1${n}T10:00:00.000Z">Nov 1${n}, 2026</time></a></li>`,
          )
          .join("") +
        "</ul></div>",
    );
    expect(html).not.toContain("/r/");
  });

  it("count and category choose the posts", () => {
    expect(draw(block({ count: 1 }), { latestPosts: latest() }).match(/<li/g)).toHaveLength(1);
    expect(draw(block({ count: 6 }), { latestPosts: latest() }).match(/<li/g)).toHaveLength(5);
    const news = draw(block({ count: 6, categoryId: CATEGORY }), { latestPosts: latest() });
    expect(news.match(/<li/g)).toHaveLength(2);
    expect(news).toContain("/blog/post-4");
    expect(news).toContain("/blog/post-2");
    expect(draw(block({ categoryId: OTHER }), { latestPosts: latest() })).toBe("");
    // A count planted outside the schema is clamped, never trusted.
    expect(draw(block({ count: 999 }), { latestPosts: latest() }).match(/<li/g)).toHaveLength(5);
    expect(draw(block({ count: -1 }), { latestPosts: latest() }).match(/<li/g)).toHaveLength(1);
  });

  it("titles are text; a slug or an archive path that is no path makes no link", () => {
    const hostile = latest([
      post(1, { title: '<img src=x onerror="alert(1)">' }),
      post(2, { slug: "javascript:alert(1)" }),
      post(3, { slug: "../../admin" }),
      post(4, { slug: "page" }),
    ]);
    const html = draw(block({ count: 6, heading: "<script>x</script>" }), { latestPosts: hostile });
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).not.toMatch(/javascript:|\.\.\//);
    const badArchive = draw(block(), {
      latestPosts: { archivePath: "//evil.example", posts: [post(1)] },
    });
    expect(badArchive).toBe("");
  });

  it("draws nothing on a live page when the blog is off, has no posts, or the page has no site", () => {
    expect(draw(block(), { latestPosts: null })).toBe("");
    expect(draw(block(), { latestPosts: latest([]) })).toBe("");
    expect(draw(block(), {})).toBe("");
    expect(draw(block(), undefined)).toBe("");
  });

  it("the editor preview shows a hint instead", () => {
    const off = draw(block(), { latestPosts: null }, { mode: "preview" });
    expect(off).toContain('class="pg-placeholder"');
    expect(off).toContain("turn on the blog");
    const empty = draw(block(), { latestPosts: latest([]) }, { mode: "preview" });
    expect(empty).toContain("publish a post");
  });

  it("block overrides arrive as inline variables on the block's own root; a bad one is left out", () => {
    const html = draw(block({ overrides: { text: "#C46A4F", border: "red; background:url(x)" } }), {
      latestPosts: latest(),
    });
    expect(html).toMatch(/^<div class="pg-latest hl-latest-posts"[^>]* style="--t-text:#C46A4F"/);
    expect(html).not.toContain("url(x)");
  });

  it("in a thumbnail and in the share preview the posts are text, not links", () => {
    for (const extra of [{ thumbnail: true }, { inertLinks: true }]) {
      const html = draw(block(), { latestPosts: latest() }, extra);
      expect(html).not.toMatch(/<a\b/);
      expect(html).toContain("Post 5");
    }
  });

  it("PageRenderer hands the site's posts to the block on Home and on a sub-page", () => {
    const doc = { ...fullPublished, blocks: [block()] as unknown as Block[] };
    const home = renderToStaticMarkup(
      <PageRenderer doc={doc} pageId="p" mode="live" site={{ hrefs: {}, latestPosts: latest() }} />,
    );
    expect(home).toContain('href="/blog/post-5"');
    const sub = renderToStaticMarkup(
      <PageRenderer
        doc={fullPublished}
        pageId="p"
        mode="live"
        site={{ hrefs: {}, latestPosts: latest() }}
        subPage={{ title: "News", blocks: [block()] as unknown as Block[] }}
      />,
    );
    expect(sub).toContain('href="/blog/post-5"');
  });
});

describe("the page carries the block's rules, and only then", () => {
  it("tokens only, at least 44px tall, and absent from a page without the block", () => {
    const css = pageRulesCss(["latest_posts"]);
    expect(css).toContain(".pg-latest-link{");
    expect(/\.pg-latest-link\{[^}]*min-height:44px/.test(css)).toBe(true);
    expect(pageRulesCss(["link"])).not.toContain("pg-latest");
    expect(tenantInlineCss({ blocks: [{ type: "latest_posts" }], tokens: noirTokens })).toContain(
      "pg-latest",
    );
    const rules = css.match(/[^}]*pg-latest[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of rules) expect(rule).not.toMatch(/--hl-/);
  });

  it("a post page and an archive page carry their rules only when asked", () => {
    expect(pageRulesCss([], ["post"])).toContain(".pg-post-body");
    expect(pageRulesCss([], ["archive"])).toContain(".pg-archive-card");
    const plain = pageRulesCss(["link"]);
    expect(plain).not.toContain("pg-post");
    expect(plain).not.toContain("pg-archive");
    expect(pageRulesCss([], ["post"])).not.toMatch(/--hl-/);
    // An embed in a post brings the embed rules; a post without one does not.
    expect(pageRulesCss([], ["post"])).not.toContain("pg-embed-play");
    expect(pageRulesCss(["embed"], ["post"])).toContain("pg-embed-play");
  });
});

describe("a post's publish refreshes a Home and a sub-page that hold the block", () => {
  it("Home reads the site index (and so the newest posts) when it holds the block", () => {
    expect(homeUsesSiteIndex({ blocks: [block()] as never })).toBe(true);
    expect(homeUsesSiteIndex({ blocks: [] })).toBe(false);
    expect(usesLatestPosts([{ type: "link" }, { type: "latest_posts" }])).toBe(true);
    expect(usesLatestPosts([{ type: "link" }])).toBe(false);
  });

  it("the block lists the Post type's archive, never another type's", () => {
    const archive = (key: string, typeId: string) => ({
      typeId,
      key,
      path: key,
      label: key,
      labelPlural: key,
      pageSize: 10,
    });
    expect(postsArchiveOf([archive("recipes", "a"), archive("post", "b")])?.typeId).toBe("b");
    expect(postsArchiveOf([archive("recipes", "a")])).toBeNull();
    expect(postsArchiveOf([])).toBeNull();
  });

  it("a sub-page's cached HTML also carries the type's tag when it holds the block", async () => {
    vi.doMock("next/cache", () => ({ unstable_cache: vi.fn() }));
    vi.doMock("@/app/(tenant)/published-page", () => ({ getTenantPageStateById: vi.fn() }));
    vi.doMock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn() }));
    vi.doMock("@/lib/site/published", () => ({}));
    const { subPageHtmlOptions } = await import("@/lib/tenant-render/sub-page-html");
    expect(subPageHtmlOptions("site").tags).toEqual(["page:site"]);
    expect(subPageHtmlOptions("site", "type").tags).toEqual(["page:site", "type:type"]);
  });

  it("the latest-posts read is cached under the type's tag (a static Home inherits it)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/blog/published.ts", "utf8");
    expect(source).toMatch(
      /readLatestPosts,\s*\["tenant-latest-posts", PUBLIC_READ_CACHE_VERSION, typeId\],\s*\[typeTag\(typeId\), pageTag\(siteId\)\]/,
    );
    const respond = readFileSync("src/lib/tenant-render/respond.ts", "utf8");
    expect(respond).toMatch(
      /getLiveSiteContext\(page\.pageId, page\.document, "home", page\.document\.blocks\)/,
    );
    expect(respond).toMatch(
      /pagesWithPostLists\.includes\(entry\.id\) \? postsArchiveOf\(archives\) : null/,
    );
  });
});
