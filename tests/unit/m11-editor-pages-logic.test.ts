import { describe, expect, it } from "vitest";
import { emptySubPageDraft } from "@/lib/document";
import {
  addToNav,
  navIsFull,
  moveInNav,
  orderSitePages,
  pageLimitState,
  pathProblem,
  removeFromNav,
  takenPaths,
  titleOf,
  type SubPageSummary,
} from "@/lib/site-pages/pages";
import { docOf, initSiteState, siteReducer } from "@/components/site/site-state";

/** M11-08: the pure logic of the editor's page list, menu moves, limits and per-page state. */

const sub = (id: string, path: string, created: string, over: Partial<SubPageSummary> = {}) => ({
  id,
  title: path.toUpperCase(),
  path,
  livePath: null,
  createdAt: created,
  ...over,
});

describe("orderSitePages", () => {
  const pages = [sub("a", "a", "1"), sub("b", "b", "2"), sub("c", "c", "3")];
  it("is Home, then the menu in its order, then the pages outside the menu by creation", () => {
    const items = orderSitePages("Home", { show: true, items: ["c", "a"] }, pages);
    expect(items.map((i) => i.id)).toEqual(["home", "c", "a", "b"]);
    expect(items.map((i) => i.inMenu)).toEqual([true, true, true, false]);
    expect(items.map((i) => i.menuIndex)).toEqual([null, 0, 1, null]);
    expect(items[1]).toMatchObject({ path: "/c", home: false });
    expect(items[0]).toMatchObject({ path: "/", home: true, title: "Home" });
  });
  it("skips menu ids that are not pages and repeats", () => {
    const items = orderSitePages("Home", { show: true, items: ["zz", "a", "a"] }, pages);
    expect(items.map((i) => i.id)).toEqual(["home", "a", "b", "c"]);
  });
  it("a site with no menu lists its pages by creation", () => {
    expect(orderSitePages("Home", undefined, pages).map((i) => i.id)).toEqual([
      "home",
      "a",
      "b",
      "c",
    ]);
  });
});

describe("paths", () => {
  const pages = [sub("a", "items", "1", { livePath: "old-items" }), sub("b", "map", "2")];
  it("a page's taken paths are the others' draft and live paths", () => {
    expect(takenPaths(pages).sort()).toEqual(["items", "map", "old-items"]);
    expect(takenPaths(pages, "a").sort()).toEqual(["map"]);
  });
  it("pathProblem reports the rule, the reserved list and a taken path, in that order", () => {
    expect(pathProblem("Bad Path", [])).toMatch(/lowercase/);
    expect(pathProblem("og", [])).toMatch(/reserved/);
    expect(pathProblem("hl-x", [])).toMatch(/reserved/);
    expect(pathProblem("map", ["map"])).toMatch(/already uses that path/);
    expect(pathProblem("fresh", ["map"])).toBeNull();
  });
});

describe("menu moves", () => {
  it("add appends once, remove drops, move swaps neighbours and stops at the ends", () => {
    expect(addToNav(undefined, "a")).toEqual({ show: true, items: ["a"] });
    expect(addToNav({ show: false, items: ["a"] }, "a")).toEqual({ show: false, items: ["a"] });
    expect(removeFromNav({ show: true, items: ["a", "b"] }, "a").items).toEqual(["b"]);
    const nav = { show: true, items: ["a", "b", "c"] };
    expect(moveInNav(nav, "c", -1).items).toEqual(["a", "c", "b"]);
    expect(moveInNav(nav, "a", 1).items).toEqual(["b", "a", "c"]);
    expect(moveInNav(nav, "a", -1).items).toEqual(["a", "b", "c"]);
    expect(moveInNav(nav, "c", 1).items).toEqual(["a", "b", "c"]);
    expect(moveInNav(nav, "x", 1).items).toEqual(["a", "b", "c"]);
  });
  it("a page joins the menu only while it has fewer than 20 items", () => {
    const items = Array.from({ length: 19 }, (_, i) => `p${i}`);
    const nineteen = addToNav({ show: true, items }, "last");
    expect(nineteen.items).toHaveLength(20);
    expect(navIsFull(nineteen)).toBe(true);
    // The 21st is created but stays out of the menu, so Home's draft keeps validating.
    expect(addToNav(nineteen, "extra").items).toEqual(nineteen.items);
    expect(navIsFull({ show: true, items })).toBe(false);
  });
});

describe("limits", () => {
  it("counts Home: Free is at its limit with 2 sub-pages, Pro with 9, Studio is Unlimited", () => {
    expect(pageLimitState("free", 1)).toMatchObject({ used: 2, max: 3, atLimit: false });
    expect(pageLimitState("free", 2)).toMatchObject({ used: 3, max: 3, atLimit: true });
    expect(pageLimitState("pro", 9)).toMatchObject({ used: 10, max: 10, atLimit: true });
    expect(pageLimitState("studio", 20)).toMatchObject({ atLimit: false, unlimited: true });
  });
  it("a blank title reads as Untitled page", () => {
    expect(titleOf({ title: "  " })).toBe("Untitled page");
    expect(titleOf({ title: " Menu " })).toBe("Menu");
  });
});

describe("site state", () => {
  const draft = (title: string) => emptySubPageDraft("items", title);
  it("holds each sub-page's settings and blocks, and the document is the two together", () => {
    const state = initSiteState([{ id: "a", draft: draft("One") }]);
    expect(docOf(state, "a")).toEqual(draft("One"));
    expect(docOf(state, "nope")).toBeNull();
  });
  it("block actions go through the Home editor reducer, per page", () => {
    let state = initSiteState([
      { id: "a", draft: draft("One") },
      { id: "b", draft: draft("Two") },
    ]);
    state = siteReducer(state, {
      type: "editor",
      id: "a",
      action: { type: "block/add", blockType: "header" },
    });
    expect(docOf(state, "a")!.blocks.map((b) => b.type)).toEqual(["header"]);
    expect(docOf(state, "b")!.blocks).toEqual([]);
    // Undo is that page's own history.
    state = siteReducer(state, { type: "editor", id: "a", action: { type: "history/undo" } });
    expect(docOf(state, "a")!.blocks).toEqual([]);
  });
  it("settings change one page; a no-op returns the same state", () => {
    const state = initSiteState([{ id: "a", draft: draft("One") }]);
    const next = siteReducer(state, { type: "settings", id: "a", patch: { title: "Two" } });
    expect(docOf(next, "a")!.title).toBe("Two");
    expect(siteReducer(next, { type: "settings", id: "a", patch: { title: "Two" } })).toBe(next);
    expect(siteReducer(next, { type: "settings", id: "zz", patch: { title: "x" } })).toBe(next);
  });
  it("add and remove keep the order and never repeat an id", () => {
    let state = initSiteState([]);
    state = siteReducer(state, { type: "add", id: "a", draft: draft("A") });
    state = siteReducer(state, { type: "add", id: "b", draft: draft("B") });
    expect(siteReducer(state, { type: "add", id: "a", draft: draft("A") })).toBe(state);
    expect(state.ids).toEqual(["a", "b"]);
    state = siteReducer(state, { type: "remove", id: "a" });
    expect(state.ids).toEqual(["b"]);
    expect(docOf(state, "a")).toBeNull();
    expect(siteReducer(state, { type: "remove", id: "a" })).toBe(state);
  });
  it("a page link block can be added to a sub-page", () => {
    let state = initSiteState([{ id: "a", draft: draft("A") }]);
    state = siteReducer(state, {
      type: "editor",
      id: "a",
      action: { type: "block/add", blockType: "page_link" },
    });
    expect(docOf(state, "a")!.blocks[0]).toMatchObject({
      type: "page_link",
      target: "home",
    });
  });
});
