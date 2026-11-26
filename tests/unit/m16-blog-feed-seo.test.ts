import { describe, expect, it, vi } from "vitest";

/**
 * M16-06: the feed, the JSON-LD and the head of a post, with hostile titles. Both the feed and the
 * data block are written as strings by hand, so their escaping is tested here, not assumed.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
const getPrimaryDomain = vi.fn<(id: string) => Promise<string | null>>();
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain }));
vi.mock("@/app/(tenant)/published-page", () => ({ getTenantPageStateById: vi.fn() }));
vi.mock("@/lib/blog/published", () => ({}));
vi.mock("@/lib/site/published", () => ({}));

const { feedXml, xmlText, FEED_CONTENT_TYPE } = await import("@/lib/tenant-render/feed");
const { postJsonLd, blogPostingData } = await import("@/lib/tenant-render/post-json-ld");
const { postMetadata, siteOrigin, postTerms } = await import("@/lib/tenant-render/post-html");
const { metadataTags, renderHead } = await import("@/lib/tenant-render/head");
const { postFieldsOf, postHref, archiveHref, termHref } = await import("@/lib/blog/types");
const { plainExcerpt, readingMinutes, decodeEntities, bareUrlOf, lexMarkdown } =
  await import("@/lib/blog/markdown");

const HOSTILE = [
  "</script><script>alert(1)</script>",
  "]]><x>&amp;</x>",
  "a & b < c > d \" e ' f",
  "control \u0000\u0001\u0008\u000b\u001f\u007f chars",
  "line\u2028sep\u2029para",
  "<![CDATA[ x ]]>",
  "\ud800 lone surrogate \udfff",
  "<!-- comment --> <?xml version='1.0'?>",
  "&lt;already&gt;",
];

const post = (title: string, n = 1) => ({
  slug: `post-${n}`,
  title,
  excerpt: `Excerpt ${title}`,
  publishedAt: "2026-11-20T10:00:00.000Z",
});

describe("the feed", () => {
  it("is RSS 2.0 with title, link, guid, pubDate and excerpt per post, at most 20", () => {
    const xml = feedXml({
      origin: "https://example.com",
      archivePath: "blog",
      title: "Mara · Posts",
      description: "Notes",
      posts: Array.from({ length: 25 }, (_, i) => post(`Post ${i + 1}`, i + 1)),
    });
    expect(
      xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'),
    ).toBe(true);
    expect(xml).toContain("<link>https://example.com/blog</link>");
    expect(xml.match(/<item>/g)).toHaveLength(20);
    expect(xml).toContain(
      "<item><title>Post 1</title><link>https://example.com/blog/post-1</link>" +
        '<guid isPermaLink="true">https://example.com/blog/post-1</guid>' +
        "<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>" +
        "<description>Excerpt Post 1</description></item>",
    );
    expect(xml).not.toContain("post-21");
    expect(FEED_CONTENT_TYPE).toBe("application/rss+xml; charset=utf-8");
  });

  it.each(HOSTILE)("a hostile title %j cannot close an element or break the document", (title) => {
    const xml = feedXml({
      origin: "https://example.com",
      archivePath: "blog",
      title,
      description: title,
      posts: [post(title)],
    });
    // Without the declaration, the only `<` in the document open the tags this module writes.
    const tags = [...xml.slice(xml.indexOf("\n") + 1).matchAll(/<\/?([a-zA-Z!?][^\s>]*)/g)].map(
      (m) => m[1],
    );
    expect(new Set(tags)).toEqual(
      new Set(["rss", "channel", "title", "link", "description", "item", "guid", "pubDate"]),
    );
    expect(xml).not.toContain("]]>");
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff￾￿]/);
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });

  it("xmlText escapes the five characters and drops what XML 1.0 forbids", () => {
    expect(xmlText(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
    expect(xmlText("x\u0000y\u0008z\ud800")).toBe("xyz");
    expect(xmlText("tab\tnl\n😀")).toBe("tab\tnl\n😀");
  });

  it("a post whose slug cannot be linked is left out, and a bad archive path links nothing", () => {
    const xml = feedXml({
      origin: "https://example.com",
      archivePath: "blog",
      title: "t",
      description: "d",
      posts: [{ ...post("Bad"), slug: "../x" }, { ...post("Bad2"), slug: "page" }, post("Good", 2)],
    });
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(xml).not.toContain("Bad");
    const none = feedXml({
      origin: "https://e.com",
      archivePath: "//evil",
      title: "t",
      description: "d",
      posts: [post("x")],
    });
    expect(none).not.toContain("<item>");
    expect(none).not.toContain("evil");
  });
});

describe("the BlogPosting data block", () => {
  it("holds headline, dates, image and mainEntityOfPage", () => {
    expect(
      blogPostingData({
        headline: "Hello",
        datePublished: "2026-11-01T00:00:00Z",
        dateModified: "2026-11-02T00:00:00Z",
        image: "https://example.com/i.webp",
        url: "https://example.com/blog/hello",
      }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "Hello",
      datePublished: "2026-11-01T00:00:00.000Z",
      dateModified: "2026-11-02T00:00:00.000Z",
      image: ["https://example.com/i.webp"],
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://example.com/blog/hello" },
    });
  });

  it.each(HOSTILE)(
    "a hostile headline %j is escaped, parses back, and passes the head's own check",
    (headline) => {
      const json = postJsonLd({
        headline,
        datePublished: "2026-11-01T00:00:00Z",
        dateModified: "not a date",
        image: null,
        url: "https://example.com/blog/x?a=1&b=<2>",
      });
      expect(json).not.toMatch(/[<>&\u2028\u2029]/);
      const parsed = JSON.parse(json) as {
        headline: string;
        dateModified?: string;
        mainEntityOfPage: { "@id": string };
      };
      // eslint-disable-next-line no-control-regex
      expect(parsed.headline).toBe(headline.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim());
      expect(parsed.dateModified).toBeUndefined();
      expect(parsed.mainEntityOfPage["@id"]).toBe("https://example.com/blog/x?a=1&b=<2>");
      const head = renderHead({ metadata: { title: "t" }, css: "", jsonLd: json });
      expect(head.match(/<script/g)).toHaveLength(1);
      expect(head).toContain('<script type="application/ld+json">');
    },
  );

  it("cuts a long headline at 110 characters", () => {
    const data = blogPostingData({
      headline: "x".repeat(300),
      datePublished: "",
      dateModified: "",
      image: null,
      url: "u",
    });
    expect((data.headline as string).length).toBe(110);
  });
});

describe("the head of a post", () => {
  const fields = (over: Record<string, unknown> = {}) =>
    postFieldsOf({
      title: "My post",
      slug: "my-post",
      body: "The **body** text.",
      ...over,
    } as never);

  it("falls back from the SEO title and description to the title, the excerpt, then the body", () => {
    const plain = postMetadata({
      post: fields(),
      profileName: "Mara",
      url: "https://e.com/blog/my-post",
      image: null,
    });
    expect(plain.title).toBe("My post · Mara");
    expect(plain.description).toBe("The body text.");
    expect(plain.alternates).toEqual({ canonical: "https://e.com/blog/my-post" });
    expect(plain.robots).toBeUndefined();
    const excerpt = postMetadata({
      post: fields({ excerpt: "An excerpt" }),
      profileName: "",
      url: null,
      image: null,
    });
    expect(excerpt.title).toBe("My post");
    expect(excerpt.description).toBe("An excerpt");
    expect(excerpt.alternates).toBeUndefined();
    expect(excerpt.openGraph).toBeUndefined();
    const seo = postMetadata({
      post: fields({
        excerpt: "An excerpt",
        seo: { title: "SEO title", description: "SEO text", noindex: true },
      }),
      profileName: "Mara",
      url: "https://e.com/blog/my-post",
      image: { url: "https://e.com/media/x.webp", width: 1200, height: 800 },
    });
    expect(seo.title).toBe("SEO title");
    expect(seo.description).toBe("SEO text");
    expect(seo.robots).toEqual({ index: false });
    const tags = metadataTags(seo);
    expect(tags).toContain('<meta name="robots" content="noindex">');
    expect(tags).toContain('<link rel="canonical" href="https://e.com/blog/my-post">');
    expect(tags).toContain('<meta property="og:image" content="https://e.com/media/x.webp">');
    expect(tags).toContain('<meta property="og:type" content="article">');
  });

  it("a hostile title is escaped in every tag", () => {
    const tags = metadataTags(
      postMetadata({
        post: fields({ title: `"><script>alert(1)</script>`, excerpt: `"><img src=x>` }),
        profileName: "Mara",
        url: "https://e.com/blog/my-post",
        image: null,
      }),
    );
    expect(tags).not.toMatch(/<script|<img/);
  });

  it("the canonical is on the primary host: the custom domain when there is one, else the handle host", async () => {
    getPrimaryDomain.mockResolvedValue(null);
    expect(await siteOrigin("site", "mara")).toBe("http://mara.localhost:3000");
    expect(await siteOrigin("site", null)).toBeNull();
    getPrimaryDomain.mockResolvedValue("links.example.org");
    expect(await siteOrigin("site", "mara")).toBe("http://links.example.org:3000");
    expect(await siteOrigin("site", null)).toBe("http://links.example.org:3000");
  });

  it("postTerms keeps the post's order and drops unknown ids and ids under the wrong taxonomy", () => {
    const index = [
      { id: "c1", taxonomy: "category" as const, slug: "news", name: "News" },
      { id: "t1", taxonomy: "tag" as const, slug: "a", name: "A" },
    ];
    expect(
      postTerms({ categoryIds: ["gone", "c1", "t1"], tagIds: ["t1", "c1"] }, index).map(
        (t) => t.id,
      ),
    ).toEqual(["c1", "t1"]);
  });
});

describe("the vetted hrefs and the Markdown helpers", () => {
  it("hrefs are built from checked parts only", () => {
    expect(postHref("blog", "my-post")).toBe("/blog/my-post");
    for (const [archive, slug] of [
      ["blog", "My"],
      ["blog", "a/b"],
      ["blog", "page"],
      ["blog", "feed.xml"],
      ["og", "x"],
      ["//e", "x"],
      ["blog", ""],
      ["blog", "x?y"],
      ["blog", "x#y"],
    ]) {
      expect(postHref(archive!, slug!), `${archive}/${slug}`).toBeNull();
    }
    expect(archiveHref("blog")).toBe("/blog");
    expect(archiveHref("blog", 1)).toBe("/blog");
    expect(archiveHref("blog", 2)).toBe("/blog/page/2");
    expect(archiveHref("blog", 0)).toBeNull();
    expect(archiveHref("blog", 2.5)).toBeNull();
    expect(archiveHref("blog", 10000)).toBeNull();
    expect(termHref("blog", "tag", "a-b", 3)).toBe("/blog/tag/a-b/page/3");
    expect(termHref("blog", "topic" as never, "a")).toBeNull();
    expect(termHref("blog", "tag", "A")).toBeNull();
  });

  it("plainExcerpt reads text only: no markup, no raw HTML, cut at a word", () => {
    expect(
      plainExcerpt(
        "# Title\n\nSome **bold** [link](https://x.com) and `code`.\n\n<script>alert(1)</script>",
      ),
    ).toBe("Title Some bold link and code.");
    const long = plainExcerpt("word ".repeat(100), 50);
    expect([...long].length).toBeLessThanOrEqual(50);
    expect(long.endsWith("…")).toBe(true);
    expect(plainExcerpt("")).toBe("");
  });

  it("readingMinutes is at least 1 and counts 200 words a minute", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("word ".repeat(200))).toBe(1);
    expect(readingMinutes("word ".repeat(201))).toBe(2);
    expect(readingMinutes("word ".repeat(1000))).toBe(5);
  });

  it("decodeEntities decodes once and leaves controls and unknown names alone", () => {
    expect(decodeEntities("&amp;lt; &#60; &#x3C; &unknown; &#0; &#1; &#xD800;")).toBe(
      "&lt; < < &unknown; &#0; &#1; &#xD800;",
    );
  });

  it("bareUrlOf is a paragraph that is exactly one bare URL", () => {
    const first = (markdown: string) => bareUrlOf(lexMarkdown(markdown)[0]!);
    expect(first("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(first("<https://youtu.be/abc>")).toBe("https://youtu.be/abc");
    expect(first("[x](https://youtu.be/abc)")).toBeNull();
    expect(first("see https://youtu.be/abc")).toBeNull();
    expect(first("# https://youtu.be/abc")).toBeNull();
  });
});
