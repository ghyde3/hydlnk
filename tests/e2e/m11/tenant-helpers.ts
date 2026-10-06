import { adminClient } from "../fixtures/auth";
import { insertPage, makeUser, rand, type TestUser } from "../fixtures/data";

/**
 * Setup for the tenant sub-page specs (M11-05, M11-06, M11-07, M11-10): a user of their own with a
 * site whose Home is a copy of mara's, and two sub-pages with the shape of mara's (`items` and
 * `directions`). Written with the secret key; mara's rows are only read, never modified.
 */

export const ITEMS = { path: "items", title: "Items for sale", blockId: "tnItemsLink01" } as const;
export const DIRECTIONS = {
  path: "directions",
  title: "Find the studio",
  blockId: "tnDirLink0001",
} as const;
/** A page link on Home to the items page, and one on the items page back to Home. */
export const HOME_PAGE_LINK = { id: "tnHomeToItems1", label: "See the items" } as const;
export const BACK_PAGE_LINK = { id: "tnItemsToHome1", label: "Back to Home" } as const;

export interface LiveSite {
  user: TestUser;
  pageId: string;
  handle: string;
  /** Home's profile name. */
  name: string;
  itemsId: string;
  directionsId: string;
}

type Doc = Record<string, unknown> & { profile: Record<string, unknown>; blocks: unknown[] };

const subDoc = (page: typeof ITEMS | typeof DIRECTIONS, extra: unknown[] = []) => ({
  path: page.path,
  title: page.title,
  description: `About ${page.title}`,
  blocks: [
    {
      id: page.blockId,
      type: "link",
      visible: true,
      label: `Open ${page.title}`,
      url: "https://example.com/open",
    },
    ...extra,
  ],
});

export interface SiteOptions {
  plan?: "free" | "pro" | "studio";
  /** Sub-pages published (live), or draft only. Default: live. */
  live?: boolean;
  /** Home published at all. Default true. */
  homePublished?: boolean;
}

/**
 * A user with a site: Home copied from mara's draft and published form (renamed), a page link to the
 * items page on Home, a menu of both sub-pages, and the two sub-pages (the items page links back to
 * Home). Home's `published` is written here, as Publish would leave it.
 */
export async function makeLiveSite(label: string, opts: SiteOptions = {}): Promise<LiveSite> {
  const admin = adminClient();
  const user = await makeUser(label, { plan: opts.plan ?? "free" });
  const handle = `zq-${label}-${rand(5)}`;
  const name = `Zq ${label} ${rand(4)}`;
  const live = opts.live !== false;

  const mara = await admin.from("pages").select("draft, published").eq("handle", "mara").single();
  if (mara.error) throw new Error(`seed page 'mara' missing: ${mara.error.message}`);
  const pageId = await insertPage(user.id, handle, {});

  const sub = async (page: typeof ITEMS | typeof DIRECTIONS, extra: unknown[] = []) => {
    const doc = subDoc(page, extra);
    const { data, error } = await admin
      .from("site_pages")
      .insert({
        page_id: pageId,
        draft: doc,
        ...(live ? { published: doc, published_at: new Date().toISOString() } : {}),
      })
      .select("id")
      .single();
    if (error) throw new Error(`sub-page ${page.path} failed: ${error.message}`);
    return data.id as string;
  };
  const itemsId = await sub(ITEMS, [
    {
      id: BACK_PAGE_LINK.id,
      type: "page_link",
      visible: true,
      label: BACK_PAGE_LINK.label,
      target: "home",
    },
  ]);
  const directionsId = await sub(DIRECTIONS);

  const home = (doc: unknown): Doc => {
    const copy = JSON.parse(JSON.stringify(doc)) as Doc;
    copy.profile.name = name;
    copy.blocks.push({
      id: HOME_PAGE_LINK.id,
      type: "page_link",
      visible: true,
      label: HOME_PAGE_LINK.label,
      target: itemsId,
    });
    (copy as Record<string, unknown>).nav = { show: true, items: [itemsId, directionsId] };
    return copy;
  };
  const update = await admin
    .from("pages")
    .update({
      draft: home(mara.data.draft),
      ...(opts.homePublished === false
        ? {}
        : { published: home(mara.data.published), published_at: new Date().toISOString() }),
    })
    .eq("id", pageId);
  if (update.error) throw new Error(`home failed: ${update.error.message}`);
  return { user, pageId, handle, name, itemsId, directionsId };
}

/** The `<loc>` addresses of a sitemap. */
export const locsOf = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
