import { describe, expect, it } from "vitest";
import type { ArchiveSummary } from "@/lib/blog/types";
import { pruneNav } from "@/lib/document";
import { homeForSite } from "@/lib/publish/site-checks";
import { archiveMenuEntries, siteContextFrom } from "@/lib/site/live";
import { buildMenu } from "@/lib/site/menu";
import { fullPublished } from "./fixtures/page-document";

/**
 * M16-08: the archive in the site menu. A menu item is an id; one that names a content type with
 * an enabled archive links to `/{archive}` under the type's plural label. An item whose type is off
 * or unknown is hidden like any item that points at nothing; pruning keeps a type id of this site.
 */

const PAGE = "00000000-0000-4000-8000-0000000000a1";
const TYPE = "00000000-0000-4000-8000-0000000000d1";
const FOREIGN = "00000000-0000-4000-8000-0000000000d9";
const live = [{ id: PAGE, path: "items", title: "Items" }];
const blog: ArchiveSummary = {
  typeId: TYPE,
  key: "post",
  path: "blog",
  label: "Post",
  labelPlural: "Posts",
  pageSize: 10,
};

describe("buildMenu with an archive item", () => {
  it("a live archive is an entry with the type's plural label and its path", () => {
    const context = siteContextFrom(live, { nav: { show: true, items: [TYPE, PAGE] } }, "home", [
      blog,
    ]);
    expect(context.menu?.items).toEqual([
      { label: "Home", href: "/", current: true },
      { label: "Posts", href: "/blog", current: false },
      { label: "Items", href: "/items", current: false },
    ]);
    // The archive is not a page-link target.
    expect(context.hrefs).toEqual({ [PAGE]: "/items" });
  });

  it("it is current on the archive's own pages and on post pages (the type's id is the current id)", () => {
    const menu = siteContextFrom(live, { nav: { show: true, items: [TYPE, PAGE] } }, TYPE, [
      blog,
    ]).menu;
    expect(menu?.items.map((item) => item.current)).toEqual([false, true, false]);
  });

  it("with the blog off, or for an unknown type id, the item is hidden; the rest of the menu stays", () => {
    const off = siteContextFrom(
      live,
      { nav: { show: true, items: [TYPE, PAGE] } },
      "home",
      [],
    ).menu;
    expect(off?.items.map((item) => item.label)).toEqual(["Home", "Items"]);
    const unknown = siteContextFrom(live, { nav: { show: true, items: [FOREIGN] } }, "home", [
      blog,
    ]);
    expect(unknown.menu).toBeNull();
    // A menu of the blog alone is a menu.
    const alone = siteContextFrom([], { nav: { show: true, items: [TYPE] } }, "home", [blog]).menu;
    expect(alone?.items.map((item) => item.href)).toEqual(["/", "/blog"]);
  });

  it("renaming the archive path changes the link; a path that is no path makes no entry", () => {
    const moved = buildMenu(
      { show: true, items: [TYPE] },
      archiveMenuEntries([{ ...blog, path: "news" }]),
      "home",
    );
    expect(moved?.items[1]?.href).toBe("/news");
    const bad = buildMenu(
      { show: true, items: [TYPE] },
      archiveMenuEntries([{ ...blog, path: "//evil" }]),
      "home",
    );
    expect(bad).toBeNull();
  });

  it("latestPosts is passed through only when given", () => {
    expect("latestPosts" in siteContextFrom(live, {}, "home")).toBe(false);
    expect(siteContextFrom(live, {}, "home", [], null).latestPosts).toBeNull();
  });
});

describe("pruneNav and homeForSite", () => {
  it("keeps a type id of this site and drops one of another site", () => {
    const nav = { show: true, items: [TYPE, PAGE, FOREIGN, TYPE] };
    expect(pruneNav(nav, [PAGE], [TYPE]).items).toEqual([TYPE, PAGE]);
    // Without the site's type ids (the callers before Wave B) a type id is dropped, as any unknown id.
    expect(pruneNav(nav, [PAGE]).items).toEqual([PAGE]);
  });

  it("Publish design stores the menu with the blog item and is never blocked by it", () => {
    const home = { ...fullPublished, nav: { show: true, items: [TYPE, PAGE, FOREIGN] } };
    expect(homeForSite(home, [PAGE], [TYPE]).nav).toEqual({ show: true, items: [TYPE, PAGE] });
    expect(homeForSite(home, [PAGE]).nav).toEqual({ show: true, items: [PAGE] });
  });
});
