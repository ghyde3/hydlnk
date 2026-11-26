import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { ingestPage, type IngestPage } from "../m4/analytics-ingest-helpers";
import {
  addPost,
  addTerm,
  daysBefore,
  enableBlog,
  republish,
  trash,
  unpublish,
  uploadAddress,
} from "./public-helpers";

/**
 * M16-03 to M16-06 and M16-10 on a handle host, at 390x844 and 1440x900: the post page, the
 * archive with paging, a category and a tag page, the 404s of invented paths, the feed, the
 * sitemap, the head of a post and a changed slug's redirect. Fixtures go through `publish_entry`.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000, mode: "serial" });

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
let site: IngestPage;
let typeId: string;
let news: string;
let tag: string;
let rich: { id: string; rev: number };

const BODY = (image: string) =>
  [
    "An opening paragraph with a [link](https://example.com/a) in it.",
    "# A heading",
    "- one\n- two",
    "> a quote",
    "```\nconst a = 1; // " + "x".repeat(120) + "\n```",
    `![A picture](${image})`,
    YOUTUBE,
    "A_very_long_word_" + "w".repeat(140),
    "| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |",
    "<script>window.__hacked = 1</script>",
    "[bad](javascript:alert(1))",
  ].join("\n\n");

test.beforeAll(async () => {
  site = await ingestPage("blog", { plan: "pro" });
  typeId = await enableBlog(site.pageId);
  news = await addTerm(site, typeId, "category", "news", "News");
  tag = await addTerm(site, typeId, "tag", "studio", "Studio");
  await addTerm(site, typeId, "category", "empty", "Empty");
  // Twelve posts, newest first by number: post 1 is the newest.
  for (let n = 12; n >= 2; n -= 1) {
    await addPost(site, typeId, {
      title: `Post number ${n}`,
      slug: `post-${n}`,
      excerpt: `Excerpt of post ${n}`,
      publishedAt: daysBefore(n),
      ...(n % 2 === 0 ? { terms: { categories: [news] } } : {}),
    });
  }
  rich = await addPost(site, typeId, {
    title: "Post number 1",
    slug: "post-1",
    body: BODY(uploadAddress(site.userId, "0123456789abcdef.webp")),
    featuredImage: { path: `${site.userId}/fedcba9876543210.webp`, width: 1200, height: 800 },
    terms: { categories: [news], tags: [tag] },
    publishedAt: daysBefore(1),
  });
  await addPost(site, typeId, { title: "Still a draft", slug: "a-draft", live: false });
});

test("M16-04 a post page: theme-styled, finished HTML, hostile body shown as text", async ({
  page,
}) => {
  const response = await page.goto(`${site.origin}/blog/post-1`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Post number 1");
  const article = page.locator("article.hl-post");
  await expect(article.locator("time")).toHaveText("November 19, 2026");
  await expect(article).toContainText("min read");
  await expect(article.locator(".hl-post-body h2")).toHaveText("A heading");
  await expect(article.locator(".hl-post-body li")).toHaveCount(2);
  await expect(article.locator(".hl-post-body blockquote")).toHaveText("a quote");
  await expect(article.locator(".hl-post-body pre")).toBeVisible();
  await expect(article.locator(".hl-post-body img")).toHaveAttribute(
    "src",
    new RegExp(`/media/${site.userId}/0123456789abcdef\\.webp$`),
  );
  await expect(article.locator("img.pg-post-featured")).toHaveAttribute(
    "src",
    new RegExp(`/media/${site.userId}/fedcba9876543210\\.webp$`),
  );
  await expect(article.locator("button.pg-embed-play")).toHaveCount(1);
  await expect(article.locator(".hl-post-table table")).toBeVisible();
  // Raw HTML and a javascript: link are text.
  await expect(article).toContainText("<script>window.__hacked = 1</script>");
  expect(await page.evaluate(() => (window as { __hacked?: number }).__hacked)).toBeUndefined();
  await expect(article.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(article.getByText("bad", { exact: true })).toBeVisible();
  // Terms link to their pages; previous and next come from the index.
  await expect(article.locator('a[href="/blog/category/news"]')).toHaveText("News");
  await expect(article.locator('a[href="/blog/tag/studio"]')).toHaveText("Studio");
  const nav = page.locator("nav.hl-post-nav");
  await expect(nav.locator('a[rel="prev"]')).toHaveAttribute("href", "/blog/post-2");
  await expect(nav.locator('a[rel="next"]')).toHaveCount(0);
  // The one tenant script and no other JavaScript; it carries the post's id for the beacon.
  const scripts = page.locator("script:not([type='application/ld+json'])");
  await expect(scripts).toHaveCount(1);
  await expect(scripts).toHaveAttribute("data-sub-page-id", rich.id);
  await expect(scripts).toHaveAttribute("src", /^\/_t\/p\..+\.js$/);

  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, ".pg-post-terms");
  await expectTapTargets(page, ".hl-post-nav");
  await expectTapTargets(page, ".hl-post-body");
});

test("M16-04 a draft, an unpublished post and a trashed post are 404; an older post has both neighbours", async ({
  page,
  request,
}) => {
  expect((await request.get(`${site.origin}/blog/a-draft`)).status()).toBe(404);
  const gone = await addPost(site, typeId, { title: "Soon gone", slug: "soon-gone" });
  expect((await request.get(`${site.origin}/blog/soon-gone`)).status()).toBe(200);
  await unpublish(site, gone);
  expect((await request.get(`${site.origin}/blog/soon-gone`)).status()).toBe(404);
  const binned = await addPost(site, typeId, { title: "Binned", slug: "binned" });
  await trash(binned.id);
  const missing = await request.get(`${site.origin}/blog/binned`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).not.toContain("Binned");

  await page.goto(`${site.origin}/blog/post-5`);
  const nav = page.locator("nav.hl-post-nav");
  await expect(nav.locator('a[rel="prev"]')).toHaveAttribute("href", "/blog/post-6");
  await expect(nav.locator('a[rel="next"]')).toHaveAttribute("href", "/blog/post-4");
});

test("M16-05 the archive: 12 posts over two pages, a category and a tag page", async ({ page }) => {
  expect((await page.goto(`${site.origin}/blog`))?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("Posts");
  const cards = page.locator(".hl-archive-card");
  await expect(cards).toHaveCount(10);
  await expect(cards.first().locator("h2")).toHaveText("Post number 1");
  await expect(cards.nth(1)).toContainText("Excerpt of post 2");
  await expect(cards.nth(9).locator("h2")).toHaveText("Post number 10");
  await expect(page.locator(".hl-archive")).not.toContainText("Still a draft");
  await expect(page.locator(".pg-archive-count")).toHaveText("Page 1 of 2");
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, ".hl-archive");

  await page.locator('.pg-archive-pager a[rel="next"]').click();
  await expect(page).toHaveURL(`${site.origin}/blog/page/2`);
  await expect(page.locator(".hl-archive-card")).toHaveCount(2);
  await expect(page.locator(".hl-archive-card").first().locator("h2")).toHaveText("Post number 11");
  await expect(page.locator('.pg-archive-pager a[rel="prev"]')).toHaveAttribute("href", "/blog");
  await expectNoHorizontalScroll(page);

  expect((await page.goto(`${site.origin}/blog/category/news`))?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("News");
  // Post 1 and the six even ones.
  await expect(page.locator(".hl-archive-card")).toHaveCount(7);
  await expect(page.locator(".hl-archive-card").first().locator("h2")).toHaveText("Post number 1");
  await expectNoHorizontalScroll(page);

  expect((await page.goto(`${site.origin}/blog/tag/studio`))?.status()).toBe(200);
  await expect(page.locator(".hl-archive-card")).toHaveCount(1);
  // The archive's script reports the type's id (the beacon counts it as the blog).
  await expect(page.locator("script[data-page-id]")).toHaveAttribute("data-sub-page-id", typeId);
});

test("M16-03 M16-05 invented paths under the archive are 404s", async ({ page, request }) => {
  for (const path of [
    "/blog/anything-invented",
    "/blog/page/999",
    "/blog/page/3",
    "/blog/category/none",
    "/blog/category/empty",
    "/blog/category/news/page/2",
    "/blog/tag/news",
    "/blog/page/1",
    "/blog/page/2e0",
    "/blog/post-1/extra",
    "/notablog/post-1",
    "/notablog/feed.xml",
  ]) {
    const response = await request.get(`${site.origin}${path}`);
    expect(response.status(), path).toBe(404);
  }
  expect((await request.post(`${site.origin}/blog/post-1`)).status()).toBe(404);
  const response = await page.goto(`${site.origin}/blog/anything-invented`);
  expect(response?.status()).toBe(404);
  await expectNoHorizontalScroll(page);
});

test("M16-06 the feed, the sitemap, and a post's head", async ({ request }) => {
  const feed = await request.get(`${site.origin}/blog/feed.xml`);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("application/rss+xml");
  expect(feed.headers()["content-security-policy"]).toBeTruthy();
  const xml = await feed.text();
  expect(xml).toContain('<rss version="2.0">');
  expect(xml.match(/<item>/g)).toHaveLength(12);
  expect(xml).toContain(`<link>${site.origin}/blog/post-1</link>`);
  expect(xml).toContain(`<guid isPermaLink="true">${site.origin}/blog/post-2</guid>`);
  expect(xml).toContain("<description>Excerpt of post 2</description>");
  expect(xml).toContain("<pubDate>");
  expect(xml).not.toContain("Still a draft");
  expect(xml.indexOf("Post number 1<")).toBeLessThan(xml.indexOf("Post number 2<"));

  const sitemap = await (await request.get(`${site.origin}/sitemap.xml`)).text();
  expect(sitemap).toContain(`<loc>${site.origin}/blog</loc>`);
  expect(sitemap).toContain(`<loc>${site.origin}/blog/post-12</loc>`);
  expect(sitemap).not.toContain("a-draft");

  const hidden = await addPost(site, typeId, {
    title: "Hidden </script><script>alert(1)</script>",
    slug: "hidden",
    excerpt: "The excerpt",
    seo: { noindex: true, description: "The SEO description" },
    publishedAt: daysBefore(40),
  });
  expect(hidden.id).toBeTruthy();
  const html = await (await request.get(`${site.origin}/blog/hidden`)).text();
  expect(html).toContain('<meta name="robots" content="noindex">');
  expect(html).toContain('<meta name="description" content="The SEO description">');
  expect(html).toContain(`<link rel="canonical" href="${site.origin}/blog/hidden">`);
  const data = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(html)?.[1] ?? "";
  const parsed = JSON.parse(data) as Record<string, unknown>;
  expect(parsed["@type"]).toBe("BlogPosting");
  expect(parsed.headline).toBe("Hidden </script><script>alert(1)</script>");
  expect(parsed.datePublished).toBe(daysBefore(40));
  expect((parsed.mainEntityOfPage as { "@id": string })["@id"]).toBe(`${site.origin}/blog/hidden`);
  expect(html.match(/<script/g)).toHaveLength(2);
  const again = await (await request.get(`${site.origin}/sitemap.xml`)).text();
  expect(again).not.toContain("/blog/hidden");

  const plain = await (await request.get(`${site.origin}/blog/post-2`)).text();
  expect(plain).toContain('<meta name="description" content="Excerpt of post 2">');
  expect(plain).toContain("<title>Post number 2 · ");
});

test("M16-10 a changed slug answers 301 to the new address; a later post that takes the old slug wins", async ({
  page,
  request,
}) => {
  const post = await addPost(site, typeId, {
    title: "Renamed",
    slug: "old-name",
    publishedAt: daysBefore(50),
  });
  await republish(site, post, { title: "Renamed", slug: "new-name", publishedAt: daysBefore(50) });
  const moved = await request.get(`${site.origin}/blog/old-name`, { maxRedirects: 0 });
  expect(moved.status()).toBe(301);
  expect(moved.headers()["location"]).toBe("/blog/new-name");
  await page.goto(`${site.origin}/blog/old-name`);
  await expect(page).toHaveURL(`${site.origin}/blog/new-name`);
  await expect(page.locator("h1")).toHaveText("Renamed");
  expect((await request.get(`${site.origin}/blog/never-was`, { maxRedirects: 0 })).status()).toBe(
    404,
  );

  await addPost(site, typeId, { title: "Taker", slug: "old-name", publishedAt: daysBefore(51) });
  const taken = await request.get(`${site.origin}/blog/old-name`, { maxRedirects: 0 });
  expect(taken.status()).toBe(200);
  expect(await taken.text()).toContain("Taker");
});

test("M16-04 M16-05 a blog that is off, and a site that is not published, show nothing", async ({
  request,
}) => {
  const quiet = await ingestPage("blogoff", { plan: "pro" });
  const type = await enableBlog(quiet.pageId);
  await addPost(quiet, type, { title: "Quiet post", slug: "quiet" });
  expect((await request.get(`${quiet.origin}/blog/quiet`)).status()).toBe(200);
  await enableBlog(quiet.pageId, false);
  for (const path of ["/blog", "/blog/quiet", "/blog/feed.xml", "/blog/page/2"]) {
    expect((await request.get(`${quiet.origin}${path}`)).status(), path).toBe(404);
  }

  const draftSite = await ingestPage("blogdraft", { plan: "pro", published: false });
  const draftType = await enableBlog(draftSite.pageId);
  await addPost(draftSite, draftType, { title: "Unseen post", slug: "unseen" });
  for (const path of ["/blog", "/blog/unseen", "/blog/feed.xml"]) {
    const response = await request.get(`${draftSite.origin}${path}`);
    expect(response.status(), path).toBe(404);
    expect(await response.text()).not.toContain("Unseen post");
  }

  const empty = await ingestPage("blogempty", { plan: "pro" });
  await enableBlog(empty.pageId);
  const archive = await request.get(`${empty.origin}/blog`);
  expect(archive.status()).toBe(200);
  expect(await archive.text()).toContain("No posts yet");
});
