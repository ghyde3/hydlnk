// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublishBarView,
  type PublishBarViewProps,
} from "@/components/workspace/publish-bar/publish-bar-view";
import {
  NOT_LIVE_NOTE,
  changeCountLabel,
  publishRows,
} from "@/components/workspace/publish-bar/rows";
import { ITEM_STATE_LABEL, type ItemPublishState } from "@/lib/publish/status";
import { PAGE_STATE_LABEL, itemStateOf, orderSitePages } from "@/lib/site-pages/pages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M15-10: the publish bar shows each part's status (Live, Unpublished changes, Draft), names its
 * buttons exactly, turns the right ones off and keeps every button at least 44px tall.
 */
const ABOUT = "11111111-1111-4111-8111-111111111111";
const SHOP = "22222222-2222-4222-8222-222222222222";
const items = orderSitePages("Home", { show: true, items: [SHOP] }, [
  { id: ABOUT, title: "About", path: "about", livePath: "about", createdAt: "2026-01-01" },
  { id: SHOP, title: "Shop", path: "shop", livePath: null, createdAt: "2026-01-02" },
]);
const rowsOf = (
  design: ItemPublishState,
  home: ItemPublishState,
  pages: Record<string, ItemPublishState>,
) => publishRows({ items, design, home, pages });

let host: HTMLDivElement;
let root: Root;
const handlers = {
  onPublishDesign: vi.fn(),
  onPublishPage: vi.fn(),
  onPublishAll: vi.fn(),
  onRevisions: vi.fn(),
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  for (const handler of Object.values(handlers)) handler.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(overrides: Partial<PublishBarViewProps> = {}) {
  const props: PublishBarViewProps = {
    rows: rowsOf("changed", "live", { [ABOUT]: "changed", [SHOP]: "draft" }),
    siteLive: true,
    publishingItem: null,
    disabledReason: null,
    ...handlers,
    ...overrides,
  };
  act(() => root.render(<PublishBarView {...props} />));
}
const row = (key: string) => host.querySelector<HTMLElement>(`[data-testid="publish-row-${key}"]`)!;
const buttons = (within: ParentNode = host) => [
  ...within.querySelectorAll<HTMLButtonElement>("button"),
];
const button = (within: ParentNode, name: string) =>
  buttons(within).find((candidate) => candidate.textContent === name)!;

describe("M15-10 the rows of the publish bar", () => {
  it("lists Design, Home, then the pages in the order of the pages card", () => {
    render();
    const keys = [...host.querySelectorAll("[data-testid^='publish-row-']")].map((element) =>
      element.getAttribute("data-testid"),
    );
    // Shop is in the menu, so it comes before About, as the pages card lists them.
    expect(keys).toEqual([
      "publish-row-design",
      "publish-row-home",
      `publish-row-${SHOP}`,
      `publish-row-${ABOUT}`,
    ]);
    expect(row("design").textContent).toContain("Theme, menu and profile");
    expect(row(ABOUT).textContent).toContain("/about");
  });

  it("each row carries data-state and the one label for it: Live, Unpublished changes, Draft", () => {
    render();
    const expected: [string, ItemPublishState, string][] = [
      ["design", "changed", "Unpublished changes"],
      ["home", "live", "Live"],
      [ABOUT, "changed", "Unpublished changes"],
      [SHOP, "draft", "Draft"],
    ];
    for (const [key, state, label] of expected) {
      expect(row(key).getAttribute("data-state")).toBe(state);
      const chip = row(key).querySelector("[data-item-state]")!;
      expect(chip.getAttribute("data-item-state")).toBe(state);
      expect(chip.textContent).toBe(label);
    }
    expect(ITEM_STATE_LABEL).toEqual({
      live: "Live",
      changed: "Unpublished changes",
      draft: "Draft",
    });
  });

  it("the pages card says the same three words", () => {
    for (const state of ["live", "unpublished", "changed"] as const) {
      expect(PAGE_STATE_LABEL[state]).toBe(ITEM_STATE_LABEL[itemStateOf(state)]);
    }
  });
});

describe("M15-10 the buttons of the publish bar", () => {
  it("are named exactly: one Publish design, one Publish page and one Revisions per page, one Publish all changes", () => {
    render();
    const names = buttons().map((candidate) => candidate.textContent);
    expect(names.filter((name) => name === "Publish design")).toHaveLength(1);
    expect(names.filter((name) => name === "Publish page")).toHaveLength(3);
    expect(names.filter((name) => name === "Revisions")).toHaveLength(3);
    expect(names.filter((name) => name === "Publish all changes")).toHaveLength(1);
    expect(names).toHaveLength(8);
    // No aria-label rewrites a name; a page's buttons are described by its title instead.
    for (const candidate of buttons()) expect(candidate.hasAttribute("aria-label")).toBe(false);
    expect(buttons(row("design")).map((b) => b.textContent)).toEqual(["Publish design"]);
    for (const key of ["home", ABOUT, SHOP]) {
      expect(buttons(row(key)).map((b) => b.textContent)).toEqual(["Revisions", "Publish page"]);
      const described = button(row(key), "Publish page").getAttribute("aria-describedby")!;
      expect(document.getElementById(described)?.textContent).toBe(
        key === "home" ? "Home" : key === ABOUT ? "About" : "Shop",
      );
    }
  });

  it("every button is at least 44px tall (min-h-11) and is a real button", () => {
    render();
    expect(buttons().length).toBeGreaterThan(0);
    for (const candidate of buttons()) {
      expect(candidate.className.split(/\s+/)).toContain("min-h-11");
      expect(candidate.getAttribute("type")).toBe("button");
    }
    // Every row is at least 56px tall.
    for (const element of host.querySelectorAll("[data-testid^='publish-row-']")) {
      expect(element.className.split(/\s+/)).toContain("min-h-14");
    }
  });

  it("a live row's publish button is off; a changed or draft row's is on", () => {
    render();
    expect(button(row("home"), "Publish page").disabled).toBe(true);
    expect(button(row("design"), "Publish design").disabled).toBe(false);
    expect(button(row(ABOUT), "Publish page").disabled).toBe(false);
    expect(button(row(SHOP), "Publish page").disabled).toBe(false);
    expect(button(host, "Publish all changes").disabled).toBe(false);
    expect(host.querySelector("[data-testid='publish-bar-count']")!.textContent).toBe("3 changes");
  });

  it("while one publishes, every button is off and only the running one is busy", () => {
    render({ publishingItem: ABOUT });
    for (const candidate of buttons()) expect(candidate.disabled).toBe(true);
    const busy = buttons().filter((candidate) => candidate.getAttribute("aria-busy") === "true");
    expect(busy).toHaveLength(1);
    expect(row(ABOUT).contains(busy[0]!)).toBe(true);
    expect(busy[0]!.textContent).toBe("Publish page");

    render({ publishingItem: "all" });
    const all = buttons().filter((candidate) => candidate.getAttribute("aria-busy") === "true");
    expect(all.map((candidate) => candidate.textContent)).toEqual(["Publish all changes"]);
  });

  it("on a site never published only Publish all changes is on, and the bar says why", () => {
    render({
      siteLive: false,
      rows: rowsOf("draft", "draft", { [ABOUT]: "draft", [SHOP]: "draft" }),
    });
    expect(host.querySelector("[data-testid='publish-bar-not-live']")!.textContent).toBe(
      "This site isn’t live yet. Publish all changes to put it online.",
    );
    expect(NOT_LIVE_NOTE).not.toMatch(/!|please|successfully/i);
    const enabled = buttons().filter(
      (candidate) => !candidate.disabled && candidate.textContent !== "Revisions",
    );
    expect(enabled.map((candidate) => candidate.textContent)).toEqual(["Publish all changes"]);
  });

  it("with everything live there is nothing to publish: the footer says so and every publish button is off", () => {
    render({ rows: rowsOf("live", "live", { [ABOUT]: "live", [SHOP]: "live" }) });
    expect(host.querySelector("[data-testid='publish-bar-not-live']")).toBeNull();
    expect(host.querySelector("[data-testid='publish-bar-count']")!.textContent).toBe("No changes");
    for (const candidate of buttons()) {
      if (candidate.textContent !== "Revisions") expect(candidate.disabled).toBe(true);
    }
    expect(changeCountLabel(1)).toBe("1 change");
  });

  it("a reason publishing is off (a suspended account) turns every publish button off and is their title", () => {
    render({ disabledReason: "Your account is suspended." });
    for (const candidate of buttons()) {
      if (candidate.textContent === "Revisions") continue;
      expect(candidate.disabled).toBe(true);
      expect(candidate.title).toBe("Your account is suspended.");
    }
  });

  it("each button calls its own action with its own row", () => {
    render();
    act(() => button(row("design"), "Publish design").click());
    act(() => button(row(ABOUT), "Publish page").click());
    act(() => button(row(SHOP), "Revisions").click());
    act(() => button(host, "Publish all changes").click());
    expect(handlers.onPublishDesign).toHaveBeenCalledTimes(1);
    expect(handlers.onPublishPage).toHaveBeenCalledTimes(1);
    expect(handlers.onPublishPage).toHaveBeenCalledWith(ABOUT);
    expect(handlers.onRevisions).toHaveBeenCalledWith(expect.objectContaining({ key: SHOP }));
    expect(handlers.onPublishAll).toHaveBeenCalledTimes(1);
  });
});
