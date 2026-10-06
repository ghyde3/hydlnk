// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type DraftDoc } from "@/lib/document";
import { THEME_DELETED_NOTICE } from "@/lib/editor/messages";
import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";
import type { ThemeRow } from "@/lib/themes";
import { SavedThemesCard, THEME_MESSAGE_MS, useThemeLibrary } from "@/components/themes";

/**
 * M9-34: deleting the theme the page uses shows the M5-16 notice at once, next to "Deleted {name}."
 * and its Undo. The card and its hook against an in-memory stand-in for the user's Supabase session
 * (the browser flows are in tests/e2e/m9/page-templates-themes.spec.ts).
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
const store = {
  rows: [] as Row[],
  inserted: [] as Row[],
  insertError: null as { code: string } | null,
  counter: 0,
};

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: () => ({
      insert: (row: { owner_id: string; name: string; tokens: unknown }) => ({
        select: () => ({
          single: async () => {
            if (store.insertError) return { data: null, error: store.insertError };
            const saved: Row = { id: `restored-${++store.counter}`, ...row };
            store.rows.push(saved);
            store.inserted.push(saved);
            return { data: saved, error: null };
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
const savedRow = (id: string, name: string, accent = "#336699"): Row => ({
  id,
  owner_id: "me",
  name,
  tokens: { ...SYSTEM_DEFAULT_TOKENS, accent },
});
const toTheme = (row: Row): ThemeRow => ({
  id: row.id,
  name: row.name,
  system: false,
  tokens: row.tokens as Partial<TokenSet>,
});

const cleanups: (() => void)[] = [];
let host: HTMLElement;
let draft: DraftDoc;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(opts: { saved: Row[]; theme: DraftDoc["theme"]; loadedGone?: boolean }) {
  store.rows = [...opts.saved];
  const initial: DraftDoc = { ...emptyDraft("zq"), theme: opts.theme };
  function Harness() {
    const [doc, setDoc] = useState<DraftDoc>(initial);
    draft = doc;
    const lib = useThemeLibrary({
      initialThemes: [...SYSTEM, ...opts.saved.map(toTheme)],
      ownerId: "me",
      plan: "pro",
      draft: doc,
      setDraft: setDoc,
    });
    // What the Design tab passes: a draft naming a deleted theme (a reload), or the theme just deleted.
    const dangling = doc.theme.ref !== null && !lib.themes.some((t) => t.id === doc.theme.ref);
    return createElement(SavedThemesCard, {
      library: lib,
      deletedNotice: dangling || (lib.deletedNotice && doc.theme.ref === null),
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
  store.inserted = [];
  store.insertError = null;
  store.counter = 0;
});
afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length > 0) cleanups.pop()!();
});

const region = () => host.querySelector<HTMLElement>("[data-testid=theme-message-region]")!;
const message = () => host.querySelector<HTMLElement>("[data-testid=theme-message]");
const notice = () => host.querySelector<HTMLElement>("[data-testid=theme-deleted-notice]");
const undoButton = () => host.querySelector<HTMLButtonElement>("[data-testid=theme-undo]");
const cardNames = () =>
  Array.from(host.querySelectorAll("[data-testid=theme-card] [data-theme-name]")).map(
    (el) => el.textContent,
  );
const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
async function clickAsync(el: Element | undefined | null) {
  await act(async () => {
    (el as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}
const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
const choose = (themeName: string, item: string) => {
  click(host.querySelector(`button[aria-label="More for ${themeName}"]`));
  const entry = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
  ).find((el) => el.textContent === item);
  click(entry);
};
async function deleteTheme(name: string) {
  choose(name, "Delete");
  await clickAsync(buttonByText("Delete theme"));
  await settle();
}

describe("M9-34 deleting the theme the page uses", () => {
  it("shows 'Deleted {name}.' with Undo and, one under the other, the M5-16 notice (role status, exact words)", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look")],
      theme: { ref: "saved-a", overrides: { radius: 20 } },
    });
    expect(notice()).toBeNull();
    await deleteTheme("Shared look");
    expect(draft.theme).toEqual({ ref: null, overrides: { radius: 20 } });
    expect(message()!.textContent).toContain("Deleted Shared look.");
    expect(undoButton()!.textContent).toBe("Undo");
    expect(notice()!.textContent).toBe(
      "The theme this page used was deleted. It now uses the default theme.",
    );
    expect(notice()!.textContent).toBe(THEME_DELETED_NOTICE);
    expect(notice()!.getAttribute("role")).toBe("status");
    // The message region comes first, then the notice, in the one card.
    expect(
      region().compareDocumentPosition(notice()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(host.querySelectorAll("[data-testid=theme-deleted-notice]")).toHaveLength(1);
  });

  it("deleting a theme that is not the applied one shows the message and no notice", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look"), savedRow("saved-b", "Other")],
      theme: { ref: "saved-b", overrides: {} },
    });
    await deleteTheme("Shared look");
    expect(message()!.textContent).toContain("Deleted Shared look.");
    expect(notice()).toBeNull();
    expect(draft.theme.ref).toBe("saved-b");
  });

  it("deleting a HYDLNK-theme-applied page's own theme shows no notice (the page does not use it)", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look")],
      theme: { ref: "sys-noir", overrides: {} },
    });
    await deleteTheme("Shared look");
    expect(notice()).toBeNull();
  });

  it("the message and its Undo last at least 8 seconds and then go; the notice stays", async () => {
    vi.useFakeTimers();
    mount({
      saved: [savedRow("saved-a", "Shared look")],
      theme: { ref: "saved-a", overrides: {} },
    });
    await deleteTheme("Shared look");
    expect(THEME_MESSAGE_MS).toBeGreaterThanOrEqual(8000);
    act(() => void vi.advanceTimersByTime(8000));
    expect(message()).not.toBeNull();
    expect(undoButton()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(THEME_MESSAGE_MS));
    expect(message()).toBeNull();
    expect(undoButton()).toBeNull();
    expect(notice()).not.toBeNull();
  });

  it("applying a theme (a HYDLNK one) clears the notice and says 'Applied {name}.'", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look")],
      theme: { ref: "saved-a", overrides: {} },
    });
    await deleteTheme("Shared look");
    expect(notice()).not.toBeNull();
    click(host.querySelector("[data-testid=theme-card]:not([aria-pressed=true]) "));
    await settle();
    expect(notice()).toBeNull();
    expect(message()!.textContent).toContain("Applied");
    expect(draft.theme.ref).not.toBeNull();
  });

  it("applying one of the person's own themes clears it too", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look"), savedRow("saved-b", "Other")],
      theme: { ref: "saved-a", overrides: {} },
    });
    await deleteTheme("Shared look");
    const other = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-testid=theme-card]"),
    ).find((card) => card.querySelector("[data-theme-name]")?.textContent === "Other");
    click(other);
    await settle();
    expect(notice()).toBeNull();
    expect(draft.theme.ref).toBe("saved-b");
  });

  it("Undo creates the theme again, applies it and takes the notice away", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look", "#AA0000")],
      theme: { ref: "saved-a", overrides: { radius: 20 } },
    });
    await deleteTheme("Shared look");
    expect(cardNames()).not.toContain("Shared look");
    await clickAsync(undoButton());
    await settle();
    expect(store.inserted).toHaveLength(1);
    expect(store.inserted[0]!.name).toBe("Shared look");
    expect((store.inserted[0]!.tokens as TokenSet).accent).toBe("#AA0000");
    expect(cardNames()).toContain("Shared look");
    expect(draft.theme.ref).toBe(store.inserted[0]!.id);
    expect(draft.theme.overrides).toEqual({ radius: 20 });
    expect(notice()).toBeNull();
    expect(message()!.textContent).toContain("Undone.");
    expect(undoButton()).toBeNull();
  });

  it("Undo of a theme the page did not use creates it again and leaves the page's theme alone", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look"), savedRow("saved-b", "Other")],
      theme: { ref: "saved-b", overrides: {} },
    });
    await deleteTheme("Shared look");
    await clickAsync(undoButton());
    await settle();
    expect(cardNames()).toContain("Shared look");
    expect(draft.theme.ref).toBe("saved-b");
  });

  it("Undo that the database refuses says so, and the notice stays", async () => {
    mount({
      saved: [savedRow("saved-a", "Shared look")],
      theme: { ref: "saved-a", overrides: {} },
    });
    await deleteTheme("Shared look");
    store.insertError = { code: "XX000" };
    await clickAsync(undoButton());
    await settle();
    expect(message()!.textContent).toContain("Couldn’t save the theme.");
    expect(notice()).not.toBeNull();
    expect(draft.theme.ref).toBeNull();
  });

  it("a name that is markup is drawn as characters in the message, and the notice never holds the name", async () => {
    const name = "<b>x</b>";
    mount({ saved: [savedRow("saved-a", name)], theme: { ref: "saved-a", overrides: {} } });
    await deleteTheme(name);
    expect(message()!.textContent).toContain("Deleted <b>x</b>.");
    expect(message()!.querySelector("b")).toBeNull();
    expect(notice()!.textContent).not.toContain("<b>");
    expect(notice()!.querySelector("b")).toBeNull();
  });

  it("a page that loads naming a deleted theme shows the notice once, as before (M5-16)", () => {
    mount({ saved: [], theme: { ref: "someone-elses", overrides: {} } });
    expect(notice()!.textContent).toBe(THEME_DELETED_NOTICE);
    expect(host.querySelectorAll("[data-testid=theme-deleted-notice]")).toHaveLength(1);
  });
});
