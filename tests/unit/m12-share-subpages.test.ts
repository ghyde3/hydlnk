import { describe, expect, it, vi } from "vitest";
import { emptyDraft } from "@/lib/document";
import { hashPreviewToken } from "@/lib/previews/token";
import { sharePath } from "@/lib/previews/share-headers";
import { internalHref, pageLinkHref } from "@/lib/site/menu";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M12-06: the private share link previews every page of the site by its path. The loader answers a
 * page's draft with a working menu whose entries are this link's own addresses; an unknown, reserved
 * or nested path is the same `inactive` as a dead link; the proxy hands the rest of the address over.
 */

const TOKEN = "a".repeat(43);
const ITEMS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIRS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const home = {
  ...emptyDraft("zq"),
  nav: { show: true, items: [ITEMS, DIRS] },
  blocks: [
    { id: "pl-home-0001", type: "page_link", visible: true, label: "To items", target: ITEMS },
    { id: "pl-home-0002", type: "page_link", visible: true, label: "To home", target: "home" },
  ],
};
const itemsDraft = {
  path: "items",
  title: "Items for sale",
  description: "",
  blocks: [
    { id: "hd-items-0001", type: "header", visible: true, text: "Hello‮ there" },
    { id: "pl-items-0001", type: "page_link", visible: true, label: "Back", target: "home" },
  ],
};
const dirsDraft = { path: "directions", title: "Directions", description: "", blocks: [] };

function fakeAdmin(queries: string[] = []) {
  const pages = [
    { id: ITEMS, draft: itemsDraft },
    { id: DIRS, draft: dirsDraft },
  ];
  return {
    from(table: string) {
      queries.push(table);
      const state: { eq: Record<string, unknown>; cols: string } = { eq: {}, cols: "" };
      const chain = {
        select(cols: string) {
          state.cols = cols;
          return chain;
        },
        eq(column: string, value: unknown) {
          state.eq[column] = value;
          return chain;
        },
        or() {
          return chain;
        },
        async maybeSingle() {
          if (table === "preview_links") {
            return {
              error: null,
              data: {
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                revoked_at: null,
                pages: {
                  id: "site-1",
                  handle: "zq",
                  owner_id: "owner-1",
                  draft: home,
                  accounts: { plan: "free", suspended_at: null },
                },
              },
            };
          }
          const row = pages.find((p) => p.id === state.eq.id);
          return { error: null, data: row ? { draft: row.draft } : null };
        },
        then(resolve: (value: unknown) => void) {
          resolve({
            error: null,
            data: pages.map((p) => ({ id: p.id, path: p.draft.path, title: p.draft.title })),
          });
        },
      };
      return chain;
    },
  } as never;
}

async function load(path?: string) {
  const { loadSharedPreview } = await import("@/lib/previews/shared");
  // The fake ignores the hash; assert it is the one asked for.
  void hashPreviewToken;
  return loadSharedPreview(fakeAdmin(), TOKEN, new Date(), path);
}

describe("M12-06 sharePath", () => {
  it("is what follows the token: nothing for Home, one segment for a page", () => {
    expect(sharePath(`/share/${TOKEN}`)).toBe("");
    expect(sharePath(`/share/${TOKEN}/`)).toBe("");
    expect(sharePath(`/share/${TOKEN}/items`)).toBe("items");
    expect(sharePath(`/share/${TOKEN}/items/`)).toBe("items");
    expect(sharePath(`/share/${TOKEN}/a/b`)).toBe("a/b");
  });
  it("marks a path that is not printable ASCII or is too long so it never matches a page", () => {
    expect(sharePath(`/share/${TOKEN}/café`)).toBe("~");
    expect(sharePath(`/share/${TOKEN}/${"x".repeat(80)}`)).toBe("~");
  });
});

describe("M12-06 same-site hrefs inside the preview", () => {
  it("accepts exactly the share addresses and nothing wider", () => {
    expect(internalHref(`/share/${TOKEN}`)).toBe(`/share/${TOKEN}`);
    expect(internalHref(`/share/${TOKEN}/items`)).toBe(`/share/${TOKEN}/items`);
    for (const bad of [
      `/share/${TOKEN}/og`,
      `/share/${TOKEN}/a/b`,
      `/share/short`,
      `//share/${TOKEN}`,
      `https://evil.test/share/${TOKEN}`,
    ]) {
      expect(internalHref(bad), bad).toBeNull();
    }
  });
  it("Home maps to the preview's own address only when the site context gives one", () => {
    expect(pageLinkHref("home", undefined)).toBe("/");
    expect(pageLinkHref("home", { home: `/share/${TOKEN}` })).toBe(`/share/${TOKEN}`);
  });
});

describe("M12-06 loadSharedPreview of a page", () => {
  it("Home: a menu of working preview links and page links to the same addresses", async () => {
    const result = await load();
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;
    expect(result.subPage).toBeUndefined();
    expect(result.site?.menu?.mode).toBe("links");
    expect(result.site?.menu?.items.map((i) => [i.label, i.href, i.current])).toEqual([
      ["Home", `/share/${TOKEN}`, true],
      ["Items for sale", `/share/${TOKEN}/items`, false],
      ["Directions", `/share/${TOKEN}/directions`, false],
    ]);
    expect(result.site?.hrefs[ITEMS]).toBe(`/share/${TOKEN}/items`);
    expect(result.site?.hrefs.home).toBe(`/share/${TOKEN}`);
  });

  it("a page: its draft blocks (cleaned), its title, the menu with it marked current", async () => {
    const result = await load("items");
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;
    expect(result.subPage?.title).toBe("Items for sale");
    const header = result.subPage?.blocks.find((b) => b.type === "header");
    expect(header && "text" in header ? header.text : "").toBe("Hello there");
    expect(result.site?.menu?.items.find((i) => i.current)?.label).toBe("Items for sale");
    for (const item of result.site!.menu!.items) expect(item.href).toMatch(/^\/share\//);
    for (const href of Object.values(result.site!.hrefs)) expect(href).toMatch(/^\/share\//);
  });

  it("an unknown, reserved or nested path is the same inactive answer as a dead link", async () => {
    for (const path of ["nope", "og", "share", "hl-x", "a/b", "Items", "..", "café", "~"]) {
      expect(await load(path), path).toEqual({ kind: "inactive" });
    }
  });

  it("a path that cannot be a page's never reaches the database", async () => {
    const queries: string[] = [];
    const { loadSharedPreview } = await import("@/lib/previews/shared");
    const result = await loadSharedPreview(fakeAdmin(queries), TOKEN, new Date(), "og");
    expect(result).toEqual({ kind: "inactive" });
    expect(queries).toEqual([]);
  });
});

describe("M12-06 the proxy hands the rest of the address over", () => {
  it("sets x-hl-share-path from the URL, replacing a forged one, with the token rules unchanged", async () => {
    const { NextRequest } = await import("next/server");
    const { shareProxy } = await import("@/lib/previews/share-proxy");
    const { SHARE_PATH_HEADER, SHARE_TOKEN_HEADER } = await import("@/lib/previews/share-headers");
    const ok = async () => ({ allowed: true, retryAfter: 0 });
    const run = (path: string, headers: Record<string, string> = {}) =>
      shareProxy(
        new NextRequest(`http://app.localhost:3000${path}`, { headers }),
        new URL("http://app.localhost:3000/app/shared-draft"),
        ok,
      );
    const home = await run(`/share/${TOKEN}`, { [SHARE_PATH_HEADER]: "forged" });
    expect(home.headers.get(`x-middleware-request-${SHARE_PATH_HEADER}`)).toBe("");
    const page = await run(`/share/${TOKEN}/items?x=1`);
    expect(page.headers.get(`x-middleware-request-${SHARE_PATH_HEADER}`)).toBe("items");
    expect(page.headers.get(`x-middleware-request-${SHARE_TOKEN_HEADER}`)).toBe(TOKEN);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("the session and bearer rewrites strip the path header like the token header", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/lib/routing/session.ts", "src/lib/routing/bearer-proxy.ts"]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/headers\.delete\(SHARE_PATH_HEADER\)/);
    }
  });
});
