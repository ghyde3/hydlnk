import { beforeEach, describe, expect, it, vi } from "vitest";
import { toSubPagePublishForm, type PublishDoc } from "@/lib/document";
import {
  nullMissingImages,
  nullMissingSubPageImages,
  ownedImagePaths,
  versionToDraft,
  versionToSubPageDraft,
  restoredTheme,
} from "@/lib/versions/restore";
import { parseStoredSubPages, versionIsLive } from "@/lib/versions/site";
import { OWNER_UID, bannerRef, fullPublished, photoRef } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

const { loadVersionPreviewCore, restorePageVersionCore } = await import("@/lib/versions/core");

/**
 * M12-04: whole-site versions. The pure half (parse, live flag, image helpers, the restored menu)
 * and the restore core against a recording stand-in for the secret-key client: two sub-pages
 * restored, one deleted since, one saved meanwhile, the menu kept, items photos checked.
 */

const ORIGIN = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;

const OWNER = OWNER_UID;
const PAGE = "00000000-0000-4000-8000-0000000000b1";
const VERSION = "11111111-1111-4111-8111-111111111111";
const ITEMS_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DIR_ID = "aaaaaaaa-0000-4000-8000-000000000002";
const NEW_ID = "aaaaaaaa-0000-4000-8000-000000000003";

const itemPhoto = {
  path: `${OWNER}/item-photo-aaaaaaaa.webp`,
  width: 600,
  height: 600,
};

function sub(path: string, title: string, blockId: string, extra: unknown[] = []) {
  return toSubPagePublishForm({
    path,
    title,
    description: `About ${title}`,
    blocks: [
      {
        id: blockId,
        type: "link",
        visible: true,
        label: `Open ${title}`,
        url: "https://example.com/a",
      },
      ...extra,
    ],
  } as never);
}

const itemsBlock = {
  id: "itemsblock0001",
  type: "items",
  visible: true,
  layout: "grid",
  items: [
    {
      id: "itemone000001",
      name: "Mug",
      price: "$12",
      description: "",
      sold: false,
      image: itemPhoto,
    },
    { id: "itemtwo000001", name: "Cup", price: "$9", description: "", sold: false },
  ],
};

const itemsDoc = sub("items", "Items for sale", "itemslink0001", [itemsBlock]);
const dirDoc = sub("directions", "Find the studio", "dirlink000001");

const home: PublishDoc = { ...fullPublished, nav: { show: true, items: [ITEMS_ID, DIR_ID] } };
const storedSubs = [
  { id: DIR_ID, path: "directions", title: dirDoc.title, published: dirDoc },
  { id: ITEMS_ID, path: "items", title: itemsDoc.title, published: itemsDoc },
];

interface World {
  /** site_pages rows: `seen` is what the first read returns, `actual` what a write is guarded against. */
  sites: { id: string; page_id: string; seen: string; actual: string }[];
  blockedBlockIds: string[];
  writeFails: string[];
}

function makeClient(world: World) {
  const writes: { table: string; filters: [string, unknown][]; payload: unknown }[] = [];
  const draft = {
    version: 1,
    rev: 4,
    profile: { name: "Old", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: [],
  };
  const data: Record<string, Record<string, unknown>[]> = {
    pages: [{ id: PAGE, owner_id: OWNER, draft, draft_rev: "4" }],
    accounts: [{ id: OWNER, plan: "pro", suspended_at: null }],
    page_versions: [
      { id: VERSION, page_id: PAGE, version_no: 3, document: home, sub_pages: storedSubs },
    ],
    themes: [],
    site_pages: world.sites.map((row) => ({
      id: row.id,
      page_id: row.page_id,
      updated_at: row.seen,
    })),
  };
  function from(table: string) {
    const filters: [string, unknown][] = [];
    let kind: "select" | "update" = "select";
    let payload: unknown;
    const matches = (row: Record<string, unknown>) =>
      filters.every(([column, value]) => {
        if (column === "owner_id.is.null,owner_id.eq")
          return row.owner_id === null || row.owner_id === value;
        if (column === "draft->>rev") return row.draft_rev === value;
        return row[column] === value;
      });
    const builder = {
      select: () => builder,
      update(values: unknown) {
        kind = "update";
        payload = values;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      or(expression: string) {
        filters.push([
          "owner_id.is.null,owner_id.eq",
          /owner_id\.eq\.([^,)]+)/.exec(expression)?.[1],
        ]);
        return builder;
      },
      async maybeSingle() {
        return { data: data[table]!.find(matches) ?? null, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        if (kind === "update") {
          writes.push({ table, filters: [...filters], payload });
          if (table === "site_pages") {
            const id = filters.find(([c]) => c === "id")?.[1];
            if (world.writeFails.includes(id as string))
              return resolve({ data: null, error: { code: "23514", message: "x" } });
            const guard = filters.find(([c]) => c === "updated_at")?.[1];
            const row = world.sites.find((r) => r.id === id);
            return resolve({ data: row && row.actual === guard ? [{ id }] : [], error: null });
          }
          return resolve({ data: [{ id: PAGE }], error: null });
        }
        return resolve({ data: data[table]!.filter(matches), error: null });
      },
    };
    return builder;
  }
  return {
    writes,
    client: {
      from,
      rpc: (_fn: string, args: { p_draft?: unknown } & Record<string, unknown>) => {
        const text = JSON.stringify(args);
        const rows = world.blockedBlockIds
          .filter((id) => text.includes(id))
          .map((id) => ({
            block_id: id,
            item_id: null,
            field: "url",
            host: "bad.example",
            reason: "blocked_domain",
          }));
        return Promise.resolve({ data: rows, error: null });
      },
      storage: { from: () => ({ exists: async () => ({ data: true, error: null }) }) },
    } as never,
  };
}

const world = (over: Partial<World> = {}): World => ({
  sites: [
    {
      id: ITEMS_ID,
      page_id: PAGE,
      seen: "2026-10-06T10:00:00.123456+00:00",
      actual: "2026-10-06T10:00:00.123456+00:00",
    },
    {
      id: DIR_ID,
      page_id: PAGE,
      seen: "2026-10-06T10:00:01.000001+00:00",
      actual: "2026-10-06T10:00:01.000001+00:00",
    },
  ],
  blockedBlockIds: [],
  writeFails: [],
  ...over,
});

const input = { pageId: PAGE, versionId: VERSION, userId: OWNER };
const deps = (client: never) => ({ admin: client, mediaExists: async () => true });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("M12-04 restore across pages", () => {
  it("M12-04 two sub-pages that still exist are written, each guarded by its own updated_at, after Home", async () => {
    const { client, writes } = makeClient(world());
    const result = await restorePageVersionCore(input, deps(client));
    expect(result).toEqual({
      ok: true,
      restored: 3,
      missingImages: 0,
      pagesRestored: 2,
      notRestored: [],
    });
    expect(writes.map((w) => w.table)).toEqual(["pages", "site_pages", "site_pages"]);
    const items = writes.find((w) => w.filters.some(([c, v]) => c === "id" && v === ITEMS_ID))!;
    expect(items.filters).toContainEqual(["updated_at", "2026-10-06T10:00:00.123456+00:00"]);
    expect(items.filters).toContainEqual(["page_id", PAGE]);
    const draft = items.payload as {
      draft: { path: string; title: string; blocks: { visible: boolean }[] };
    };
    expect(draft.draft.path).toBe("items");
    expect(draft.draft.title).toBe("Items for sale");
    expect(draft.draft.blocks.every((b) => b.visible)).toBe(true);
    // nothing but drafts: no published column in any write
    for (const w of writes) expect(Object.keys(w.payload as object)).toEqual(["draft"]);
  });

  it("M12-04 Home's restored draft keeps the menu", async () => {
    const { client, writes } = makeClient(world());
    await restorePageVersionCore(input, deps(client));
    const homeWrite = writes.find((w) => w.table === "pages")!;
    expect((homeWrite.payload as { draft: { nav: unknown } }).draft.nav).toEqual({
      show: true,
      items: [ITEMS_ID, DIR_ID],
    });
    const theme = restoredTheme(home, home.tokens, null, false);
    const draft = versionToDraft(home, theme, 5);
    expect(draft.nav).toEqual({ show: true, items: [ITEMS_ID, DIR_ID] });
    expect(versionToDraft({ ...home, nav: undefined } as PublishDoc, theme, 5)).not.toHaveProperty(
      "nav",
    );
  });

  it("M12-04 a page deleted since is listed as not restored and the others are written", async () => {
    const { client, writes } = makeClient(
      world({ sites: world().sites.filter((row) => row.id !== DIR_ID) }),
    );
    const result = await restorePageVersionCore(input, deps(client));
    expect(result).toMatchObject({ ok: true, pagesRestored: 1 });
    expect(result.ok && result.notRestored).toEqual([
      { id: DIR_ID, path: "directions", title: "Find the studio", reason: "deleted" },
    ]);
    expect(writes.filter((w) => w.table === "site_pages")).toHaveLength(1);
  });

  it("M12-04 a page saved while the restore ran matches no row and is listed as changed", async () => {
    const w = world();
    w.sites[0]!.actual = "2026-10-06T10:05:00.000000+00:00";
    const { client } = makeClient(w);
    const result = await restorePageVersionCore(input, deps(client));
    expect(result).toMatchObject({ ok: true, pagesRestored: 1 });
    expect(result.ok && result.notRestored).toEqual([
      { id: ITEMS_ID, path: "items", title: "Items for sale", reason: "changed" },
    ]);
  });

  it("M12-04 a page whose draft write fails is listed, and one on the blocklist now is left alone with its hosts", async () => {
    const { client, writes } = makeClient(
      world({ writeFails: [DIR_ID], blockedBlockIds: ["itemslink0001"] }),
    );
    const result = await restorePageVersionCore(input, deps(client));
    expect(result.ok && result.notRestored).toEqual([
      { id: DIR_ID, path: "directions", title: "Find the studio", reason: "error" },
      {
        id: ITEMS_ID,
        path: "items",
        title: "Items for sale",
        reason: "blocked_link",
        hosts: ["bad.example"],
      },
    ]);
    expect(result).toMatchObject({ pagesRestored: 0 });
    // the blocked page was never written, the failing one was tried
    expect(writes.filter((w) => w.table === "site_pages")).toHaveLength(1);
  });

  it("M12-04 a page created after the version is not touched, and a version row without pages reads as none", async () => {
    const w = world();
    w.sites.push({
      id: NEW_ID,
      page_id: PAGE,
      seen: "2026-10-06T11:00:00+00:00",
      actual: "2026-10-06T11:00:00+00:00",
    });
    const { client, writes } = makeClient(w);
    await restorePageVersionCore(input, deps(client));
    expect(writes.some((x) => x.filters.some(([c, v]) => c === "id" && v === NEW_ID))).toBe(false);

    expect(parseStoredSubPages(undefined)).toEqual([]);
    expect(parseStoredSubPages([])).toEqual([]);
  });

  it("M12-04 preview returns each sub-page parsed, ordered by path, with its missing images counted", async () => {
    const { client, writes } = makeClient(world());
    const result = await loadVersionPreviewCore(input, {
      admin: client,
      mediaExists: async (path) => !path.includes("item-photo"),
    });
    expect(result.ok && result.subPages.map((p) => p.path)).toEqual(["directions", "items"]);
    expect(result).toMatchObject({ ok: true, missingImages: 1 });
    const items = result.ok ? result.subPages.find((p) => p.path === "items")! : null;
    const block = items!.doc.blocks.find((b) => b.type === "items") as {
      items: { image?: unknown }[];
    };
    expect(block.items.some((item) => item.image !== undefined)).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("M12-04 parsing the stored pages", () => {
  it("M12-04 an entry that does not parse, or a column that is not an array, is refused whole", () => {
    expect(parseStoredSubPages(storedSubs)?.map((p) => p.id)).toEqual([DIR_ID, ITEMS_ID]);
    expect(parseStoredSubPages({})).toBeNull();
    expect(parseStoredSubPages([{ id: "x", published: dirDoc }])).toBeNull();
    expect(parseStoredSubPages([{ id: DIR_ID, published: { path: "x" } }])).toBeNull();
  });
});

describe("M12-04 the live flag compares the pages too", () => {
  const liveSubs = [
    { id: ITEMS_ID, published: itemsDoc },
    { id: DIR_ID, published: dirDoc },
  ];
  it("M12-04 equal Home and equal pages (in any order) is live", () => {
    expect(
      versionIsLive({ document: home, subPages: storedSubs }, { home, subPages: liveSubs }),
    ).toBe(true);
  });
  it("M12-04 only a sub-page differing is not live", () => {
    const changed = { ...dirDoc, title: "Elsewhere" };
    expect(
      versionIsLive(
        { document: home, subPages: storedSubs },
        { home, subPages: [liveSubs[0]!, { id: DIR_ID, published: changed }] },
      ),
    ).toBe(false);
  });
  it("M12-04 a page added or removed since is not live, and a pre-M2 version never matches a site with pages", () => {
    expect(
      versionIsLive({ document: home, subPages: storedSubs }, { home, subPages: [liveSubs[0]!] }),
    ).toBe(false);
    expect(versionIsLive({ document: home, subPages: [] }, { home, subPages: liveSubs })).toBe(
      false,
    );
    expect(versionIsLive({ document: home, subPages: [] }, { home, subPages: [] })).toBe(true);
    expect(
      versionIsLive({ document: home, subPages: storedSubs }, { home: null, subPages: [] }),
    ).toBe(false);
  });
});

describe("M12-04 item photos and sub-page images", () => {
  const doc: PublishDoc = {
    ...fullPublished,
    blocks: [...fullPublished.blocks, itemsBlock as never],
  };

  it("M12-04 ownedImagePaths names an item's photo, and the images of sub-pages", () => {
    const paths = ownedImagePaths(doc, OWNER, ORIGIN);
    expect(paths).toContain(itemPhoto.path);
    expect(ownedImagePaths(fullPublished, OWNER, ORIGIN, [itemsDoc])).toContain(itemPhoto.path);
    expect(ownedImagePaths(fullPublished, OWNER, ORIGIN, [dirDoc])).not.toContain(itemPhoto.path);
    // another user's folder is never looked up
    const foreign = {
      ...itemsBlock,
      items: [
        {
          ...itemsBlock.items[0]!,
          image: { ...itemPhoto, path: `11111111-2222-4333-8444-555555555555/x.webp` },
        },
      ],
    };
    expect(
      ownedImagePaths({ ...fullPublished, blocks: [foreign as never] }, OWNER, ORIGIN),
    ).not.toContain(`11111111-2222-4333-8444-555555555555/x.webp`);
  });

  it("M12-04 nullMissingImages takes the photo off the item that lost it and counts it; the item stays", () => {
    const result = nullMissingImages(doc, OWNER, ORIGIN, (path) => path !== itemPhoto.path);
    const block = result.doc.blocks.find((b) => b.id === "itemsblock0001") as {
      items: { id: string; image?: unknown }[];
    };
    expect(block.items.map((i) => i.id)).toEqual(["itemone000001", "itemtwo000001"]);
    expect(block.items[0]).not.toHaveProperty("image");
    // the photo, the card image, the image block, the share image and the others still counted as before
    const baseline = nullMissingImages(
      fullPublished,
      OWNER,
      ORIGIN,
      (path) => path !== itemPhoto.path,
    );
    expect(result.missingImages).toBe(baseline.missingImages + 1);
    // input untouched
    expect(
      (doc.blocks.find((b) => b.id === "itemsblock0001") as { items: { image?: unknown }[] })
        .items[0]!.image,
    ).toEqual(itemPhoto);
  });

  it("M12-04 nothing missing returns the same block objects", () => {
    const result = nullMissingImages(doc, OWNER, ORIGIN, () => true);
    expect(result.missingImages).toBe(0);
    expect(result.doc.blocks.find((b) => b.id === "itemsblock0001")).toBe(
      doc.blocks.find((b) => b.id === "itemsblock0001"),
    );
    void photoRef;
    void bannerRef;
  });

  it("M12-04 a sub-page loses its missing images the same way, and its draft shows every block", () => {
    const checked = nullMissingSubPageImages(itemsDoc, OWNER, () => false);
    expect(checked.missingImages).toBe(1);
    const block = checked.page.blocks.find((b) => b.id === "itemsblock0001") as {
      items: { image?: unknown }[];
    };
    expect(block.items[0]).not.toHaveProperty("image");
    const draft = versionToSubPageDraft(checked.page);
    expect(draft).toMatchObject({
      path: "items",
      title: "Items for sale",
      description: "About Items for sale",
    });
    expect(draft.blocks.every((b) => b.visible === true)).toBe(true);
  });
});
