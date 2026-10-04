// @vitest-environment jsdom
import { act, type ComponentProps, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UndoRedo } from "@/components/editor/use-undo-redo";
import { PlanProvider } from "@/components/versions/plan-context";
import { WorkspaceToolbar, type WorkspaceToolbarProps } from "@/components/workspace/toolbar";
import { ToolbarMenu } from "@/components/workspace/toolbar/toolbar-menu";
import { saveIndicatorText } from "@/components/workspace/toolbar/save-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...rest }, children),
}));
// PageName reads the browser Supabase client (the rename write): not part of what is tested here.
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({}) }));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/** matchMedia that says whether the viewport is 760px and up. */
function setViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes("min-width: 760px"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;

const undoRedo: UndoRedo = {
  canUndo: false,
  canRedo: false,
  undo: vi.fn(),
  redo: vi.fn(),
  message: "",
  messageSeq: 0,
  notice: null,
};

function props(overrides: Partial<WorkspaceToolbarProps> = {}): WorkspaceToolbarProps {
  return {
    pageId: "00000000-0000-4000-8000-0000000000a1",
    address: "mara.hydlnk.com",
    name: "Main page",
    tabs: createElement("div", { role: "tablist", "aria-label": "Workspace" }),
    status: "published",
    saveStatus: "idle",
    undoRedo,
    flush: vi.fn(async () => true),
    liveUrl: "http://mara.localhost:3000",
    publishing: false,
    onPublish: vi.fn(),
    onOpenShare: vi.fn(),
    ...overrides,
  };
}

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  router.push.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });

describe("M7-05 the menu button and its keyboard", () => {
  const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const button = () => host.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']")!;

  function menu() {
    // `children` arrive as extra arguments (react/no-children-prop); the cast
    // keeps the component's required `children` prop out of the way.
    return createElement(
      ToolbarMenu,
      { label: "Test menu", buttonContent: "Open" } as ComponentProps<typeof ToolbarMenu>,
      createElement("button", { role: "menuitem", tabIndex: -1 }, "One"),
      createElement("a", { role: "menuitem", tabIndex: -1, href: "#two" }, "Two"),
      createElement("button", { role: "menuitem", tabIndex: -1 }, "Three"),
    );
  }

  it("M7-05 a closed menu is a button with aria-haspopup and aria-expanded=false and no menu in the DOM", () => {
    render(menu());
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("M7-05 a click opens a named menu with focus on the first item; Escape closes it and returns focus", () => {
    render(menu());
    act(() => button().click());
    const m = document.querySelector('[role="menu"]')!;
    expect(m.getAttribute("aria-label")).toBe("Test menu");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(button().getAttribute("aria-controls")).toBe(m.id);
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("M7-05 arrows move and wrap, Home and End jump", () => {
    render(menu());
    act(() => button().click());
    key(items()[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1]!, "End");
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2]!, "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, "ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2]!, "Home");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("M7-05 ArrowDown and ArrowUp on the closed button open it on the first and the last item", () => {
    render(menu());
    button().focus();
    key(button(), "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, "Escape");
    key(button(), "ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
  });

  it("M7-05 Tab closes the menu and lets focus go; a press outside closes it", () => {
    render(menu());
    act(() => button().click());
    key(items()[0]!, "Tab");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => button().click());
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("M7-05 Space on a link item activates it like Enter", () => {
    render(menu());
    act(() => button().click());
    const link = items()[1] as HTMLAnchorElement;
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener("click", click);
    link.focus();
    key(link, " ");
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("M7-05 the Preview and ⋯ menus", () => {
  function openToolbar(overrides: Partial<WorkspaceToolbarProps> = {}) {
    setViewport(true);
    const p = props(overrides);
    render(createElement(WorkspaceToolbar, p));
    return p;
  }
  const open = (name: string) => {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
    )!;
    act(() => button.click());
  };
  const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

  it("M7-05 Preview has three items: the draft, the live page and a private link", () => {
    openToolbar();
    open("Preview");
    expect(items().map((i) => i.textContent?.trim())).toEqual([
      "Preview your draft",
      "View live page",
      "Private preview link…",
    ]);
    const [draft, live] = items() as [HTMLAnchorElement, HTMLAnchorElement];
    expect(draft.getAttribute("href")).toBe("/preview/00000000-0000-4000-8000-0000000000a1");
    expect(draft.getAttribute("target")).toBe("_blank");
    expect(draft.getAttribute("rel")).toContain("noopener");
    expect(live.getAttribute("href")).toBe("http://mara.localhost:3000");
    expect(live.getAttribute("aria-disabled")).toBeNull();
  });

  it("M7-05 before the first Publish View live page is aria-disabled and says 'Not published yet'", () => {
    openToolbar({ liveUrl: null, status: "not-published" });
    open("Preview");
    const live = items()[1]!;
    expect(live.getAttribute("aria-disabled")).toBe("true");
    expect(live.getAttribute("href")).toBeNull();
    const described = document.getElementById(live.getAttribute("aria-describedby")!);
    expect(described?.textContent).toBe("Not published yet");
    // It stays focusable and a click does nothing: the menu stays open.
    expect(live.tabIndex).toBe(-1);
    act(() => live.click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("M7-05 Private preview link… and QR code ask the workspace to open the Share tab's card", () => {
    const p = openToolbar();
    open("Preview");
    act(() => items()[2]!.click());
    expect(p.onOpenShare).toHaveBeenLastCalledWith("preview-links");
    open("More actions");
    act(() => items()[0]!.click());
    expect(p.onOpenShare).toHaveBeenLastCalledWith("qr");
  });

  it("M7-05 Version history writes pending edits first, then goes to /editor/history", async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push("flush");
      return true;
    });
    router.push.mockImplementation(() => order.push("push"));
    openToolbar({ flush });
    open("More actions");
    const history = items().find((i) => i.textContent?.includes("Version history"))!;
    await act(async () => {
      history.click();
    });
    expect(order).toEqual(["flush", "push"]);
    expect(router.push).toHaveBeenCalledWith("/editor/history");
  });

  it("M7-05 a Free account sees the Pro chip beside Version history, a Pro account does not", () => {
    setViewport(true);
    render(
      createElement(
        PlanProvider,
        { plan: "free" } as ComponentProps<typeof PlanProvider>,
        createElement(WorkspaceToolbar, props()),
      ),
    );
    open("More actions");
    expect(document.querySelector("[data-history-pro-chip]")?.textContent).toBe("Pro");
    act(() =>
      root.render(
        createElement(
          PlanProvider,
          { plan: "pro" } as ComponentProps<typeof PlanProvider>,
          createElement(WorkspaceToolbar, props()),
        ),
      ),
    );
    open("More actions");
    expect(document.querySelector("[data-history-pro-chip]")).toBeNull();
  });

  it("M7-05 opening a menu never calls anything: no flush, no publish, no undo", () => {
    const p = openToolbar();
    open("Preview");
    open("More actions");
    expect(p.flush).not.toHaveBeenCalled();
    expect(p.onPublish).not.toHaveBeenCalled();
    expect(undoRedo.undo).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("M7-05 one toolbar, laid out by CSS", () => {
  const bar = () => host.querySelector<HTMLElement>("[data-testid='workspace-toolbar']")!;
  const row = () => host.querySelector<HTMLElement>("[data-testid='workspace-toolbar-row']")!;
  const names = (scope: ParentNode) =>
    Array.from(scope.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.trim(),
    );

  it("M7-05 the same markup at every width: one name, one tablist, one chip, one save indicator, once", () => {
    for (const desktop of [true, false]) {
      setViewport(desktop);
      render(createElement(WorkspaceToolbar, props()));
      expect(host.querySelectorAll("[data-testid='workspace-toolbar']")).toHaveLength(1);
      expect(host.querySelectorAll("h1")).toHaveLength(1);
      expect(host.querySelectorAll("[role='tablist']")).toHaveLength(1);
      expect(host.querySelectorAll("[data-publish-status]")).toHaveLength(1);
      expect(host.querySelectorAll("[data-save-status]")).toHaveLength(1);
    }
  });

  it("M7-05 the bar holds the name, the tabs and every control, left to right in the DOM", () => {
    render(createElement(WorkspaceToolbar, props()));
    expect(bar().querySelector("h1")?.textContent).toBe("Main page");
    expect(
      bar().querySelector("[data-testid='workspace-tabs-pin'] [role='tablist']"),
    ).not.toBeNull();
    expect(row().querySelector("[data-publish-status]")).not.toBeNull();
    expect(names(bar())).toEqual([
      "Rename page",
      "Undo",
      "Redo",
      "Preview",
      "More actions",
      "Publish",
    ]);
  });

  it("M7-05 below 760px the bar is display: contents, so its row and tab strip are what is pinned", () => {
    render(createElement(WorkspaceToolbar, props()));
    expect(bar().className).toMatch(/(^|\s)contents(\s|$)/);
    expect(bar().className).toContain("hl:sticky");
    expect(row().className).toContain("sticky top-0");
    expect(row().className).toContain("h-[52px]");
    const strip = host.querySelector<HTMLElement>("[data-testid='workspace-tabs-pin']")!;
    expect(strip.className).toContain("sticky top-[52px]");
    expect(strip.className).toContain("h-12");
    // The two menus are not drawn on a phone.
    for (const label of ["Preview", "More actions"]) {
      const button = Array.from(row().querySelectorAll("button")).find(
        (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label,
      )!;
      expect(button.parentElement?.parentElement?.className).toContain("hidden");
    }
  });

  it("M7-05 the save indicator is one element: a fixed chip on a phone, inline from 760px", () => {
    render(createElement(WorkspaceToolbar, props({ saveStatus: "saved" })));
    const indicator = host.querySelector<HTMLElement>("[data-save-status]")!;
    expect(indicator.textContent).toBe("Saved");
    expect(indicator.className).toContain("fixed");
    expect(indicator.className).toContain("hl:static");
    expect(indicator.className).toContain("left-4");
    expect(indicator.getAttribute("aria-live")).toBe("polite");
  });

  it("M7-05 the server's markup has the bar once, with every control", () => {
    const html = renderToString(createElement(WorkspaceToolbar, props()));
    expect(html.match(/data-testid="workspace-toolbar"/g)).toHaveLength(1);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Publish");
  });

  it("M7-05 Publish is the charcoal button; it reads Publishing... with aria-busy while it runs", () => {
    render(createElement(WorkspaceToolbar, props({ publishing: true })));
    const publish = bar().querySelector<HTMLButtonElement>("button[aria-busy='true']")!;
    expect(publish.textContent).toBe("Publishing...");
    expect(publish.disabled).toBe(true);
    expect(publish.className).toContain("bg-ink");
    // Nothing else in the bar is filled charcoal.
    expect(
      Array.from(bar().querySelectorAll("button")).filter((b) => b.className.includes("bg-ink")),
    ).toHaveLength(1);
  });

  it("M7-05 on a phone Publish is at least 84px wide and 44px tall", () => {
    render(createElement(WorkspaceToolbar, props()));
    const publish = Array.from(bar().querySelectorAll("button")).find(
      (b) => b.textContent === "Publish",
    )!;
    expect(publish.className).toContain("min-w-[84px]");
    expect(publish.className).toContain("min-h-11");
  });

  it("M7-05 Publish is disabled with the reason as its title (suspended owner, blocked link) and sends nothing", () => {
    const p = props({ publishDisabledReason: "Your account is suspended." });
    render(createElement(WorkspaceToolbar, p));
    const publish = Array.from(bar().querySelectorAll("button")).find(
      (b) => b.textContent === "Publish",
    )!;
    expect(publish.disabled).toBe(true);
    expect(publish.title).toBe("Your account is suspended.");
    act(() => publish.click());
    expect(p.onPublish).not.toHaveBeenCalled();
  });

  it("M7-05 a click on Publish calls the workspace's publish once", () => {
    const p = props();
    render(createElement(WorkspaceToolbar, p));
    const publish = Array.from(bar().querySelectorAll("button")).find(
      (b) => b.textContent === "Publish",
    )!;
    act(() => publish.click());
    expect(p.onPublish).toHaveBeenCalledTimes(1);
  });

  it("M7-05 while mounted it keeps --hl-toolbar-h on the document and removes it on leaving", () => {
    render(createElement(WorkspaceToolbar, props()));
    expect(document.documentElement.style.getPropertyValue("--hl-toolbar-h")).not.toBe("");
    act(() => root.unmount());
    expect(document.documentElement.style.getPropertyValue("--hl-toolbar-h")).toBe("");
    root = createRoot(host);
  });
});

describe("M7-05 the save indicator's words", () => {
  it("M7-05 Saving..., Saved and Not saved, and nothing before the first edit", () => {
    expect(saveIndicatorText("idle")).toBe("");
    expect(saveIndicatorText("pending")).toBe("Saving...");
    expect(saveIndicatorText("saving")).toBe("Saving...");
    expect(saveIndicatorText("saved")).toBe("Saved");
    for (const failed of ["error", "invalid", "conflict", "signed-out", "blocked"] as const) {
      expect(saveIndicatorText(failed)).toBe("Not saved");
    }
    expect(saveIndicatorText("too-large")).toMatch(/too large/);
  });
});
