import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { DEV_PORT } from "../helpers";
import { ingestPage } from "../m4/analytics-ingest-helpers";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import { addPost, daysBefore, enableBlog, republish } from "./public-helpers";

/**
 * M16-04, M16-06, M16-10 on a verified custom domain (the `(tenant)/sites/[pageId]` routes): a post
 * page, the feed, the sitemap and an old slug's 301 answer there as on the handle host, with the
 * custom host as the site's address. Fixtures go through `publish_entry` before the site's first
 * request; the domain row is written with the secret key, as the server writes it.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M16-04 M16-06 M16-10 a post, the feed, the sitemap and an old slug's 301 on a custom domain", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const site = await ingestPage("blogdom", { plan: "studio" });
  const typeId = await enableBlog(site.pageId);
  const moved = await addPost(site, typeId, {
    title: "Moved post",
    slug: "old-name",
    excerpt: "An excerpt",
    publishedAt: daysBefore(2),
  });
  await republish(site, moved, {
    title: "Moved post",
    slug: "new-name",
    excerpt: "An excerpt",
    publishedAt: daysBefore(2),
  });
  await addPost(site, typeId, { title: "Other post", slug: "other", publishedAt: daysBefore(1) });
  const hostname = hostnameFor("blog");
  await addDomainRow({ pageId: site.pageId, hostname, status: "verified" });
  const host = `${hostname}:${DEV_PORT}`;
  const origin = `http://${hostname}:${DEV_PORT}`;
  const get = (path: string) => rawRequest(host, path);

  const post = await get("/blog/new-name");
  expect(post.status).toBe(200);
  expect(post.body).toContain("<h1");
  expect(post.body).toContain("Moved post");
  // The custom domain is the site's address: the canonical and og:url name it.
  expect(post.body).toContain(`<link rel="canonical" href="${origin}/blog/new-name">`);
  expect(post.body).not.toContain(`${site.handle}.localhost`);

  const old = await get("/blog/old-name");
  expect(old.status).toBe(301);
  expect(old.headers["location"]).toBe("/blog/new-name");

  const feed = await get("/blog/feed.xml");
  expect(feed.status).toBe(200);
  expect(String(feed.headers["content-type"])).toContain("application/rss+xml");
  expect(feed.body).toContain(`<link>${origin}/blog/new-name</link>`);
  expect(feed.body).toContain(`<link>${origin}/blog/other</link>`);

  const sitemap = await get("/sitemap.xml");
  expect(sitemap.status).toBe(200);
  expect(sitemap.body).toContain(`<loc>${origin}/blog</loc>`);
  expect(sitemap.body).toContain(`<loc>${origin}/blog/new-name</loc>`);
  expect(sitemap.body).not.toContain("/blog/old-name");

  expect((await get("/blog/never-was")).status).toBe(404);
});
