// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishDoc } from "@/lib/document";
import { publishedDocSchema, toPublishForm, emptyDraft, type DraftDoc } from "@/lib/document";
import { blocks } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/handles/availability", () => ({
  checkHandle: async () => ({ handle: "mara", status: "taken" }),
}));

const state = vi.hoisted(() => ({
  byHandle: undefined as unknown,
  byId: undefined as unknown,
  primary: "links.maraokafor.com" as string | null,
}));
vi.mock("@/app/(tenant)/published-page", () => ({
  getTenantPageState: async () => state.byHandle,
  getTenantPageStateById: async () => state.byId,
}));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: async () => state.primary }));

const { handleResponse, siteResponse } = await import("@/lib/tenant-render/respond");
const { pageMetadata } = await import("@/lib/publish/share-meta");

/**
 * M6-32: the metadata of both tenant routes. A page with no share card must give exactly what it
 * gave before (the literal objects below are the old code's output), the share fields change
 * og:title, og:description and their twitter twins and nothing else, and no plan is consulted.
 *
 * M8-02: the two routes no longer have `generateMetadata`; the live builder writes the head tags
 * itself. So the comparison is between the tags this builder writes into the document (read back
 * from the response's HTML into the shape `pageMetadata` returns) and the old code's literal output
 * below: the same assertions as before, one level further out.
 */

type Tags = Record<string, string>;

/** Reads the title, description and the og:/twitter: tags of a document back into `Metadata`'s shape. */
function metadataFromHtml(html: string) {
  const head = new DOMParser().parseFromString(html, "text/html").head;
  const og: Tags = {};
  const twitter: Tags = {};
  for (const meta of head.querySelectorAll("meta[property^='og:']")) {
    og[meta.getAttribute("property")!.slice(3)] = meta.getAttribute("content")!;
  }
  for (const meta of head.querySelectorAll("meta[name^='twitter:']")) {
    twitter[meta.getAttribute("name")!.slice(8)] = meta.getAttribute("content")!;
  }
  const description = head.querySelector("meta[name='description']")?.getAttribute("content");
  return {
    title: head.querySelector("title")?.textContent ?? undefined,
    description: description ?? undefined,
    ...(Object.keys(og).length === 0
      ? {}
      : {
          openGraph: {
            type: og.type,
            title: og.title,
            description: og.description,
            url: og.url,
            images: [
              { url: og.image, width: Number(og["image:width"]), height: Number(og["image:height"]), alt: og["image:alt"] },
            ],
          },
        }),
    ...(Object.keys(twitter).length === 0
      ? {}
      : {
          twitter: {
            card: twitter.card,
            title: twitter.title,
            description: twitter.description,
            images: [twitter.image],
          },
        }),
  };
}

const PUBLISHED_AT = "2026-10-03T12:00:00.000Z";
const MS = Date.parse(PUBLISHED_AT);
const IMAGE = {
  uid: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
};

function docFor(over: { name?: string; bio?: string; share?: unknown } = {}): PublishDoc {
  const draft = {
    ...emptyDraft("mara"),
    blocks: [blocks.link],
    profile: {
      ...emptyDraft("mara").profile,
      name: over.name ?? "Mara Okafor",
      bio: over.bio ?? "Photographer in Orlando",
    },
    ...(over.share ? { share: over.share } : {}),
  } as DraftDoc;
  return publishedDocSchema.parse(JSON.parse(JSON.stringify(toPublishForm(draft, null))));
}

const published = (document: PublishDoc, plan = "free") => ({
  kind: "published" as const,
  page: {
    pageId: "00000000-0000-4000-8000-0000000000b1",
    document,
    publishedAt: PUBLISHED_AT,
    plan,
  },
});

const handleMeta = async () => metadataFromHtml(await (await handleResponse("mara")).text());
const sitesMeta = async () =>
  metadataFromHtml(await (await siteResponse("00000000-0000-4000-8000-0000000000b1")).text());

/** What the handle route returned before M6-32, written out. */
const legacyHandle = (name: string, bio: string) => ({
  title: `${name} - links`,
  description: bio || undefined,
  openGraph: {
    type: "website",
    title: name,
    description: bio || undefined,
    url: "http://mara.localhost:3000/",
    images: [{ url: `http://mara.localhost:3000/og?v=${MS}`, width: 1200, height: 630, alt: name }],
  },
  twitter: {
    card: "summary_large_image",
    title: name,
    description: bio || undefined,
    images: [`http://mara.localhost:3000/og?v=${MS}`],
  },
});

/** And the custom-domain route's. */
const legacySites = (name: string, bio: string, hostname: string) => ({
  title: `${name} - links`,
  description: bio || undefined,
  openGraph: {
    type: "website",
    title: name,
    description: bio || undefined,
    url: `http://${hostname}:3000/`,
    images: [{ url: `http://${hostname}:3000/og?v=${MS}`, width: 1200, height: 630, alt: name }],
  },
  twitter: {
    card: "summary_large_image",
    title: name,
    description: bio || undefined,
    images: [`http://${hostname}:3000/og?v=${MS}`],
  },
});

beforeEach(() => {
  state.primary = "links.maraokafor.com";
  state.byHandle = published(docFor());
  state.byId = published(docFor());
});

describe("M6-32 a page without share fields", () => {
  it("gives the handle route's metadata exactly as it was", async () => {
    expect(await handleMeta()).toEqual(legacyHandle("Mara Okafor", "Photographer in Orlando"));
  });

  it("gives the custom-domain route's metadata exactly as it was", async () => {
    expect(await sitesMeta()).toEqual(
      legacySites("Mara Okafor", "Photographer in Orlando", "links.maraokafor.com"),
    );
  });

  it("an empty bio leaves every description undefined, as before", async () => {
    state.byHandle = published(docFor({ bio: "" }));
    state.byId = published(docFor({ bio: "" }));
    expect(await handleMeta()).toEqual(legacyHandle("Mara Okafor", ""));
    expect(await sitesMeta()).toEqual(legacySites("Mara Okafor", "", "links.maraokafor.com"));
  });

  it("a custom-domain page with no verified domain has only the title and the description", async () => {
    state.primary = null;
    expect(await sitesMeta()).toEqual({
      title: "Mara Okafor - links",
      description: "Photographer in Orlando",
    });
  });

  it("serializes to the same JSON as the old code (a byte-level snapshot)", async () => {
    expect(JSON.stringify(await handleMeta())).toBe(
      JSON.stringify(legacyHandle("Mara Okafor", "Photographer in Orlando")),
    );
  });
});

describe("M6-32 a page with share fields", () => {
  const share = { title: "Hear the new album", description: "Out Friday. Tap to listen." };

  it("changes the og and twitter title and description, and nothing else, on the handle route", async () => {
    state.byHandle = published(docFor({ share }));
    const meta = await handleMeta();
    const before = legacyHandle("Mara Okafor", "Photographer in Orlando");
    expect(meta).toEqual({
      ...before,
      openGraph: {
        ...before.openGraph,
        title: share.title,
        description: share.description,
      },
      twitter: { ...before.twitter, title: share.title, description: share.description },
    });
    // The document title and the meta description keep the name and the bio.
    expect(meta.title).toBe("Mara Okafor - links");
    expect(meta.description).toBe("Photographer in Orlando");
  });

  it("does the same on the custom-domain route, naming that host in og:url and og:image", async () => {
    state.byId = published(docFor({ share }));
    const meta = await sitesMeta();
    const before = legacySites("Mara Okafor", "Photographer in Orlando", "links.maraokafor.com");
    expect(meta.openGraph).toEqual({
      ...before.openGraph,
      title: share.title,
      description: share.description,
    });
    expect(meta.twitter).toEqual({
      ...before.twitter,
      title: share.title,
      description: share.description,
    });
    expect(meta.title).toBe(before.title);
    expect(meta.description).toBe(before.description);
  });

  it("falls back per field, and an empty share image changes nothing in the tags", async () => {
    state.byHandle = published(docFor({ share: { title: "Only a title" } }));
    const a = await handleMeta();
    expect(a.openGraph).toMatchObject({
      title: "Only a title",
      description: "Photographer in Orlando",
    });
    state.byHandle = published(docFor({ share: { description: "Only words" } }));
    const b = await handleMeta();
    expect(b.openGraph).toMatchObject({ title: "Mara Okafor", description: "Only words" });
    // The image is not part of the tags' text: the tags point at /og whatever the share image is.
    state.byHandle = published(
      docFor({
        share: { image: { path: `${IMAGE.uid}/img-0123456789ab.webp`, width: 1200, height: 630 } },
      }),
    );
    expect(await handleMeta()).toEqual(legacyHandle("Mara Okafor", "Photographer in Orlando"));
  });

  it("keeps the share title as a plain string: markup characters are data, never parsed here", async () => {
    const evil = '"><script>alert(1)</script>';
    state.byHandle = published(docFor({ share: { title: evil } }));
    const meta = await handleMeta();
    expect(meta.openGraph).toMatchObject({ title: evil });
    expect(meta.twitter).toMatchObject({ title: evil });
    expect(meta.title).toBe("Mara Okafor - links");
  });

  it("renders the same tags for plans free, pro and studio: no plan check exists on this path", async () => {
    const results = [];
    for (const plan of ["free", "pro", "studio"]) {
      state.byHandle = published(docFor({ share }), plan);
      state.byId = published(docFor({ share }), plan);
      results.push(JSON.stringify([await handleMeta(), await sitesMeta()]));
    }
    expect(new Set(results).size).toBe(1);
  });
});

describe("M6-32 pages that are not published show no share text", () => {
  it("answers the placeholder, the not-found and the suspended metadata with nothing of the card", async () => {
    for (const next of [
      { kind: "unpublished", pageId: "x" },
      { kind: "suspended" },
      { kind: "missing" },
    ]) {
      state.byHandle = next;
      state.byId = next;
      const text = JSON.stringify([await handleMeta(), await sitesMeta()]);
      expect(text, next.kind).not.toContain("Hear the new album");
      expect(text, next.kind).not.toContain("SECRET");
      expect(text).not.toContain("og:title");
      expect(text).not.toContain("openGraph");
    }
  });
});

describe("M6-32 pageMetadata", () => {
  it("is a pure function of the document and two URLs", () => {
    const doc = docFor({ share: { title: "T", description: "D" } });
    const urls = { page: "https://x.example/", image: "https://x.example/og?v=1" };
    expect(pageMetadata(doc, urls)).toEqual(pageMetadata(doc, urls));
    expect(pageMetadata(doc, urls).openGraph).toMatchObject({ url: urls.page });
    expect(pageMetadata(doc, urls).twitter).toMatchObject({ images: [urls.image] });
  });
});
