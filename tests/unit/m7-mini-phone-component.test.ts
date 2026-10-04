// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiniPhonePreview, type MiniPhonePreviewProps } from "@/components/workspace/mini-preview";
import { blocks, fullPublished, noirTokens } from "./fixtures/page-document";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The editor's contracts module re-exports the Publish server action, which needs the server.
vi.mock("@/lib/publish/actions", () => ({ publishPage: vi.fn() }));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const PAGE_ID = "00000000-0000-4000-8000-0000000000b2";

function setViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes("min-width: 760px"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const scrollTo = vi.fn();
beforeEach(() => {
  scrollTo.mockClear();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  Object.defineProperty(window, "scrollY", { value: 640, configurable: true });
});

// jsdom has no <dialog> methods: stand in for showModal and close, with their events.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  setViewport(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.style.removeProperty("overflow");
  vi.useRealTimers();
});

function props(overrides: Partial<MiniPhonePreviewProps> = {}): MiniPhonePreviewProps {
  return {
    doc: { ...fullPublished, tokens: noirTokens, blocks: [blocks.link, blocks.text] },
    pageId: PAGE_ID,
    chrome: { badge: true, reportHref: "/report" } as unknown as MiniPhonePreviewProps["chrome"],
    ...overrides,
  };
}

const phone = () => host.querySelector<HTMLButtonElement>("[data-testid='mini-phone']")!;
const dialog = () => host.querySelector<HTMLDialogElement>("dialog")!;
const focusIn = (target: Element) =>
  act(() => {
    (target as HTMLElement).focus();
  });

describe("M7-09 where the mini phone is", () => {
  it("M7-09 below 760px it is a button named Open live preview with a thumbnail, inert and hidden from assistive technology", () => {
    act(() => root.render(createElement(MiniPhonePreview, props())));
    expect(phone().getAttribute("aria-label")).toBe("Open live preview");
    const thumb = phone().querySelector("[data-testid='mini-preview']")!;
    expect(thumb.getAttribute("aria-hidden")).toBe("true");
    expect(thumb.hasAttribute("inert")).toBe(true);
    expect(thumb.querySelectorAll("h1")).toHaveLength(1);
    expect(thumb.querySelector("[data-page-root]")).not.toBeNull();
    // A decorative copy: no link a tap could follow reaches anything (inert), and it is one page root.
    expect(host.querySelectorAll("[data-page-root]")).toHaveLength(1);
  });

  it("M7-09 at 760px and up neither the mini phone nor the sheet is in the DOM", () => {
    setViewport(true);
    act(() => root.render(createElement(MiniPhonePreview, props())));
    expect(phone()).toBeNull();
    expect(dialog()).toBeNull();
    expect(host.querySelectorAll("[data-page-root]")).toHaveLength(0);
  });

  it("M7-09 the thumbnail follows the draft: a new publish form is drawn at once", () => {
    act(() => root.render(createElement(MiniPhonePreview, props())));
    const name = () => phone().querySelector("h1")!.textContent;
    const before = name();
    const next = props();
    next.doc = { ...next.doc, profile: { ...next.doc.profile, name: `${before} X` } };
    act(() => root.render(createElement(MiniPhonePreview, next)));
    expect(name()).toBe(`${before} X`);
  });
});

describe("M7-09 round while a text field has focus", () => {
  function withFields() {
    const input = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    const area = document.createElement("textarea");
    document.body.append(input, box, area);
    return { input, box, area };
  }

  it("M7-09 a text field makes it round and a blur makes it grow back; a checkbox does not", () => {
    const { input, box, area } = withFields();
    act(() => root.render(createElement(MiniPhonePreview, props())));
    expect(phone().hasAttribute("data-round")).toBe(false);
    focusIn(input);
    expect(phone().getAttribute("data-round")).toBe("true");
    expect(phone().style.width).toBe("44px");
    expect(phone().style.height).toBe("44px");
    // Same name, a phone glyph that is hidden from assistive technology, no thumbnail shown.
    expect(phone().getAttribute("aria-label")).toBe("Open live preview");
    expect(phone().querySelector(":scope > svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(phone().querySelector<HTMLElement>("[data-testid='mini-preview']")!.hidden).toBe(true);
    focusIn(box);
    expect(phone().hasAttribute("data-round")).toBe(false);
    expect(phone().style.height).toBe("104px");
    focusIn(area);
    expect(phone().getAttribute("data-round")).toBe("true");
    act(() => area.blur());
    expect(phone().hasAttribute("data-round")).toBe(false);
    input.remove();
    box.remove();
    area.remove();
  });

  it("M7-09 a press anywhere while round keeps it round until the tap is over", () => {
    vi.useFakeTimers();
    const { input, box, area } = withFields();
    act(() => root.render(createElement(MiniPhonePreview, props())));
    focusIn(input);
    expect(phone().getAttribute("data-round")).toBe("true");
    // A press elsewhere moves focus off the field: it does not grow under the finger.
    act(() => {
      box.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    focusIn(box);
    expect(phone().getAttribute("data-round")).toBe("true");
    // The tap's click lets go of it.
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
      window.dispatchEvent(new Event("click"));
    });
    expect(phone().hasAttribute("data-round")).toBe(false);
    input.remove();
    box.remove();
    area.remove();
  });

  it("M7-09 a press that ends without a click lets go after a moment", () => {
    vi.useFakeTimers();
    const { input, box, area } = withFields();
    act(() => root.render(createElement(MiniPhonePreview, props())));
    focusIn(input);
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    focusIn(box);
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(phone().getAttribute("data-round")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(phone().hasAttribute("data-round")).toBe(false);
    input.remove();
    box.remove();
    area.remove();
  });
});

describe("M7-09 the full-size sheet", () => {
  it("M7-09 a tap opens a dialog named Live preview with Close preview focused, and hides the mini phone", () => {
    act(() => root.render(createElement(MiniPhonePreview, props())));
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(dialog().querySelector("[data-page-root]")).toBeNull();
    act(() => phone().click());
    expect(dialog().hasAttribute("open")).toBe(true);
    expect(dialog().getAttribute("aria-label")).toBe("Live preview");
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().querySelector("[data-page-root]")).not.toBeNull();
    const close = Array.from(dialog().querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Close preview",
    )!;
    expect(close).toBeDefined();
    expect(phone().hidden).toBe(true);
    // The document does not scroll while it is open.
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("M7-09 Close preview closes it, unlocks the document and puts focus back on the mini phone", () => {
    act(() => root.render(createElement(MiniPhonePreview, props())));
    act(() => phone().click());
    const close = Array.from(dialog().querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Close preview",
    )!;
    act(() => close.click());
    expect(dialog().hasAttribute("open")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(phone().hidden).toBe(false);
    expect(document.activeElement).toBe(phone());
    expect(dialog().querySelector("[data-page-root]")).toBeNull();
  });

  it("M7-09 closing puts the document back where it was; a tap on a block leaves the scroll to the field it opens", () => {
    const onTap = vi.fn();
    act(() => root.render(createElement(MiniPhonePreview, props({ onTap }))));
    act(() => phone().click());
    act(() =>
      Array.from(dialog().querySelectorAll("button"))
        .find((b) => b.textContent?.trim() === "Close preview")!
        .click(),
    );
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
    scrollTo.mockClear();
    act(() => phone().click());
    act(() =>
      dialog()
        .querySelector(`[data-block-id="${blocks.link.id}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
    expect(onTap).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("M7-09 the browser's own close (Escape) is followed: the state closes too", () => {
    const onOpenChange = vi.fn();
    act(() => root.render(createElement(MiniPhonePreview, props({ open: true, onOpenChange }))));
    expect(dialog().hasAttribute("open")).toBe(true);
    act(() => {
      dialog().close();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("M7-09 it can be opened from outside (a theme preview) with the controlled open prop", () => {
    act(() =>
      root.render(createElement(MiniPhonePreview, props({ open: true, onOpenChange: vi.fn() }))),
    );
    expect(dialog().hasAttribute("open")).toBe(true);
    act(() =>
      root.render(createElement(MiniPhonePreview, props({ open: false, onOpenChange: vi.fn() }))),
    );
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("M7-09 a tap on a block closes the sheet first and then reports the tap; a tap that means nothing does nothing", () => {
    const calls: string[] = [];
    const onTap = vi.fn(() => calls.push(`tap while open=${dialog().hasAttribute("open")}`));
    act(() => root.render(createElement(MiniPhonePreview, props({ onTap }))));
    act(() => phone().click());
    const screen = dialog().querySelector("[data-testid='preview-screen']")!;
    // Nothing: the page background.
    act(() => screen.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onTap).not.toHaveBeenCalled();
    expect(dialog().hasAttribute("open")).toBe(true);
    const block = dialog().querySelector(`[data-block-id="${blocks.link.id}"]`)!;
    act(() => block.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onTap).toHaveBeenCalledWith({ kind: "block", blockId: blocks.link.id });
    expect(calls).toEqual(["tap while open=false"]);
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("M7-09 a click on a link in the sheet never navigates", () => {
    act(() => root.render(createElement(MiniPhonePreview, props())));
    act(() => phone().click());
    const link = dialog().querySelector("a[href]")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("M7-09 during a theme preview a tap does nothing, and the bar offers Apply and Back to my style", () => {
    const onTap = vi.fn();
    const onApply = vi.fn();
    const onStop = vi.fn();
    act(() =>
      root.render(
        createElement(
          MiniPhonePreview,
          props({ onTap, themePreview: { name: "Paper", onApply, onStop } }),
        ),
      ),
    );
    act(() => phone().click());
    const block = dialog().querySelector(`[data-block-id="${blocks.link.id}"]`)!;
    act(() => block.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onTap).not.toHaveBeenCalled();
    expect(dialog().hasAttribute("open")).toBe(true);
    const bar = dialog().querySelector("[data-testid='theme-preview-bar']")!;
    expect(bar.textContent).toContain("Previewing Paper");
    const apply = bar.querySelector<HTMLButtonElement>("[data-testid='theme-preview-apply']")!;
    const stop = bar.querySelector<HTMLButtonElement>("[data-testid='theme-preview-stop']")!;
    expect(apply.textContent).toBe("Apply Paper");
    expect(stop.textContent).toBe("Back to my style");
    act(() => apply.click());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    expect(dialog().hasAttribute("open")).toBe(false);
  });

  it("M7-09 Back to my style and Close preview both end the theme preview and close the sheet", () => {
    const onStop = vi.fn();
    act(() =>
      root.render(
        createElement(
          MiniPhonePreview,
          props({ themePreview: { name: "Paper", onApply: vi.fn(), onStop } }),
        ),
      ),
    );
    act(() => phone().click());
    act(() =>
      dialog().querySelector<HTMLButtonElement>("[data-testid='theme-preview-stop']")!.click(),
    );
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute("open")).toBe(false);
    act(() => phone().click());
    act(() =>
      dialog().querySelector<HTMLButtonElement>("[data-testid='preview-sheet-close']")!.click(),
    );
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it("M7-09 without a theme on show the sheet has no theme bar", () => {
    act(() => root.render(createElement(MiniPhonePreview, props())));
    act(() => phone().click());
    expect(dialog().querySelector("[data-testid='theme-preview-bar']")).toBeNull();
  });
});
