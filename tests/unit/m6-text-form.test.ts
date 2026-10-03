// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block, PublishError, TextBlock } from "@/lib/document";
import { BLOCK_FORMS } from "@/components/blocks/forms";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M6-30: the text block's form: the toolbar, the link panel and the list of links. Selection, focus
 * and the phone keyboard are checked in a real browser (tests/e2e/m6/text-*.spec.ts); this file covers
 * what the form writes to the draft and says.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

const bold = (start: number, end: number) => ({ type: "bold" as const, start, end });
const link = (
  start: number,
  end: number,
  id = "link-form-00001",
  url = "https://example.com/a",
) => ({
  type: "link" as const,
  start,
  end,
  id,
  url,
});

function textBlock(text: string, marks?: TextBlock["marks"]): TextBlock {
  return {
    id: "text-form-0001",
    type: "text",
    visible: true,
    text,
    ...(marks ? { marks } : {}),
  } as TextBlock;
}

function mount(initial: TextBlock, errors: PublishError[] = []) {
  const changes: Block[] = [];
  const latest = { block: initial as Block };
  function Harness() {
    const [block, setBlock] = useState<Block>(initial);
    latest.block = block;
    const Form = BLOCK_FORMS[block.type];
    return createElement(Form, {
      block,
      errors,
      onChange: (next: Block) => {
        changes.push(next);
        setBlock(next);
      },
      onImage: () => undefined,
    });
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, changes, latest };
}

const area = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>("textarea")!;
const toolbar = (host: HTMLElement) => host.querySelector<HTMLElement>('[role="toolbar"]')!;
const buttonNamed = (host: ParentNode, name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  )!;

/** Selects `[start, end)` (UTF-16 here: the samples are ASCII) the way the textarea reports it. */
function select(host: HTMLElement, start: number, end = start) {
  act(() => {
    const el = area(host);
    el.focus();
    el.setSelectionRange(start, end);
    el.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

function press(el: HTMLElement) {
  act(() => el.click());
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const marksOf = (block: Block) => (block as TextBlock).marks;

describe("M6-30 the toolbar", () => {
  it("is a toolbar labeled 'Text formatting' with Bold, Italic and Link above the textarea", () => {
    const { host } = mount(textBlock("Hello world"));
    const bar = toolbar(host);
    expect(bar.getAttribute("aria-label")).toBe("Text formatting");
    expect([...bar.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Bold",
      "Italic",
      "Link",
    ]);
    // Above the textarea in the document.
    expect(bar.compareDocumentPosition(area(host)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.textContent).toContain("Select some text, then tap Bold, Italic or Link.");
  });

  it("the three buttons are disabled while nothing is selected", () => {
    const { host } = mount(textBlock("Hello world"));
    for (const name of ["Bold", "Italic", "Link"])
      expect(buttonNamed(host, name).disabled, name).toBe(true);
    select(host, 3);
    for (const name of ["Bold", "Italic", "Link"])
      expect(buttonNamed(host, name).disabled, name).toBe(true);
    select(host, 6, 11);
    for (const name of ["Bold", "Italic", "Link"])
      expect(buttonNamed(host, name).disabled, name).toBe(false);
  });

  it("keeps the counter on the text only: '{n} / 600'", () => {
    const { host } = mount(textBlock("Hello world", [bold(0, 5)]));
    expect(host.textContent).toContain("11 / 600");
  });

  it("opening it writes nothing to the draft", () => {
    const { host, changes } = mount(textBlock("Hello world"));
    select(host, 0, 5);
    select(host, 3);
    expect(changes).toEqual([]);
  });

  it("a press does not take focus from the textarea (mousedown is prevented)", () => {
    const { host } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      buttonNamed(host, "Bold").dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it("left and right arrow keys move between the buttons", () => {
    const { host } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    const [boldButton, italicButton, linkButton] = [...toolbar(host).querySelectorAll("button")];
    act(() => boldButton!.focus());
    const key = (name: string) =>
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        );
      });
    key("ArrowRight");
    expect(document.activeElement).toBe(italicButton);
    key("ArrowRight");
    expect(document.activeElement).toBe(linkButton);
    key("ArrowRight");
    expect(document.activeElement).toBe(boldButton);
    key("ArrowLeft");
    expect(document.activeElement).toBe(linkButton);
    key("Home");
    expect(document.activeElement).toBe(boldButton);
    key("End");
    expect(document.activeElement).toBe(linkButton);
  });
});

describe("M6-30 Bold and Italic write marks", () => {
  it("selecting 'world' and pressing Bold writes one bold mark; pressing it again removes it", () => {
    const { host, changes, latest } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    press(buttonNamed(host, "Bold"));
    expect(marksOf(latest.block)).toEqual([bold(6, 11)]);
    expect(changes).toHaveLength(1);
    expect(buttonNamed(host, "Bold").getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed(host, "Italic").getAttribute("aria-pressed")).toBe("false");
    press(buttonNamed(host, "Bold"));
    // No empty `marks` array left behind: the draft is what it was.
    expect("marks" in latest.block).toBe(false);
    expect(latest.block).toEqual(textBlock("Hello world"));
    expect(buttonNamed(host, "Bold").getAttribute("aria-pressed")).toBe("false");
  });

  it("Bold and Italic on the same text are two marks", () => {
    const { host, latest } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    press(buttonNamed(host, "Bold"));
    press(buttonNamed(host, "Italic"));
    expect(marksOf(latest.block)).toEqual([bold(6, 11), { type: "italic", start: 6, end: 11 }]);
  });

  it("Bold across a selection that touches an existing bold range merges them", () => {
    const { host, latest } = mount(textBlock("Hello world", [bold(0, 5)]));
    select(host, 4, 8);
    press(buttonNamed(host, "Bold"));
    expect(marksOf(latest.block)).toEqual([bold(0, 8)]);
  });

  it("refuses a change that would leave more than 30 marks, with the inline message", () => {
    const marks = Array.from({ length: 30 }, (_, i) => bold(i * 2, i * 2 + 1));
    const { host, changes } = mount(textBlock("x".repeat(80), marks));
    select(host, 61, 63);
    press(buttonNamed(host, "Bold"));
    expect(changes).toEqual([]);
    expect(host.textContent).toContain(
      "This block has too much formatting. Remove some bold, italic or links.",
    );
  });

  it("un-bolding the middle of a range splits it in two, so it is refused at 30 marks", () => {
    const marks = [
      bold(0, 20),
      ...Array.from({ length: 29 }, (_, i) => ({
        type: "italic" as const,
        start: 22 + i,
        end: 23 + i,
      })),
    ];
    const { host, changes } = mount(textBlock("x".repeat(60), marks));
    select(host, 5, 8);
    press(buttonNamed(host, "Bold"));
    expect(changes).toEqual([]);
    expect(host.textContent).toContain("too much formatting");
  });
});

describe("M6-30 marks follow the text as it is typed", () => {
  it("typing before a bold range moves it; the draft carries both changes at once", () => {
    const { host, changes, latest } = mount(textBlock("Hello world", [bold(6, 11)]));
    typeInto(area(host), "Big Hello world");
    expect((latest.block as TextBlock).text).toBe("Big Hello world");
    expect(marksOf(latest.block)).toEqual([bold(10, 15)]);
    expect(changes).toHaveLength(1);
  });

  it("deleting all of a range's text removes the mark and the key", () => {
    const { host, latest } = mount(textBlock("Hello world", [bold(6, 11)]));
    typeInto(area(host), "Hello ");
    expect("marks" in latest.block).toBe(false);
  });

  it("typing in a block that has no marks adds no marks key", () => {
    const { host, latest } = mount(textBlock("Hello"));
    typeInto(area(host), "Hello there");
    expect(latest.block).toEqual(textBlock("Hello there"));
  });

  it("a long paste is cut to 600 code points and the marks stay inside it", () => {
    const { host, latest } = mount(textBlock("Hello", [bold(0, 5)]));
    typeInto(area(host), "x".repeat(700));
    expect((latest.block as TextBlock).text).toHaveLength(600);
  });
});

describe("M6-30 the link panel", () => {
  it("opens inline under the toolbar with 'Link address', 'Add link' and 'Cancel'", () => {
    const { host } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    press(buttonNamed(host, "Link"));
    const panel = host.querySelector<HTMLElement>('[role="group"][aria-label="Add link"]')!;
    expect(panel).not.toBeNull();
    expect(host.querySelector("dialog, [role=dialog], [aria-modal]")).toBeNull();
    const field = panel.querySelector<HTMLInputElement>('input[data-field="link-address"]')!;
    expect(panel.textContent).toContain("Link address");
    expect(field.type).toBe("url");
    expect(field.placeholder).toBe("https://");
    expect(buttonNamed(panel, "Add link")).toBeDefined();
    expect(buttonNamed(panel, "Cancel")).toBeDefined();
    expect(buttonNamed(panel, "Remove link")).toBeUndefined();
    // The address field takes the focus.
    expect(document.activeElement).toBe(field);
  });

  it("adding a link writes a link mark with a fresh id and shows it in 'Links in this text'", () => {
    const { host, changes, latest } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    press(buttonNamed(host, "Link"));
    const field = host.querySelector<HTMLInputElement>('input[data-field="link-address"]')!;
    typeInto(field, "example.com/book");
    press(buttonNamed(host, "Add link"));
    const marks = marksOf(latest.block)!;
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      type: "link",
      start: 6,
      end: 11,
      url: "https://example.com/book",
    });
    expect((marks[0] as { id: string }).id).toMatch(/^[A-Za-z0-9_-]{8,24}$/);
    expect(changes).toHaveLength(1);
    expect(host.querySelector('[role="group"]')).toBeNull();
    // The list of links.
    const list = host.querySelector<HTMLElement>('section[aria-label="Links in this text"]')!;
    expect(list.textContent).toContain("Links in this text");
    expect(list.textContent).toContain("world");
    expect(list.textContent).toContain("https://example.com/book");
    expect(buttonNamed(list, "Edit link: world")).toBeDefined();
    expect(buttonNamed(list, "Remove link: world")).toBeDefined();
  });

  it("a bare address is made https and an invalid one is refused with the address message", () => {
    const { host, changes } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    press(buttonNamed(host, "Link"));
    const field = () => host.querySelector<HTMLInputElement>('input[data-field="link-address"]')!;
    typeInto(field(), "javascript:alert(1)");
    press(buttonNamed(host, "Add link"));
    expect(changes).toEqual([]);
    expect(host.textContent).toContain("Enter a full web address, like https://example.com.");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    typeInto(field(), "");
    press(buttonNamed(host, "Add link"));
    expect(changes).toEqual([]);
    typeInto(field(), "https://user@host.example/");
    press(buttonNamed(host, "Add link"));
    expect(changes).toEqual([]);
  });

  it("Cancel closes the panel and writes nothing", () => {
    const { host, changes } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    press(buttonNamed(host, "Link"));
    press(buttonNamed(host, "Cancel"));
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(changes).toEqual([]);
  });

  it("with the cursor inside a link it opens prefilled with 'Update link' and 'Remove link'", () => {
    const { host, latest } = mount(textBlock("Hello world", [link(6, 11)]));
    select(host, 8);
    expect(buttonNamed(host, "Link").disabled).toBe(false);
    press(buttonNamed(host, "Link"));
    const panel = host.querySelector<HTMLElement>('[role="group"][aria-label="Update link"]')!;
    expect(panel.querySelector<HTMLInputElement>("input")!.value).toBe("https://example.com/a");
    expect(buttonNamed(panel, "Update link")).toBeDefined();
    expect(buttonNamed(panel, "Remove link")).toBeDefined();
    typeInto(panel.querySelector<HTMLInputElement>("input")!, "https://other.example/b");
    press(buttonNamed(panel, "Update link"));
    expect(marksOf(latest.block)).toEqual([
      link(6, 11, "link-form-00001", "https://other.example/b"),
    ]);
  });

  it("'Remove link' in the panel takes the link away", () => {
    const { host, latest } = mount(textBlock("Hello world", [link(6, 11), bold(0, 5)]));
    select(host, 7, 9);
    press(buttonNamed(host, "Link"));
    press(buttonNamed(host, "Remove link"));
    expect(marksOf(latest.block)).toEqual([bold(0, 5)]);
  });

  it("a selection that overlaps an existing link is refused with the overlap sentence", () => {
    const { host, changes } = mount(textBlock("Hello big world", [link(6, 9)]));
    select(host, 4, 12);
    press(buttonNamed(host, "Link"));
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(changes).toEqual([]);
    expect(host.textContent).toContain("Links can’t overlap. Remove the other link first.");
  });

  it("with no selection and no link the button stays disabled", () => {
    const { host } = mount(textBlock("Hello world", [link(6, 11)]));
    select(host, 2);
    expect(buttonNamed(host, "Link").disabled).toBe(true);
  });

  it("the 11th link is disabled with the limit message", () => {
    const marks = Array.from({ length: 10 }, (_, i) =>
      link(i * 3, i * 3 + 2, `link-form-${String(i).padStart(5, "0")}`),
    );
    const { host } = mount(textBlock("x".repeat(60), marks));
    select(host, 40, 45);
    expect(buttonNamed(host, "Link").disabled).toBe(true);
    expect(host.textContent).toContain("You can add up to 10 links to one text block.");
    // Inside an existing link the button still edits it.
    select(host, 1);
    expect(buttonNamed(host, "Link").disabled).toBe(false);
  });

  it("the row buttons edit and remove that link", () => {
    const { host, latest } = mount(
      textBlock("Hello world", [
        link(0, 5, "link-form-00001"),
        link(6, 11, "link-form-00002", "https://b.example"),
      ]),
    );
    const list = host.querySelector<HTMLElement>('section[aria-label="Links in this text"]')!;
    expect([...list.querySelectorAll("li")].map((li) => li.getAttribute("data-item-id"))).toEqual([
      "link-form-00001",
      "link-form-00002",
    ]);
    press(buttonNamed(list, "Edit link: world"));
    const panel = host.querySelector<HTMLElement>('[role="group"][aria-label="Update link"]')!;
    expect(panel.querySelector<HTMLInputElement>("input")!.value).toBe("https://b.example");
    press(buttonNamed(panel, "Cancel"));
    press(buttonNamed(host.querySelector<HTMLElement>("section")!, "Remove link: Hello"));
    expect(marksOf(latest.block)).toEqual([link(6, 11, "link-form-00002", "https://b.example")]);
  });

  it("the panel closes when the text changes", () => {
    const { host } = mount(textBlock("Hello world"));
    select(host, 6, 11);
    press(buttonNamed(host, "Link"));
    expect(host.querySelector('[role="group"]')).not.toBeNull();
    typeInto(area(host), "Hello world!");
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  it("a block that was plain text opens with no marks and no list", () => {
    const { host, changes } = mount(textBlock("Hello world"));
    expect(host.querySelector('section[aria-label="Links in this text"]')).toBeNull();
    expect(changes).toEqual([]);
  });
});

describe("M6-30 errors on a link row", () => {
  const marks = [
    link(0, 5, "link-form-00001", "javascript:alert(1)"),
    link(6, 11, "link-form-00002", "https://blocked.example/"),
  ];

  it("shows the Publish error or the blocked-site error in red on that row, and marks it invalid", () => {
    const errors: PublishError[] = [
      {
        blockId: "text-form-0001",
        itemId: "link-form-00001",
        field: "url",
        message: "Enter a full web address, like https://example.com.",
      },
      {
        blockId: "text-form-0001",
        itemId: "link-form-00002",
        field: "url",
        message: "That site is blocked. Use a different link.",
      },
    ];
    const { host } = mount(textBlock("Hello world", marks), errors);
    const rows = [...host.querySelectorAll<HTMLElement>("section li")];
    expect(rows.map((row) => row.getAttribute("aria-invalid"))).toEqual(["true", "true"]);
    expect(rows[0]!.textContent).toContain("Enter a full web address, like https://example.com.");
    expect(rows[1]!.textContent).toContain("That site is blocked. Use a different link.");
    expect(rows[0]!.querySelector(".text-bad")).not.toBeNull();
    // The row can take focus (the editor focuses the first invalid control after a failed Publish).
    expect(rows[0]!.tabIndex).toBe(-1);
    act(() => rows[0]!.focus());
    expect(document.activeElement).toBe(rows[0]);
  });

  it("shows no error on a row that has none", () => {
    const { host } = mount(textBlock("Hello world", marks), [
      {
        blockId: "text-form-0001",
        itemId: "link-form-00002",
        field: "url",
        message: "That site is blocked. Use a different link.",
      },
    ]);
    const rows = [...host.querySelectorAll<HTMLElement>("section li")];
    expect(rows[0]!.getAttribute("aria-invalid")).toBeNull();
    expect(rows[1]!.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the block's own marks error under the toolbar", () => {
    const { host } = mount(textBlock("Hello", [bold(0, 3)]), [
      { blockId: "text-form-0001", field: "marks", message: "This text has too much formatting." },
    ]);
    expect(host.textContent).toContain("This text has too much formatting.");
  });
});
