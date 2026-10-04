// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type DraftDoc } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, resolveTokens, type TokenSet } from "@/lib/theme";
import type { ThemeRow } from "@/lib/themes";
import { SavedThemesCard, THEME_MESSAGE_MS, useThemeLibrary } from "@/components/themes";

/**
 * M3-19 .. M3-24 at the component level (as laid out by M7-06: two rows, a menu per card, Rename in a
 * dialog): the Themes card and its hook against an in-memory
 * stand-in for the user's Supabase session. The browser flows (RLS, the real limit trigger, two
 * pages, live pages) are in tests/e2e/m3/themes-ui.spec.ts and themes-api.spec.ts.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

// ---- the stand-in for the Supabase browser client --------------------------------------------

interface Row {
  id: string;
  owner_id: string | null;
  name: string;
  tokens: unknown;
}
const store = {
  rows: [] as Row[],
  calls: [] as string[],
  insertError: null as { code: string } | null,
  noMatch: false,
  counter: 0,
};

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: (table: string) => {
      expect(table).toBe("themes");
      return {
        insert: (row: { owner_id: string; name: string; tokens: unknown }) => ({
          select: () => ({
            single: async () => {
              store.calls.push("insert");
              if (store.insertError) return { data: null, error: store.insertError };
              const saved: Row = { id: `saved-${++store.counter}`, ...row };
              store.rows.push(saved);
              return { data: saved, error: null };
            },
          }),
        }),
        update: (patch: Partial<Row>) => ({
          eq: (_column: string, id: string) => ({
            select: async () => {
              store.calls.push("update");
              const row = store.rows.find((r) => r.id === id);
              if (!row || store.noMatch) return { data: [], error: null };
              Object.assign(row, patch);
              return { data: [row], error: null };
            },
          }),
        }),
        delete: () => ({
          eq: (_column: string, id: string) => ({
            select: async () => {
              store.calls.push("delete");
              const index = store.rows.findIndex((r) => r.id === id);
              if (index < 0 || store.noMatch) return { data: [], error: null };
              store.rows.splice(index, 1);
              return { data: [{ id }], error: null };
            },
          }),
        }),
      };
    },
  }),
}));

// ---- fixtures ---------------------------------------------------------------------------------

const SYSTEM: ThemeRow[] = [
  {
    id: "sys-noir",
    name: "Noir",
    system: true,
    tokens: { bg: "#16120E", accent: "#C9A86A", radius: 12 },
  },
  {
    id: "sys-ivory",
    name: "Ivory",
    system: true,
    tokens: { bg: "#F3EEE4", accent: "#1B1814", radius: 4 },
  },
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
let setDocument: (update: (doc: DraftDoc) => DraftDoc) => void;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(opts: { saved?: Row[]; theme?: DraftDoc["theme"]; plan?: "free" | "pro" } = {}) {
  store.rows = [...(opts.saved ?? [])];
  const initial: DraftDoc = {
    ...emptyDraft("zq"),
    theme: opts.theme ?? { ref: "sys-noir", overrides: {} },
  };
  function Harness() {
    const [doc, setDoc] = useState<DraftDoc>(initial);
    draft = doc;
    setDocument = setDoc;
    const lib = useThemeLibrary({
      initialThemes: [...SYSTEM, ...(opts.saved ?? []).map(toTheme)],
      ownerId: "me",
      plan: opts.plan ?? "pro",
      draft: doc,
      setDraft: setDoc,
    });
    return createElement("div", null, [
      createElement("p", { key: "s", "data-status": "" }, lib.statusLabel),
      createElement(SavedThemesCard, { key: "c", library: lib }),
    ]);
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
  store.calls = [];
  store.insertError = null;
  store.noMatch = false;
  store.counter = 0;
});
afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length > 0) cleanups.pop()!();
});

const cards = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("[data-testid=theme-card]"));
const cardNamed = (name: string) =>
  cards().find((card) => card.querySelector("[data-theme-name]")?.textContent === name)!;
const tagOf = (name: string) =>
  cardNamed(name).querySelector("[data-theme-tag]")?.textContent ?? null;
const message = () => host.querySelector<HTMLElement>("[data-testid=theme-message]");
const buttonByText = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
/** M7-06: a card's "More" button opens a menu (drawn in a portal); choose one of its items. */
const choose = (themeName: string, item: string) => {
  click(host.querySelector(`button[aria-label="More for ${themeName}"]`));
  const entry = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
  ).find((el) => el.textContent === item);
  click(entry);
};
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
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(el: Element, name: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}
/** Edit the page the way a Design section does: an override in the same draft the hook writes to. */
const editOverrides = (overrides: DraftDoc["theme"]["overrides"]) =>
  act(() => setDocument((doc) => ({ ...doc, theme: { ...doc.theme, overrides } })));

describe("M3-19 the grid and its states", () => {
  it("lists the saved themes, then every system theme; the applied card is pressed and tagged Applied", () => {
    mount({ saved: [savedRow("saved-a", "Night shift")] });
    expect(cards().map((c) => c.querySelector("[data-theme-name]")?.textContent)).toEqual([
      "Night shift",
      "Noir",
      "Ivory",
    ]);
    expect(cardNamed("Noir").getAttribute("aria-pressed")).toBe("true");
    expect(tagOf("Noir")).toBe("Applied");
    expect(cardNamed("Ivory").getAttribute("aria-pressed")).toBe("false");
    expect(tagOf("Ivory")).toBeNull();
    expect(host.querySelector("[data-status]")!.textContent).toBe("Theme · Noir");
    // The old hint is gone (M7-06): the two rows are named with their counts instead.
    expect(host.textContent).not.toContain("Applying one replaces");
    expect(Array.from(host.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
      "Your themes · 1",
      "HYDLNK themes · 2",
    ]);
  });

  it("an override makes the applied card Edited and the header says so", () => {
    mount({ theme: { ref: "sys-noir", overrides: { accent: "#C46A4F" } } });
    expect(tagOf("Noir")).toBe("Edited");
    expect(host.querySelector("[data-status]")!.textContent).toBe("Theme · Noir · edited");
  });

  it("the swatch shows the theme's background with a filled and an outlined accent bar", () => {
    mount();
    const swatch = cardNamed("Ivory").querySelector<HTMLElement>("[data-swatch]")!;
    expect(swatch.style.background).toBe("rgb(243, 238, 228)");
    const bars = Array.from(swatch.children) as HTMLElement[];
    expect(bars).toHaveLength(2);
    expect(bars[0]!.style.background).toBe("rgb(27, 24, 20)");
    expect(bars[1]!.style.border).toContain("rgb(27, 24, 20)");
  });

  it("a page whose theme was deleted or is not readable reads as the default, with no applied card", () => {
    mount({ theme: { ref: "someone-elses", overrides: { radius: 20 } } });
    expect(host.querySelector("[data-status]")!.textContent).toBe("Theme · Default");
    expect(cards().every((card) => card.getAttribute("aria-pressed") === "false")).toBe(true);
  });
});

describe("M3-20 apply with undo", () => {
  it("applying replaces the theme reference and clears the page overrides, with Applied and Undo", () => {
    mount({ theme: { ref: "sys-noir", overrides: { accent: "#C46A4F" } } });
    click(cardNamed("Ivory"));
    expect(draft.theme).toEqual({ ref: "sys-ivory", overrides: {} });
    expect(cardNamed("Ivory").getAttribute("aria-pressed")).toBe("true");
    expect(tagOf("Ivory")).toBe("Applied");
    expect(message()!.textContent).toContain("Applied Ivory.");
    expect(buttonByText("Undo")).toBeTruthy();
    expect(store.calls).toEqual([]); // nothing is written to the themes table
  });

  it("Undo restores the exact previous reference and overrides", () => {
    const before = { ref: "sys-noir", overrides: { accent: "#C46A4F", radius: 20 } };
    mount({ theme: before });
    click(cardNamed("Ivory"));
    click(buttonByText("Undo"));
    expect(draft.theme).toEqual(before);
    expect(tagOf("Noir")).toBe("Edited");
    expect(buttonByText("Undo")).toBeUndefined();
  });

  it("the message and Undo stay for at least 8 seconds, then go", () => {
    vi.useFakeTimers();
    mount();
    click(cardNamed("Ivory"));
    act(() => vi.advanceTimersByTime(8_000));
    expect(message()).not.toBeNull();
    expect(buttonByText("Undo")).toBeTruthy();
    expect(THEME_MESSAGE_MS).toBeGreaterThanOrEqual(8_000);
    act(() => vi.advanceTimersByTime(THEME_MESSAGE_MS));
    expect(message()).toBeNull();
  });

  it("an edit after the apply drops the Undo, so it can never throw that edit away", () => {
    mount();
    click(cardNamed("Ivory"));
    expect(buttonByText("Undo")).toBeTruthy();
    editOverrides({ accent: "#8FA68A" });
    expect(buttonByText("Undo")).toBeUndefined();
    expect(message()).toBeNull();
  });

  it("pressing the applied card again changes nothing and shows no message", () => {
    mount();
    click(cardNamed("Noir"));
    expect(message()).toBeNull();
  });

  it("another apply moves the Undo to the new one", () => {
    mount();
    click(cardNamed("Ivory"));
    click(cardNamed("Noir"));
    expect(message()!.textContent).toContain("Applied Noir.");
    click(buttonByText("Undo"));
    expect(draft.theme.ref).toBe("sys-ivory");
  });
});

describe("M3-21 Save as theme", () => {
  it("inserts the page's resolved tokens as 'My theme 1', applies it and clears the overrides", async () => {
    mount({ theme: { ref: "sys-noir", overrides: { accent: "#C46A4F", radius: 20 } } });
    await clickAsync(buttonByText("Save as theme"));
    expect(store.rows).toHaveLength(1);
    const saved = store.rows[0]!;
    expect(saved.owner_id).toBe("me");
    expect(saved.name).toBe("My theme 1");
    const noir = SYSTEM[0]!.tokens;
    expect(saved.tokens).toEqual(resolveTokens(noir, { accent: "#C46A4F", radius: 20 }));
    expect(draft.theme).toEqual({ ref: saved.id, overrides: {} });
    expect(cardNamed("My theme 1").getAttribute("aria-pressed")).toBe("true");
    expect(tagOf("My theme 1")).toBe("Applied");
    expect(host.querySelector("[data-status]")!.textContent).toBe("Theme · My theme 1");
    expect(message()!.textContent).toContain("Saved as My theme 1.");
    expect(message()!.hasAttribute("data-kind")).toBe(true);
  });

  it("a second press while the first is in flight saves once", async () => {
    mount();
    await act(async () => {
      buttonByText("Save as theme")!.click();
      buttonByText("Save as theme")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.calls.filter((c) => c === "insert")).toHaveLength(1);
  });

  it("names the next theme after the ones that exist", async () => {
    mount({ saved: [savedRow("saved-a", "My theme 1")] });
    await clickAsync(buttonByText("Save as theme"));
    expect(store.rows.map((r) => r.name)).toEqual(["My theme 1", "My theme 2"]);
  });

  it("later edits make it Edited and never touch the saved row", async () => {
    mount();
    await clickAsync(buttonByText("Save as theme"));
    const tokensBefore = JSON.stringify(store.rows[0]!.tokens);
    expect(tagOf("My theme 1")).toBe("Applied");
    editOverrides({ accent: "#8FA68A" });
    expect(tagOf("My theme 1")).toBe("Edited");
    expect(JSON.stringify(store.rows[0]!.tokens)).toBe(tokensBefore);
    expect(store.calls).toEqual(["insert"]);
  });
});

describe("M3-22 the Free limit", () => {
  it("HL002 shows the exact limit message, adds no card and no row, and Dismiss clears it", async () => {
    mount({
      saved: [savedRow("a", "One"), savedRow("b", "Two"), savedRow("c", "Three")],
      plan: "free",
    });
    store.insertError = { code: "HL002" };
    const before = cards().length;
    await clickAsync(buttonByText("Save as theme"));
    expect(message()!.textContent).toContain(
      "You’ve used 3 of 3 saved themes. Delete one or upgrade to Pro.",
    );
    expect(cards()).toHaveLength(before);
    expect(store.rows).toHaveLength(3);
    expect(draft.theme.ref).toBe("sys-noir");
    click(buttonByText("Dismiss"));
    expect(message()).toBeNull();
  });

  it("the limit message stays until dismissed (it does not time out)", async () => {
    vi.useFakeTimers();
    mount({ plan: "free" });
    store.insertError = { code: "HL002" };
    await clickAsync(buttonByText("Save as theme"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(message()).not.toBeNull();
  });

  it("any other failure says so and keeps the page as it was", async () => {
    mount();
    store.insertError = { code: "XX000" };
    await clickAsync(buttonByText("Save as theme"));
    expect(message()!.textContent).toContain("Couldn’t save the theme. Try again.");
    expect(draft.theme.ref).toBe("sys-noir");
  });
});

describe("M3-23 update and rename", () => {
  const saved = () => [savedRow("saved-a", "Shared look", "#C46A4F")];

  it("Update is offered only for an edited saved theme, and writes the resolved tokens", async () => {
    mount({ saved: saved(), theme: { ref: "saved-a", overrides: {} } });
    expect(buttonByText("Update Shared look")).toBeUndefined(); // nothing to update yet
    editOverrides({ accent: "#8FA68A" });
    expect(tagOf("Shared look")).toBe("Edited");
    await clickAsync(buttonByText("Update Shared look"));
    const row = store.rows[0]!;
    expect((row.tokens as TokenSet).accent).toBe("#8FA68A");
    expect(draft.theme).toEqual({ ref: "saved-a", overrides: {} });
    expect(tagOf("Shared look")).toBe("Applied");
    expect(buttonByText("Update Shared look")).toBeUndefined();
    expect(message()!.textContent).toContain("Updated Shared look.");
  });

  it("Update is not offered when the applied theme is a system theme", () => {
    mount({ theme: { ref: "sys-noir", overrides: { accent: "#8FA68A" } } });
    expect(tagOf("Noir")).toBe("Edited");
    expect(buttonByText("Update Noir")).toBeUndefined();
    expect(host.querySelector('button[aria-label="More for Noir"]')).toBeNull(); // no menu at all
  });

  it("Rename opens a prefilled input; Escape cancels; whitespace is trimmed; empty is refused; Enter saves", async () => {
    mount({ saved: saved() });
    choose("Shared look", "Rename");
    const input = host.querySelector<HTMLInputElement>("[data-testid=theme-rename-input]")!;
    expect(input.value).toBe("Shared look");

    typeInto(input, "Discarded");
    // Escape is the dialog's own cancel event.
    act(() => {
      host
        .querySelector("[data-testid=rename-theme-dialog]")!
        .dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
    });
    expect(host.querySelector("[data-testid=theme-rename-input]")).toBeNull();
    expect(store.rows[0]!.name).toBe("Shared look");

    choose("Shared look", "Rename");
    const again = host.querySelector<HTMLInputElement>("[data-testid=theme-rename-input]")!;
    typeInto(again, "   ");
    await act(async () => {
      again.form!.requestSubmit();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Give the theme a name.");
    expect(store.calls).not.toContain("update");

    typeInto(again, "  Night Market  ");
    await act(async () => {
      again.form!.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    expect(store.rows[0]!.name).toBe("Night Market");
    expect((store.rows[0]!.tokens as TokenSet).accent).toBe("#C46A4F"); // tokens untouched
    expect(host.querySelector("[data-testid=theme-rename-input]")).toBeNull();
    expect(cardNamed("Night Market")).toBeTruthy();
  });

  it("the More button is named for its theme and its menu items are 44px tall", () => {
    mount({ saved: saved() });
    const more = host.querySelector<HTMLButtonElement>(
      'button[aria-label="More for Shared look"]',
    )!;
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.className).toContain("size-11");
    click(more);
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.getAttribute("aria-label")).toBe("Shared look");
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map((item) => item.textContent)).toEqual(["Rename", "Delete"]);
    expect(items.every((item) => item.className.includes("min-h-11"))).toBe(true);
  });

  it("a refused rename keeps the input and says why", async () => {
    mount({ saved: saved() });
    store.noMatch = true;
    choose("Shared look", "Rename");
    const input = host.querySelector<HTMLInputElement>("[data-testid=theme-rename-input]")!;
    typeInto(input, "Other");
    await act(async () => {
      input.form!.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    expect(host.querySelector("[data-testid=theme-rename-input]")).not.toBeNull();
    expect(host.textContent).toContain("Couldn’t rename the theme. Try again.");
  });
});

describe("M3-24 delete", () => {
  const saved = () => [savedRow("saved-a", "Shared look")];
  const dialog = () => host.querySelector<HTMLDialogElement>("[data-testid=delete-theme-dialog]");

  it("opens a dialog with the copy and two 44px buttons; Escape and Cancel close it without deleting", () => {
    mount({ saved: saved() });
    choose("Shared look", "Delete");
    expect(dialog()!.textContent).toContain("Delete Shared look?");
    expect(dialog()!.textContent).toContain(
      "Drafts using it fall back to the default theme. Live pages keep their look until you republish.",
    );
    const buttons = Array.from(dialog()!.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Delete theme"]);
    expect(buttons.every((b) => b.className.includes("min-h-11"))).toBe(true);

    act(() => {
      dialog()!.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
    });
    expect(dialog()).toBeNull();
    expect(store.rows).toHaveLength(1);

    choose("Shared look", "Delete");
    click(buttonByText("Cancel"));
    expect(dialog()).toBeNull();
    expect(store.rows).toHaveLength(1);
  });

  it("Tab wraps inside the dialog, both ways", () => {
    mount({ saved: saved() });
    choose("Shared look", "Delete");
    const [cancel, confirm] = Array.from(dialog()!.querySelectorAll("button"));
    confirm!.focus();
    key(dialog()!, "Tab");
    expect(document.activeElement).toBe(cancel);
    cancel!.focus();
    act(() => {
      dialog()!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(confirm);
  });

  it("confirming deletes the row and the card; this page falls back to the default but keeps its overrides", async () => {
    mount({
      saved: saved(),
      theme: { ref: "saved-a", overrides: { radius: 20 } },
    });
    choose("Shared look", "Delete");
    await clickAsync(buttonByText("Delete theme"));
    await settle();
    expect(store.rows).toHaveLength(0);
    expect(cards().map((c) => c.querySelector("[data-theme-name]")?.textContent)).toEqual([
      "Noir",
      "Ivory",
    ]);
    expect(draft.theme).toEqual({ ref: null, overrides: { radius: 20 } });
    expect(host.querySelector("[data-status]")!.textContent).toBe("Theme · Default");
    expect(message()!.textContent).toContain("Deleted Shared look.");
    expect(dialog()).toBeNull();
  });

  it("deleting a theme another page uses leaves this page's draft alone", async () => {
    mount({ saved: saved() });
    choose("Shared look", "Delete");
    await clickAsync(buttonByText("Delete theme"));
    await settle();
    expect(draft.theme).toEqual({ ref: "sys-noir", overrides: {} });
  });

  it("a delete the database refuses says so and keeps the card", async () => {
    mount({ saved: saved() });
    store.noMatch = true;
    choose("Shared look", "Delete");
    await clickAsync(buttonByText("Delete theme"));
    await settle();
    expect(message()!.textContent).toContain("Couldn’t delete the theme. Try again.");
    expect(cardNamed("Shared look")).toBeTruthy();
  });
});
