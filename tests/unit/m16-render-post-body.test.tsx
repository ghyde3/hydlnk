import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M16-04: a post body is Markdown drawn as React elements. Tenant content is untrusted, so the
 * renderer is tested with hostile input: what `published` holds is never assumed to have passed the
 * publish check.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  },
}));

const { PostBody, ownMediaSrc } = await import("@/components/post/post-body");
const { PostArticle } = await import("@/components/post/post-article");
const { lexBounded, MARKDOWN_MAX_NODES } = await import("@/lib/blog/markdown");

const OWNER = "0a0a0a0a-0000-4000-8000-000000000001";
const OTHER = "0b0b0b0b-0000-4000-8000-000000000002";
const STORAGE = "http://127.0.0.1:54321/storage/v1/object/public/page-media";
const OWN_IMAGE = `${STORAGE}/${OWNER}/0123456789abcdef0123456789abcdef.webp`;

const draw = (markdown: string, embeds: "facade" | "inert" = "facade") =>
  renderToStaticMarkup(<PostBody markdown={markdown} ownerId={OWNER} embeds={embeds} />);

/** Every tag name in the markup. */
const tags = (html: string) => [...html.matchAll(/<([a-z][a-z0-9]*)\b/g)].map((m) => m[1]!);
/** Every attribute name in the markup. */
const attributeNames = (html: string) =>
  [...html.matchAll(/<[a-z][a-z0-9]*((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/g)].flatMap((m) =>
    [...m[1]!.matchAll(/\s([a-z-]+)(?:=|\s|$)/g)].map((a) => a[1]!),
  );

const ALLOWED_TAGS = new Set([
  "div",
  "p",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
  "br",
  "strong",
  "em",
  "del",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "span",
  "button",
  "svg",
  "path",
]);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
});

describe("PostBody: raw HTML is text", () => {
  const HOSTILE = [
    "<script>alert(1)</script>",
    "text <script>alert(1)</script> more",
    '<img src=x onerror="alert(1)">',
    "<iframe src=https://evil.example></iframe>",
    '<a href="javascript:alert(1)">x</a>',
    "<style>body{display:none}</style>",
    "<svg onload=alert(1)>",
    '<div onclick="x()">\n\n**inside**\n\n</div>',
    "<!-- comment --><b>bold</b>",
    "| a |\n|---|\n| <table><tr><td><script>x</script></td></tr></table> |",
    "> <script>alert(1)</script>",
    "- <img src=x onerror=alert(1)>",
    "# <script>alert(1)</script>",
    "`<script>` and\n\n```html\n<script>alert(1)</script>\n```",
    "<p>ok</p></div></main><script src=//evil.example/x.js></script>",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
    '<input autofocus onfocus="alert(1)">',
    "<meta http-equiv=refresh content=0;url=https://evil.example>",
    "<form action=https://evil.example><button>go</button></form>",
    "<base href=https://evil.example/>",
    "<object data=x></object><embed src=x>",
  ];

  it.each(HOSTILE)("%j draws no element of its own", (markdown) => {
    const html = draw(markdown);
    for (const tag of tags(html)) expect(ALLOWED_TAGS.has(tag), `${tag} in ${html}`).toBe(true);
    expect(html).not.toMatch(/<script|<iframe|<style|<form|<input|<meta|<base|<object|<embed/i);
    for (const name of attributeNames(html)) {
      expect(name.startsWith("on"), `${name} in ${html}`).toBe(false);
      expect(["srcdoc", "style", "action", "formaction"].includes(name), name).toBe(false);
    }
  });

  it("shows the HTML source as text, escaped", () => {
    const html = draw("before <script>alert(1)</script> after\n\n<div onclick=x>raw</div>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;/script&gt;");
    expect(html).toContain("&lt;div onclick=x&gt;raw&lt;/div&gt;");
  });

  it("no token type reaches the page unhandled: an unknown token is its raw text", () => {
    const html = draw("Term[^1]\n\n[^1]: note\n\n$$x<y$$\n\n:::warning\n<b>x</b>\n:::");
    for (const tag of tags(html)) expect(ALLOWED_TAGS.has(tag), tag).toBe(true);
    expect(html).not.toContain("<b>");
  });
});

describe("PostBody: links are http and https only", () => {
  const BAD = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/x",
    "/relative",
    "mailto:me@example.com",
    "tel:+15551234",
    "blob:https://x/y",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "javascript&colon;alert(1)",
    "https://user:pass@evil.example/",
  ];

  it.each(BAD)("[x](%s) renders its text and no anchor", (href) => {
    const html = draw(`before [the text](<${href}>) after`);
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toMatch(/href=/);
    expect(html).toContain("the text");
  });

  it.each(BAD)("a reference link to %s renders no anchor either", (href) => {
    const html = draw(`[the text][r]\n\n[r]: <${href}>`);
    expect(html).not.toMatch(/href=/);
  });

  it("an autolinked address and a bare www link: mail is text, http is a link", () => {
    const html = draw("write me@example.com or see www.example.com");
    expect(html).not.toContain("mailto:");
    expect(html).toContain('href="http://www.example.com"');
  });

  it("an http link is a plain anchor with rel, never routed through /r", () => {
    const html = draw('[site](https://example.com/a?b=1&c=2 "T")');
    expect(html).toContain(
      '<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">site</a>',
    );
    expect(html).not.toContain("/r/");
    expect(html).not.toContain("target=");
  });

  it("a link title and an image title never become attributes", () => {
    const html = draw('[a](https://example.com "x\\" onmouseover=\\"alert(1)")');
    expect(attributeNames(html).sort()).toEqual(["class", "href", "rel"]);
    expect(html).not.toContain("onmouseover=");
    expect(html).not.toContain("title=");
  });
});

describe("PostBody: images are the owner's own uploads only", () => {
  it("draws the owner's upload from /media, lazily, with its alt text", () => {
    const html = draw(`![A *cat*](${OWN_IMAGE})`);
    expect(html).toContain(
      `src="http://localhost:3000/media/${OWNER}/0123456789abcdef0123456789abcdef.webp"`,
    );
    expect(html).toContain('alt="A cat"');
    expect(html).toContain('loading="lazy"');
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
  });

  const FOREIGN = [
    "https://evil.example/pixel.png",
    "http://127.0.0.1:54321/storage/v1/object/public/page-media/x.png",
    `${STORAGE}/${OTHER}/0123456789abcdef0123456789abcdef.webp`,
    `${STORAGE}/${OWNER}/../${OTHER}/0123456789abcdef0123456789abcdef.webp`,
    `${OWN_IMAGE}?x=1`,
    `${OWN_IMAGE}#x`,
    `http://127.0.0.1:54321/storage/v1/object/public/other-bucket/${OWNER}/0123456789abcdef0123456789abcdef.webp`,
    `https://127.0.0.1:54321/storage/v1/object/public/page-media/${OWNER}/0123456789abcdef0123456789abcdef.webp`,
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    `/media/${OWNER}/0123456789abcdef0123456789abcdef.webp`,
    'x" onerror="alert(1)',
  ];

  it.each(FOREIGN)("%s is not drawn: the alt text is shown instead", (address) => {
    const html = draw(`![the alt](<${address}>)`);
    expect(html).not.toMatch(/<img\b/);
    expect(html).not.toMatch(/src=/);
    expect(html).toContain("the alt");
    expect(ownMediaSrc(address, OWNER)).toBeNull();
  });

  it("an image inside a link, a table and a quote follows the same rule", () => {
    const html = draw(
      `[![alt](https://evil.example/a.png)](https://example.com)\n\n| ![alt](https://evil.example/b.png) |\n|---|\n| x |\n\n> ![alt](https://evil.example/c.png)`,
    );
    expect(html).not.toMatch(/<img\b/);
  });

  it("the renderer and the publish gate share one function for what an upload is", async () => {
    const gate = await import("@/lib/content/images");
    const shared = await import("@/lib/media/upload-path");
    expect(gate.uploadPathOf).toBe(shared.uploadPathOf);
    expect(shared.uploadPathOf(OWN_IMAGE)).toBe(`${OWNER}/0123456789abcdef0123456789abcdef.webp`);
    for (const address of ["", "not a url", `${OWN_IMAGE}/`, OWN_IMAGE.toUpperCase()]) {
      expect(shared.uploadPathOf(address), address).toBeNull();
    }
    for (const address of FOREIGN) expect(ownMediaSrc(address, OWNER), address).toBeNull();
    expect(ownMediaSrc(OWN_IMAGE, OWNER)).not.toBeNull();
  });

  it("with no project URL set, nothing is an upload", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(ownMediaSrc(OWN_IMAGE, OWNER)).toBeNull();
    expect(draw(`![alt](${OWN_IMAGE})`)).not.toMatch(/<img\b/);
  });
});

describe("PostBody: embeds come from the allowlist, by a bare URL on its own line", () => {
  const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("a bare YouTube URL alone in a paragraph becomes the tap-to-play facade, built from the parsed id", () => {
    const html = draw(`intro\n\n${YT}\n\noutro`);
    expect(html).toContain('class="pg-embed"');
    expect(html).toContain('data-embed-provider="youtube"');
    expect(html).toMatch(/<button type="button" class="pg-embed-play"/);
    expect(html).toMatch(
      /data-embed-src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ[^"]*"/,
    );
    expect(html).not.toMatch(/<iframe/);
    expect(html).not.toContain(`href="${YT}"`);
  });

  it("the angle-bracket form works too; inert draws a poster with no button", () => {
    expect(draw("<https://youtu.be/dQw4w9WgXcQ>")).toContain('class="pg-embed"');
    const inert = draw(YT, "inert");
    expect(inert).toContain('class="pg-embed"');
    expect(inert).not.toMatch(/<button/);
    expect(inert).not.toContain("data-embed-src");
  });

  it.each([
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://example.com/video.mp4",
    "https://www.youtube.com/@channel",
  ])("%s stays a link", (url) => {
    const html = draw(url);
    expect(html).not.toContain("pg-embed");
    expect(html).toContain(`<a href="${url.replace(/&/g, "&amp;")}"`);
  });

  it("a YouTube URL inside a sentence, with link text, or in a list stays a link", () => {
    for (const markdown of [`see ${YT} now`, `[watch](${YT})`, `- ${YT}`, `> ${YT}`]) {
      expect(draw(markdown), markdown).not.toContain("pg-embed-play");
    }
  });
});

describe("PostBody: structure", () => {
  it("body headings are drawn at the level written, clamped to h2..h4 (the editor writes 2 to 4)", () => {
    const html = draw("# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six");
    expect(html).toContain("<h2>One</h2>");
    expect(html).toContain("<h2>Two</h2>");
    expect(html).toContain("<h3>Three</h3>");
    expect(html).toContain("<h4>Four</h4>");
    expect(html).toContain("<h4>Five</h4>");
    expect(html).toContain("<h4>Six</h4>");
    expect(html).not.toMatch(/<h1|<h5|<h6/);
  });

  it("a table scrolls inside its own box, with alignment as a data attribute", () => {
    const html = draw("| a | b |\n|---|:-:|\n| 1 | 2 |");
    expect(html).toMatch(/<div class="pg-post-table hl-post-table"><table>/);
    expect(html).toContain("<th>a</th>");
    expect(html).toContain('<td data-align="center">2</td>');
    expect(html).not.toContain("style=");
  });

  it("lists, quote, code, rule, marks and a line break", () => {
    const html = draw(
      "- a\n- b\n\n3. c\n4. d\n\n> quote\n\n```js\nconst a = '<b>';\n```\n\n---\n\n**b** *i* ~~s~~ `c<d`  \nnext",
    );
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain('<ol start="3"><li>c</li><li>d</li></ol>');
    expect(html).toContain("<blockquote><p>quote</p></blockquote>");
    expect(html).toContain("<pre><code>const a = &#x27;&lt;b&gt;&#x27;;\n</code></pre>");
    expect(html).toContain("<hr/>");
    expect(html).toContain(
      "<strong>b</strong> <em>i</em> <del>s</del> <code>c&lt;d</code><br/>next",
    );
    // A code fence's language never becomes a class or any other attribute.
    expect(html).not.toContain("language-");
  });

  it("entities written in Markdown read as their characters, once", () => {
    const html = draw("a &amp; b &lt;c&gt; &#39;d&#39; &copy; &amp;lt;");
    expect(html).toContain("a &amp; b &lt;c&gt; &#x27;d&#x27; &amp;copy; &amp;lt;");
  });

  it("an empty body draws an empty box, and a huge nesting does not throw", () => {
    expect(draw("")).toBe('<div class="pg-post-body hl-post-body"></div>');
    expect(() => draw(`${"> ".repeat(300)}deep`)).not.toThrow();
    expect(() => draw(`${"- a\n".repeat(2000)}`)).not.toThrow();
  });
});

describe("PostArticle", () => {
  const post = {
    title: "Hello <script>alert(1)</script>",
    body: "First paragraph.\n\n## Part",
    excerpt: "",
    publishedAt: "2026-11-20T10:00:00.000Z",
    featuredImage: {
      path: `${OWNER}/0123456789abcdef0123456789abcdef.webp`,
      width: 1200,
      height: 800,
    },
  };
  const terms = [
    { id: "1", taxonomy: "category" as const, slug: "news", name: "News & <b>" },
    { id: "2", taxonomy: "tag" as const, slug: "a-tag", name: "A tag" },
    { id: "3", taxonomy: "tag" as const, slug: "Bad Slug", name: "Bad" },
  ];
  const article = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <PostArticle
        post={{ ...post, ...over }}
        archivePath="blog"
        terms={terms}
        ownerId={OWNER}
        embeds="facade"
      />,
    );

  it("the title is the one h1, escaped; the date is a <time>; reading time is shown", () => {
    const html = article();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Hello &lt;script&gt;alert(1)&lt;/script&gt;</h1>");
    expect(html).toContain('<time dateTime="2026-11-20T10:00:00.000Z">November 20, 2026</time>');
    expect(html).toContain("1 min read");
    expect(html).toContain("<h2>Part</h2>");
  });

  it("the featured image is the owner's upload with its size; another user's is not drawn", () => {
    const html = article();
    expect(html).toContain(`/media/${OWNER}/0123456789abcdef0123456789abcdef.webp`);
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="800"');
    const foreign = article({
      featuredImage: {
        path: `${OTHER}/0123456789abcdef0123456789abcdef.webp`,
        width: 1,
        height: 1,
      },
    });
    expect(foreign).not.toMatch(/<img\b/);
  });

  it("categories and tags link to their archive pages by the vetted href; a bad slug is text", () => {
    const html = article();
    expect(html).toContain(
      '<a class="pg-post-term" href="/blog/category/news">News &amp; &lt;b&gt;</a>',
    );
    expect(html).toContain('href="/blog/tag/a-tag"');
    expect(html).not.toContain("Bad Slug");
    expect(html).toContain("Bad");
  });

  it("a draft (no date) shows no date; in the inert share preview the terms are text, not links", () => {
    expect(article({ publishedAt: null })).not.toContain("<time");
    const inert = renderToStaticMarkup(
      <PostArticle post={post} archivePath="blog" terms={terms} ownerId={OWNER} embeds="inert" />,
    );
    expect(inert).not.toMatch(/<a\b/);
    expect(inert).toContain("A tag");
  });

  it("a hostile archive path makes no link", () => {
    const html = renderToStaticMarkup(
      <PostArticle
        post={post}
        archivePath="//evil.example"
        terms={terms}
        ownerId={OWNER}
        embeds="inert"
      />,
    );
    expect(html).not.toContain("evil.example");
    expect(html).not.toMatch(/href="\/\//);
  });
});

describe("PostBody: the node limit bounds what is drawn (M16-13)", () => {
  // Every element the renderer draws is paid for by a node the lexer charged, so the 150,000-node
  // limit bounds the page: a row with no cells, an autolink's text and a token of every kind.
  /** Elements drawn per node, at most: an embed draws six for a paragraph, its link and the link's text. */
  const PER_NODE = 2;
  const elements = (markdown: string) => tags(draw(markdown)).length - 1;

  it("an embed is three nodes for its six elements (the autolink's text is charged)", () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    expect(lexBounded(url)).toMatchObject({ ok: true, nodes: 3 });
    expect(elements(url)).toBe(6);
  });

  it("a table of rows with no cells is charged a node per row, and refused past the limit", () => {
    const rows = (n: number) => `|a|\n|-|\n${"|\n".repeat(n)}`;
    const small = rows(1000);
    const lexed = lexBounded(small);
    expect(lexed.ok && lexed.nodes).toBeGreaterThan(1000);
    expect(elements(small)).toBeLessThanOrEqual(PER_NODE * lexed.nodes);
    expect(lexBounded(rows(262_000))).toMatchObject({ ok: false, reason: "size" });
    expect(tags(draw(rows(262_000))).filter((tag) => tag === "tr")).toHaveLength(0);
  });

  it(`random bodies draw at most ${PER_NODE} elements per node`, () => {
    const PIECES = ["a ", "*b* ", "**c** ", "~~d~~ ", "`e` ", "[f](https://x.co) ", "<https://y.co> ", "www.z.co ", "m@n.co ", `![g](${OWN_IMAGE}) `, "\n", "\n\n", "- ", "1. ", "> ", "## ", "- [ ] ", "|a|b|\n|-|-|\n", "|\n", "|1|2|\n", "---\n", "```\nh\n```\n", "a  \nb", "\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\n", "<b>i</b>"];
    let seed = 13;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let sample = 0; sample < 400; sample += 1) {
      let body = "";
      for (let k = 1 + Math.floor(random() * 30); k > 0; k -= 1) body += PIECES[Math.floor(random() * PIECES.length)];
      const lexed = lexBounded(body);
      if (!lexed.ok || lexed.nodes > MARKDOWN_MAX_NODES) continue;
      const drawn = elements(body);
      expect(drawn, JSON.stringify(body)).toBeLessThanOrEqual(PER_NODE * Math.max(lexed.nodes, 1));
    }
  });
});
