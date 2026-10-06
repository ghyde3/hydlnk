// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type DraftDoc } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";
import type { ThemeRow } from "@/lib/themes";
import { SavedThemesCard, useThemeLibrary } from "@/components/themes";

/**
 * M7-06 at the component level: the Themes card's two rows, its cards, the per-card menu, the
 * rename dialog and the empty and failed states, against an in-memory stand-in for the user's
 * Supabase session. Layout, scrolling and the keyboard in a real browser are in
 * tests/e2e/m7/themes-carousels.spec.ts; the scroll arithmetic is in m7-themes-scroll.test.ts.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

interface Row {
  id: string;
  owner_id: string | null;
  name: string;
  tokens: unknown;
}
const store = { rows: [] as Row[], counter: 0 };

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: () => ({
      insert: (row: { owner_id: string; name: string; tokens: unknown }) => ({
        select: () => ({
          single: async () => {
            const saved: Row = { id: `saved-${++store.counter}`, ...row };
            store.rows.push(saved);
            return { data: saved, error: null };
          },
        }),
      }),
      update: (patch: Partial<Row>) => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            const row = store.rows.find((r) => r.id === id);
            if (!row) return { data: [], error: null };
            Object.assign(row, patch);
            return { data: [row], error: null };
          },
        }),
      }),
      delete: () => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            const index = store.rows.findIndex((r) => r.id === id);
            if (index < 0) return { data: [], error: null };
            store.rows.splice(index, 1);
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  }),
}));

const SYSTEM: ThemeRow[] = [
  { id: "sys-noir", name: "Noir", system: true, tokens: { bg: "#16120E", accent: "#C9A86A" } },
  { id: "sys-ivory", name: "Ivory", system: true, tokens: { bg: "#F3EEE4", accent: "#1B1814" } },
];
const savedRow = (id: string, name: string): Row => ({
  id,
  owner_id: "me",
  name,
  tokens: { ...SYSTEM_DEFAULT_TOKENS, accent: "#336699" },
});
const toTheme = (row: Row): ThemeRow => ({
  id: row.id,
  name: row.name,
  system: false,
  tokens: row.tokens as Partial<TokenSet>,
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
let host: HTMLElement;
let draft: DraftDoc;
const previews: { id: string; button: HTMLElement }[] = [];
const before = vi.fn();
const retry = vi.fn();

function mount(
  opts: {
    saved?: Row[];
    onPreview?: boolean;
    failed?: boolean;
    theme?: DraftDoc["theme"];
  } = {},
) {
  store.rows = [...(opts.saved ?? [])];
  const initial: DraftDoc = {
    ...emptyDraft("zq"),
    theme: opts.theme ?? { ref: "sys-noir", overrides: {} },
  };
  function Harness() {
    const [doc, setDoc] = useState<DraftDoc>(initial);
    draft = doc;
    const lib = useThemeLibrary({
      initialThemes: opts.failed ? [] : [...SYSTEM, ...(opts.saved ?? []).map(toTheme)],
      ownerId: "me",
      plan: "pro",
      draft: doc,
      setDraft: setDoc,
    });
    return createElement(SavedThemesCard, {
      library: lib,
      onBeforeSave: before,
      onPreview: opts.onPreview
        ? (id: string, button: HTMLElement) => previews.push({ id, button })
        : undefined,
      loadFailed: opts.failed ? { onRetry: retry, retrying: false } : null,
    });
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
}

beforeEach(() => {
  store.rows = [];
  store.counter = 0;
  previews.length = 0;
  before.mockClear();
  retry.mockClear();
});
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
const more = (name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="More for ${name}"]`);
const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]');
const items = () => Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
const press = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  });
const text = (el: Element | null | undefined) => el?.textContent ?? null;

describe("M7-06 the two rows", () => {
  it("one card with a hidden h2 'Themes' and two h3 rows, your themes first, counts from the data", () => {
    mount({ saved: [savedRow("a", "Night shift"), savedRow("b", "Midday")] });
    const h2 = host.querySelector("h2")!;
    expect(h2.textContent).toBe("Themes");
    expect(h2.className).toContain("sr-only");
    expect(host.textContent).not.toContain("Saved themes");
    expect(Array.from(host.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
      "Your themes · 2",
      "HYDLNK themes · 2",
    ]);
    const regions = Array.from(host.querySelectorAll<HTMLElement>('[role="region"]'));
    expect(regions).toHaveLength(2);
    // Each row is a focusable region named by its heading.
    for (const region of regions) {
      expect(region.getAttribute("tabindex")).toBe("0");
      const heading = document.getElementById(region.getAttribute("aria-labelledby")!);
      expect(heading?.tagName).toBe("H3");
    }
    expect(
      regions.map((r) => Array.from(r.querySelectorAll("[data-theme-name]")).map(text)),
    ).toEqual([
      ["Night shift", "Midday"],
      ["Noir", "Ivory"],
    ]);
    // The cards are real list items in a list, buttons that apply.
    expect(regions[0]!.querySelectorAll("ul > li > button[data-testid=theme-card]")).toHaveLength(
      2,
    );
  });

  it("'Save as theme' is in the heading row of 'Your themes', and ends a theme preview first", async () => {
    mount();
    const heading = host.querySelector("h3")!;
    const save = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Save as theme",
    )!;
    expect(save.parentElement).toBe(heading.parentElement);
    expect(save.className).toContain("min-h-11");
    await act(async () => {
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(before).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("h3")[0]!.textContent).toBe("Your themes · 1");
    // The new card is last in its row and is the applied one.
    const own = host.querySelector('[role="region"]')!;
    const names = Array.from(own.querySelectorAll("[data-theme-name]")).map(text);
    expect(names).toEqual(["My theme 1"]);
    expect(own.querySelector("button[data-testid=theme-card]")!.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("an empty 'Your themes' row shows the hint in a dashed box as tall as a card, and no tab stop", () => {
    mount();
    const hint = host.querySelector<HTMLElement>("[data-testid=saved-themes-hint]")!;
    expect(hint.textContent).toBe(
      "Saved themes appear here. Use Save as theme to reuse this design on any page.",
    );
    expect(hint.className).toContain("border-dashed");
    expect(hint.className).toContain("h-[94px]");
    const card = host.querySelector<HTMLElement>("li[data-theme-id]")!;
    expect(card.className).toContain("h-[94px]");
    expect(host.querySelector("h3")!.textContent).toBe("Your themes · 0");
    expect(host.querySelector('[role="region"]')!.hasAttribute("tabindex")).toBe(false);
  });

  it("a failed load shows the message and Retry instead of the rows", () => {
    mount({ failed: true });
    expect(host.querySelector("[data-testid=themes-load-error]")!.textContent).toContain(
      "We couldn’t load your themes. Try again.",
    );
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(host.querySelectorAll("li")).toHaveLength(0);
    click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("M7-06 a card", () => {
  it("is a button with the theme name plus its tag as its name, pressed when applied, with the full name in its title", () => {
    mount({ saved: [savedRow("a", "A very long theme name that gets cut")] });
    const noir = host.querySelector<HTMLButtonElement>(
      'li[data-theme-id="sys-noir"] button[data-testid=theme-card]',
    )!;
    expect(noir.getAttribute("aria-pressed")).toBe("true");
    expect(noir.textContent).toBe("NoirApplied");
    expect(noir.querySelector("[data-swatch]")!.getAttribute("aria-hidden")).toBe("true");
    expect(noir.querySelector("[data-swatch]")!.className).toContain("h-12");
    expect(noir.querySelector("[data-name-row]")!.className).toContain("h-11");
    const long = host.querySelector<HTMLElement>('li[data-theme-id="a"] [data-theme-name]')!;
    expect(long.title).toBe("A very long theme name that gets cut");
    expect(long.className).toContain("truncate");
    expect(
      host
        .querySelector('li[data-theme-id="sys-ivory"] button[data-testid=theme-card]')!
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("a name with markup is text: no element comes out of it", () => {
    mount({ saved: [savedRow("a", "<b>x</b><img src=x>")] });
    expect(host.querySelector("b, img")).toBeNull();
    expect(text(host.querySelector('li[data-theme-id="a"] [data-theme-name]'))).toBe(
      "<b>x</b><img src=x>",
    );
    click(more("<b>x</b><img src=x>"));
    expect(menu()!.getAttribute("aria-label")).toBe("<b>x</b><img src=x>");
    expect(document.body.querySelector("b, img")).toBeNull();
  });
});

describe("M7-06 the card menu", () => {
  it("a HYDLNK card has one item, Preview, named 'Preview Noir'; it closes the menu and hands over the More button", () => {
    mount({ onPreview: true });
    const button = more("Noir")!;
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(menu()!.getAttribute("aria-label")).toBe("Noir");
    expect(items().map(text)).toEqual(["Preview"]);
    expect(items()[0]!.getAttribute("aria-label")).toBe("Preview Noir");
    click(items()[0]);
    expect(menu()).toBeNull();
    expect(previews).toEqual([{ id: "sys-noir", button }]);
  });

  it("an own card has Preview, Rename and Delete; without a preview on the screen, Rename and Delete only", () => {
    mount({ saved: [savedRow("a", "Mine")], onPreview: true });
    click(more("Mine"));
    expect(items().map(text)).toEqual(["Preview", "Rename", "Delete"]);
    press(menu()!, "Escape");
    cleanups.pop()!();
    mount({ saved: [savedRow("a", "Mine")] });
    click(more("Mine"));
    expect(items().map(text)).toEqual(["Rename", "Delete"]);
    // No Preview on the screen: a HYDLNK card has nothing to offer, so it has no menu.
    expect(more("Noir")).toBeNull();
  });

  it("Escape closes it and returns the focus to the button; the arrows, Home and End move and wrap", () => {
    mount({ saved: [savedRow("a", "Mine")], onPreview: true });
    const button = more("Mine")!;
    click(button);
    const [preview, rename, remove] = items() as [HTMLElement, HTMLElement, HTMLElement];
    expect(document.activeElement).toBe(preview);
    press(menu()!, "ArrowDown");
    expect(document.activeElement).toBe(rename);
    press(menu()!, "End");
    expect(document.activeElement).toBe(remove);
    press(menu()!, "ArrowDown");
    expect(document.activeElement).toBe(preview);
    press(menu()!, "ArrowUp");
    expect(document.activeElement).toBe(remove);
    press(menu()!, "Home");
    expect(document.activeElement).toBe(preview);
    press(menu()!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("Tab leaves: the menu closes and the focus is on the button, so it moves on from there", () => {
    mount({ saved: [savedRow("a", "Mine")], onPreview: true });
    click(more("Mine"));
    press(menu()!, "Tab");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(more("Mine"));
  });

  it("the arrows open it from the button, and a press outside closes it", () => {
    mount({ saved: [savedRow("a", "Mine")], onPreview: true });
    press(more("Mine")!, "ArrowDown");
    expect(menu()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it("opening and closing a menu does not touch the draft", () => {
    mount({ saved: [savedRow("a", "Mine")], onPreview: true });
    const first = draft;
    click(more("Mine"));
    press(menu()!, "Escape");
    expect(draft).toBe(first);
  });
});

describe("M7-06 rename and delete from the menu", () => {
  const dialog = () => host.querySelector<HTMLDialogElement>("[data-testid=rename-theme-dialog]");
  const input = () => host.querySelector<HTMLInputElement>("[data-testid=theme-rename-input]")!;
  const pickRename = () => {
    click(more("Mine"));
    click(items().find((item) => item.textContent === "Rename"));
  };
  const submit = async () => {
    await act(async () => {
      input().form!.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  };
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input(),
        value,
      );
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("Rename opens the dialog 'Rename theme' with the name in a labelled input", () => {
    mount({ saved: [savedRow("a", "Mine")] });
    pickRename();
    expect(dialog()!.getAttribute("aria-labelledby")).toBe("rename-theme-title");
    expect(host.querySelector("#rename-theme-title")!.textContent).toBe("Rename theme");
    expect(input().value).toBe("Mine");
    expect(document.activeElement).toBe(input());
    expect(host.querySelector(`label[for="${input().id}"]`)!.textContent).toBe("Theme name");
    expect(Array.from(dialog()!.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Cancel",
      "Save",
    ]);
    expect(input().className).toContain("text-base"); // 16px: iOS does not zoom
    expect(input().className).toContain("min-h-11");
  });

  it("an empty name is refused with the reason and nothing is written; whitespace is trimmed on save", async () => {
    mount({ saved: [savedRow("a", "Mine")] });
    pickRename();
    type("   ");
    await submit();
    expect(dialog()!.textContent).toContain("Give the theme a name.");
    expect(store.rows[0]!.name).toBe("Mine");
    type("  Night market  ");
    await submit();
    expect(dialog()).toBeNull();
    expect(store.rows[0]!.name).toBe("Night market");
    expect(text(host.querySelector('li[data-theme-id="a"] [data-theme-name]'))).toBe(
      "Night market",
    );
    expect(text(host.querySelector("[data-testid=theme-message]"))).toContain(
      "Renamed to Night market.",
    );
  });

  it("Escape (the dialog's cancel) closes it without a write and the focus goes back to the More button", async () => {
    vi.useFakeTimers();
    try {
      mount({ saved: [savedRow("a", "Mine")] });
      pickRename();
      type("Discarded");
      act(() => {
        dialog()!.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
      });
      expect(dialog()).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(store.rows[0]!.name).toBe("Mine");
      expect(document.activeElement).toBe(more("Mine"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("deleting the theme asks first; after it the heading of the row takes the focus", async () => {
    vi.useFakeTimers();
    try {
      mount({ saved: [savedRow("a", "Mine")] });
      click(more("Mine"));
      click(items().find((item) => item.textContent === "Delete"));
      const confirm = host.querySelector("[data-testid=delete-theme-dialog]")!;
      expect(confirm.textContent).toContain("Delete Mine?");
      expect(store.rows).toHaveLength(1);
      await act(async () => {
        Array.from(confirm.querySelectorAll("button"))
          .find((b) => b.textContent === "Delete theme")!
          .click();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
      act(() => vi.advanceTimersByTime(1));
      expect(store.rows).toHaveLength(0);
      expect(host.querySelector('li[data-theme-id="a"]')).toBeNull();
      expect(document.activeElement).toBe(host.querySelector("h3"));
      expect(host.querySelector("h3")!.textContent).toBe("Your themes · 0");
    } finally {
      vi.useRealTimers();
    }
  });
});
