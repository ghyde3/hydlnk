// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { publishedDocSchema, publishedSubPageSchema } from "@/lib/document";
import type { Database, Json } from "@/lib/supabase/database.types";
import { PUBLIC_READ_CACHE_VERSION } from "@/lib/publish/tags";
import { stackIsUp } from "./publish-support";

vi.mock("server-only", () => ({}));

const { run } = await stackIsUp();

/**
 * 1b1-12 (M15-05): the public readers read page entries. The frozen pre-move copies (pages.published
 * and the site_pages rows, left untouched by the copy-only move) are the fixtures: what the old code
 * rendered from them must equal, byte for byte, what the entry readers render now.
 */
describe("public cache version", () => {
  it("is 4, so every cached public read regenerates from entries once", () => {
    expect(PUBLIC_READ_CACHE_VERSION).toBe("4");
  });
});

describe.skipIf(!run)("public HTML from entries equals the frozen pre-move HTML", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);

  for (const handle of ["mara"]) {
    it(`${handle}: Home, every sub-page, sitemap.xml and robots origin`, async () => {
      const { handleResponse, handleSubPageResponse } = await import("@/lib/tenant-render/respond");
      const { tenantSitemap, siteHostOrigin } = await import("@/lib/tenant-render/sitemap");
      const { renderLivePage, renderLiveSubPage } = await import("@/lib/tenant-render/live-page");
      const { siteContextFrom, homeUsesSiteIndex } = await import("@/lib/site/live");
      const { siteSitemapXml } = await import("@/lib/marketing/seo");
      const { ogImageUrl, tenantOrigin } = await import("@/lib/publish/urls");
      const { clientEnv } = await import("@/lib/env/client");
      const root = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;

      // The frozen fixtures: the legacy rows, read straight from the copies the move left.
      const { data: page } = await admin
        .from("pages")
        .select("id, published, published_at, accounts!inner(plan)")
        .eq("handle", handle)
        .single();
      expect(page).not.toBeNull();
      const frozenHome = publishedDocSchema.parse(page!.published);
      const { data: frozenRows } = await admin
        .from("site_pages")
        .select("id, live_path, published")
        .eq("page_id", page!.id)
        .not("published", "is", null)
        .order("live_path", { ascending: true });
      expect(frozenRows!.length).toBeGreaterThan(0);
      const frozenIndex = frozenRows!.map((row) => ({
        id: row.id,
        path: row.live_path!,
        title: (row.published as { title: string }).title,
      }));
      const plan = page!.accounts.plan;

      // Home
      const site = homeUsesSiteIndex(frozenHome)
        ? siteContextFrom(frozenIndex, frozenHome, "home")
        : undefined;
      const expectedHome = renderLivePage({
        pageId: page!.id,
        document: frozenHome,
        plan,
        ...(site ? { site } : {}),
        urls: {
          page: `${tenantOrigin(handle)}/`,
          image: ogImageUrl(handle, page!.published_at),
        },
      });
      expect(await (await handleResponse(handle)).text()).toBe(expectedHome);

      // Each sub-page
      for (const row of frozenRows!) {
        const subPage = publishedSubPageSchema.parse(row.published);
        const expected = renderLiveSubPage({
          pageId: page!.id,
          subPageId: row.id,
          document: frozenHome,
          subPage,
          plan,
          site: siteContextFrom(frozenIndex, frozenHome, row.id),
          urls: {
            page: `${tenantOrigin(handle)}/${row.live_path}`,
            image: ogImageUrl(handle, page!.published_at),
          },
        });
        const response = await handleSubPageResponse(handle, row.live_path!);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(expected);
      }

      // sitemap.xml and the robots origin
      const host = `${handle}.${root}`;
      const sitemap = await tenantSitemap(host, root);
      expect(sitemap?.body).toBe(
        siteSitemapXml(
          tenantOrigin(handle, root),
          frozenIndex.map((p) => p.path),
        ).body,
      );
      expect(await siteHostOrigin(host, root)).toBe(tenantOrigin(handle, root));
    });
  }

  it("reads the entries, not the frozen copies: an entry edit shows, the frozen row does not", async () => {
    const { handleSubPageResponse, handleResponse } = await import("@/lib/tenant-render/respond");
    const { data: page } = await admin.from("pages").select("id").eq("handle", "mara").single();
    const { data: entries } = await admin
      .from("content_entries")
      .select("id, live_path, published")
      .eq("site_id", page!.id)
      .not("published", "is", null);
    const sub = entries!.find((e) => e.live_path !== "/")!;
    const home = entries!.find((e) => e.live_path === "/")!;
    const edit = (doc: unknown, field: string, value: unknown): Json =>
      ({ ...(doc as Record<string, unknown>), [field]: value }) as Json;
    try {
      await admin
        .from("content_entries")
        .update({ published: edit(sub.published, "title", "Entry only title") })
        .eq("id", sub.id);
      const html = await (await handleSubPageResponse("mara", sub.live_path!)).text();
      expect(html).toContain("Entry only title");

      const blocks = (home.published as { blocks: Array<Record<string, unknown>> }).blocks;
      const heading = blocks.find((b) => b.type === "header");
      if (heading) {
        const changed = blocks.map((b) =>
          b === heading ? { ...b, text: "Entry only header" } : b,
        );
        await admin
          .from("content_entries")
          .update({ published: edit(home.published, "blocks", changed) })
          .eq("id", home.id);
        expect(await (await handleResponse("mara")).text()).toContain("Entry only header");
      }
    } finally {
      await admin.from("content_entries").update({ published: sub.published }).eq("id", sub.id);
      await admin.from("content_entries").update({ published: home.published }).eq("id", home.id);
    }
  });
});
