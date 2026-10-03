// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMBED_ERROR_MESSAGE,
  URL_ERROR_MESSAGE,
  blockDefaults,
  newGridCell,
  newSocialIcon,
  type Block,
  type ImageRef,
  type PublishError,
} from "@/lib/document";
import { BLOCK_FORMS } from "@/components/blocks/forms";
import { clampMultiline, clampSingleLine } from "@/components/blocks/text-field";
import { UrlField } from "@/components/blocks/url-field";
import { blocks } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

/** Mounts a form around a stateful block, the way the editor panel does, and reports every change. */
function mountForm(initial: Block, errors: PublishError[] = []) {
  const changes: Block[] = [];
  const latest = { block: initial };
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
      // Like the editor's reducer: the image goes onto the block as it is now.
      onImage: (image: ImageRef | null) => {
        setBlock((current) => {
          if (current.type !== "card" && current.type !== "image") return current;
          const next = { ...current, image };
          changes.push(next);
          return next;
        });
      },
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

/** Types into a controlled input the way a browser does: native setter, then an input event. */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(el: HTMLElement) {
  act(() => {
    el.focus();
    el.blur();
  });
}

function click(el: Element) {
  act(() => (el as HTMLElement).click());
}

const input = (host: HTMLElement, field: string) =>
  host.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
/** The button's visible name: its text without aria-hidden decoration such as a "+". */
function nameOf(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent?.trim() ?? "";
}
const button = (host: ParentNode, name: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => nameOf(b) === name)!;

describe("M2-15 UrlField", () => {
  function mountUrl(props: Partial<Parameters<typeof UrlField>[0]> = {}) {
    const changes: string[] = [];
    function Harness() {
      const [value, setValue] = useState(props.value ?? "");
      return createElement(UrlField, {
        ...props,
        value,
        onChange: (next: string) => {
          changes.push(next);
          setValue(next);
        },
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
    return { host, changes, field: host.querySelector("input")! };
  }

  it("is a url input for phone keyboards, with the 'https://' placeholder and a label", () => {
    const { host, field } = mountUrl();
    expect(field.type).toBe("url");
    expect(field.getAttribute("inputmode")).toBe("url");
    expect(field.getAttribute("autocapitalize")).toBe("none");
    expect(field.getAttribute("placeholder")).toBe("https://");
    expect(field.getAttribute("spellcheck")).toBe("false");
    expect(host.querySelector(`label[for="${field.id}"]`)?.textContent).toBe("Link");
    expect(field.className).toMatch(/\bmin-h-11\b/);
    expect(field.className).toMatch(/\bfont-mono\b/);
    expect(field.className).toMatch(/\bmin-w-0\b/);
  });

  it("rewrites a bare address to https on blur", () => {
    const { field, changes } = mountUrl();
    type(field, "maraokafor.com/portraits");
    expect(field.value).toBe("maraokafor.com/portraits");
    blur(field);
    expect(field.value).toBe("https://maraokafor.com/portraits");
    expect(changes.at(-1)).toBe("https://maraokafor.com/portraits");
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps javascript: as typed, flags it and still reports the value", () => {
    const { host, field, changes } = mountUrl();
    type(field, "javascript:alert(1)");
    expect(changes.at(-1)).toBe("javascript:alert(1)");
    blur(field);
    expect(field.value).toBe("javascript:alert(1)");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby")!;
    expect(describedBy).toBeTruthy();
    expect(host.querySelector(`#${CSS.escape(describedBy)}`)?.textContent).toBe(URL_ERROR_MESSAGE);
  });

  it("shows no error before the first blur or for an empty field, and clears it when fixed", () => {
    const { host, field } = mountUrl();
    type(field, "nope");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    blur(field); // "nope" becomes "https://nope", which is a valid host
    expect(field.getAttribute("aria-invalid")).toBeNull();

    type(field, "ftp://example.com");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    type(field, "https://example.com");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(host.textContent).not.toContain(URL_ERROR_MESSAGE);

    type(field, "");
    blur(field);
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the publish gate's message until the value validates", () => {
    const message = "Enter a full web address, like https://example.com.";
    const { host, field } = mountUrl({ error: message });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain(message);
    type(field, "https://example.com");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(host.textContent).not.toContain(message);
  });

  it("embed: only links from the eight providers are valid, with the embed message", () => {
    const { host, field } = mountUrl({ kind: "embed" });
    type(field, "https://evil.example/x");
    blur(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain(EMBED_ERROR_MESSAGE);
    type(field, "https://youtu.be/jNQXAC9IVRw");
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("optional: an empty value is fine", () => {
    const { field } = mountUrl({ optional: true, error: URL_ERROR_MESSAGE });
    expect(field.getAttribute("aria-invalid")).toBe("true"); // the gate said so
    type(field, "x");
    type(field, "");
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("accepts a 300-character address", () => {
    const long = `https://example.com/${"a".repeat(280)}`;
    const { field, changes } = mountUrl();
    type(field, long);
    expect(changes.at(-1)).toBe(long);
    expect(field.value).toHaveLength(long.length);
  });
});

describe("M2-15 link form", () => {
  it("edits label and url, one line, at most 80 characters", () => {
    const { host, latest } = mountForm(blockDefaults.link());
    type(input(host, "label"), "x".repeat(120));
    expect((latest.block as { label: string }).label).toHaveLength(80);
    type(input(host, "url"), "https://example.com");
    expect(latest.block).toMatchObject({ url: "https://example.com" });
  });

  it("collapses line breaks and control characters to spaces and cuts at the limit", () => {
    expect(clampSingleLine("A\nB\r\nC\u0007D", 80)).toBe("A B C D");
    expect(clampSingleLine("👍".repeat(100), 80)).toBe("👍".repeat(80));
    expect(clampMultiline("A\r\nB\rC\u0007D", 600)).toBe("A\nB\nCD");
  });

  it("keeps surrounding spaces as typed (the schema trims, the input does not)", () => {
    const { host, latest } = mountForm(blockDefaults.link());
    type(input(host, "label"), " padded ");
    expect((latest.block as { label: string }).label).toBe(" padded ");
  });

  it("shows the gate's messages under the fields", () => {
    const link = blockDefaults.link();
    const { host } = mountForm(link, [
      { blockId: link.id, field: "label", message: "Add a link label." },
      { blockId: link.id, field: "url", message: URL_ERROR_MESSAGE },
      { blockId: "other-block-1", field: "label", message: "not mine" },
    ]);
    expect(host.textContent).toContain("Add a link label.");
    expect(host.textContent).toContain(URL_ERROR_MESSAGE);
    expect(host.textContent).not.toContain("not mine");
    expect(input(host, "label").getAttribute("aria-invalid")).toBe("true");
  });

  it("renders the three per-block override controls and nothing else (Milestone 3: M3-17, M3-18)", () => {
    const { host } = mountForm(blockDefaults.link());
    const controls = host.querySelector('[data-testid="override-controls"]');
    expect(controls).not.toBeNull();
    // Button style and Corner radius are selects, Color a swatch plus a hex field: three controls.
    expect([...controls!.querySelectorAll("select")].map((el) => el.dataset.field)).toEqual([
      "override-button-style",
      "override-radius",
    ]);
    expect(controls!.querySelector('input[data-field="override-color"]')).not.toBeNull();
    // No font, spacing or background control exists on a block.
    expect(controls!.textContent).not.toMatch(/font|spacing|density|background|width/i);
  });
});

describe("M2-16 header, text and divider forms", () => {
  it("header: a 'Text' input up to 80 characters", () => {
    const { host, latest } = mountForm(blockDefaults.header());
    expect(host.querySelector("label")?.textContent).toBe("Text");
    type(input(host, "text"), "h".repeat(100));
    expect((latest.block as { text: string }).text).toHaveLength(80);
  });

  it("text: a textarea with a '{n} / 600' counter that keeps line breaks and stops at 600", () => {
    const { host, latest } = mountForm({ ...blocks.text, text: "Hello" });
    expect(host.textContent).toContain("5 / 600");
    const area = host.querySelector("textarea")!;
    type(area, "line one\nline two");
    expect((latest.block as { text: string }).text).toBe("line one\nline two");
    expect(host.textContent).toContain("17 / 600");
    type(area, "a".repeat(700));
    expect((latest.block as { text: string }).text).toHaveLength(600);
    expect(host.textContent).toContain("600 / 600");
  });

  it("text: normalizes \\r\\n and drops other control characters", () => {
    const { host, latest } = mountForm(blockDefaults.text());
    type(host.querySelector("textarea")!, "a\r\nb\u0007c");
    expect((latest.block as { text: string }).text).toBe("a\nbc");
  });

  it("text: counts code points, not UTF-16 units", () => {
    const { host } = mountForm({ ...blocks.text, text: "👍👍" });
    expect(host.textContent).toContain("2 / 600");
  });

  // M6-46: a divider has no content to edit, but it has its own style: the line's color.
  it("divider: renders only its style group, with the line color", () => {
    const { host } = mountForm(blockDefaults.divider());
    expect(host.querySelectorAll("input[type=text], textarea")).toHaveLength(1);
    expect(host.textContent).toContain("Style this block");
    expect(host.textContent).toContain("Line color");
  });
});

describe("M2-17 social form", () => {
  const icons = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...newSocialIcon("website"),
      id: `icon-test-${String(i).padStart(4, "0")}`,
      url: `https://example.com/${i}`,
    }));
  const social = (n: number): Block => ({ ...blocks.social, icons: icons(n) });

  it("has one row per icon with a platform select, a url field and the three buttons", () => {
    const { host } = mountForm(social(3));
    const rows = host.querySelectorAll<HTMLElement>("[data-item-id]");
    expect(rows).toHaveLength(3);
    for (const row of Array.from(rows)) {
      expect(row.querySelector("select")?.options).toHaveLength(10);
      expect(row.querySelector('input[type="url"]')).not.toBeNull();
      expect(["Move up", "Move down", "Remove"].every((name) => button(row, name))).toBe(true);
      for (const b of Array.from(row.querySelectorAll("button"))) {
        expect(b.className).toMatch(/\bmin-h-11\b/);
      }
    }
  });

  it("disables Remove at one icon, Move up on the first and Move down on the last row", () => {
    const one = mountForm(social(1));
    expect(button(one.host, "Remove").disabled).toBe(true);
    const three = mountForm(social(3));
    const rows = Array.from(three.host.querySelectorAll<HTMLElement>("[data-item-id]"));
    expect(button(rows[0]!, "Move up").disabled).toBe(true);
    expect(button(rows[2]!, "Move down").disabled).toBe(true);
    expect(button(rows[1]!, "Remove").disabled).toBe(false);
  });

  it("adds an icon (a fresh id, not a repeated platform) and disables Add icon at 8", () => {
    const { host, latest } = mountForm({
      ...blocks.social,
      icons: [{ id: "icon-test-0000", platform: "instagram", url: "https://instagram.com/a" }],
    });
    click(button(host, "Add icon"));
    const added = (latest.block as { icons: { id: string; platform: string }[] }).icons;
    expect(added).toHaveLength(2);
    expect(added[1]!.platform).not.toBe("instagram");
    expect(added[1]!.id).not.toBe(added[0]!.id);

    const full = mountForm(social(8));
    expect(button(full.host, "Add icon").disabled).toBe(true);
    const seven = mountForm(social(7));
    expect(button(seven.host, "Add icon").disabled).toBe(false);
  });

  it("moves and removes icons, keeping ids", () => {
    const { host, latest } = mountForm(social(3));
    const idsOf = () => (latest.block as { icons: { id: string }[] }).icons.map((i) => i.id);
    const rows = () => Array.from(host.querySelectorAll<HTMLElement>("[data-item-id]"));
    click(button(rows()[0]!, "Move down"));
    expect(idsOf()).toEqual(["icon-test-0001", "icon-test-0000", "icon-test-0002"]);
    click(button(rows()[2]!, "Move up"));
    expect(idsOf()).toEqual(["icon-test-0001", "icon-test-0002", "icon-test-0000"]);
    click(button(rows()[1]!, "Remove"));
    expect(idsOf()).toEqual(["icon-test-0001", "icon-test-0000"]);
  });

  it("switching to Email swaps the url field for an email field, keeping the id", () => {
    const { host, latest } = mountForm(social(1));
    const select = host.querySelector("select")!;
    act(() => {
      select.value = "email";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(latest.block).toMatchObject({
      icons: [{ id: "icon-test-0000", platform: "email", address: "" }],
    });
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
    expect(host.querySelector('input[type="url"]')).toBeNull();
    type(input(host, "address"), "hello@maraokafor.com");
    expect(latest.block).toMatchObject({ icons: [{ address: "hello@maraokafor.com" }] });
    type(input(host, "address"), "nope");
    blur(input(host, "address"));
    expect(input(host, "address").getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Enter a valid email address.");
  });

  it("highlights the icon the gate flagged, by id", () => {
    const block = social(3);
    const { host } = mountForm(block, [
      { blockId: block.id, itemId: "icon-test-0001", field: "url", message: URL_ERROR_MESSAGE },
    ]);
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-item-id]"));
    expect(rows.map((r) => r.getAttribute("data-invalid"))).toEqual([null, "true", null]);
    expect(rows[1]!.textContent).toContain(URL_ERROR_MESSAGE);
    expect(rows[0]!.textContent).not.toContain(URL_ERROR_MESSAGE);
  });
});

describe("M2-18 grid form", () => {
  const cells = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...newGridCell(),
      id: `cell-test-${String(i).padStart(4, "0")}`,
      title: `Cell ${i}`,
    }));
  const grid = (n: number): Block => ({ ...blocks.grid, cells: cells(n) });

  it("has Title, Subtitle and Link per cell, with limits of 40 and 60 characters", () => {
    const { host, latest } = mountForm(grid(2));
    const first = host.querySelector<HTMLElement>("[data-item-id]")!;
    expect(first.querySelector('[data-field="title"]')).not.toBeNull();
    expect(first.querySelector('[data-field="subtitle"]')).not.toBeNull();
    expect(first.querySelector('[data-field="url"]')).not.toBeNull();
    type(first.querySelector<HTMLInputElement>('[data-field="title"]')!, "t".repeat(60));
    type(first.querySelector<HTMLInputElement>('[data-field="subtitle"]')!, "s".repeat(90));
    const cell = (latest.block as { cells: { title: string; subtitle: string }[] }).cells[0]!;
    expect(cell.title).toHaveLength(40);
    expect(cell.subtitle).toHaveLength(60);
  });

  it("disables Remove at 2 cells and Add cell at 6", () => {
    const two = mountForm(grid(2));
    for (const row of Array.from(two.host.querySelectorAll<HTMLElement>("[data-item-id]"))) {
      expect(button(row, "Remove").disabled).toBe(true);
    }
    expect(button(two.host, "Add cell").disabled).toBe(false);
    const six = mountForm(grid(6));
    expect(button(six.host, "Add cell").disabled).toBe(true);
    expect(button(six.host, "Remove")?.disabled).toBe(false);
  });

  it("adds, moves and removes cells", () => {
    const { host, latest } = mountForm(grid(3));
    const titles = () => (latest.block as { cells: { title: string }[] }).cells.map((c) => c.title);
    click(button(host, "Add cell"));
    expect(titles()).toEqual(["Cell 0", "Cell 1", "Cell 2", ""]);
    const rows = () => Array.from(host.querySelectorAll<HTMLElement>("[data-item-id]"));
    click(button(rows()[0]!, "Move down"));
    expect(titles()).toEqual(["Cell 1", "Cell 0", "Cell 2", ""]);
    click(button(rows()[1]!, "Remove"));
    expect(titles()).toEqual(["Cell 1", "Cell 2", ""]);
  });
});

describe("M2-19 embed form", () => {
  it("has a Caption input and an embed url field with the embed message", () => {
    const { host, latest } = mountForm(blockDefaults.embed());
    type(input(host, "caption"), "c".repeat(120));
    expect((latest.block as { caption: string }).caption).toHaveLength(80);
    type(input(host, "url"), "https://evil.example/x");
    blur(input(host, "url"));
    expect(input(host, "url").getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain(EMBED_ERROR_MESSAGE);
  });

  it("says what it recognized", () => {
    const { host } = mountForm({ ...blocks.embed, url: "https://youtu.be/jNQXAC9IVRw" });
    expect(host.textContent).toContain("YouTube video");
    const spotify = mountForm({
      ...blocks.embed,
      url: "https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M",
    });
    expect(spotify.host.textContent).toContain("Spotify album");
  });
});

describe("M2-20 and M2-21 image and card forms", () => {
  it("image: upload control, alt text with its hint, and an optional link", () => {
    const { host, latest } = mountForm(blockDefaults.image());
    expect(button(host, "Upload image")).toBeDefined();
    expect(host.textContent).toContain("Describe the image for people who can't see it");
    type(input(host, "alt"), "a".repeat(200));
    expect((latest.block as { alt: string }).alt).toHaveLength(140);
    const link = input(host, "url");
    expect(link.type).toBe("url");
    expect(host.textContent).toContain("Link (optional)");
    type(link, "");
    blur(link);
    expect(link.getAttribute("aria-invalid")).toBeNull();
  });

  it("image: shows 'Upload an image.' and the alt message from the gate", () => {
    const block = blockDefaults.image();
    const { host } = mountForm(block, [
      { blockId: block.id, field: "image", message: "Upload an image." },
      { blockId: block.id, field: "alt", message: "Add a short description of this image." },
    ]);
    expect(host.textContent).toContain("Upload an image.");
    expect(host.textContent).toContain("Add a short description of this image.");
    expect(input(host, "alt").getAttribute("aria-invalid")).toBe("true");
  });

  it("image and card: the gate's message about the image shows even when an image is set", () => {
    const message = "That image isn’t in your uploads. Upload it again.";
    const image = {
      path: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/abcd1234-abcd1234.png",
      width: 4,
      height: 3,
    };
    for (const block of [
      { ...blocks.image, image },
      { ...blocks.card, image },
    ] as Block[]) {
      const { host } = mountForm(block, [{ blockId: block.id, field: "image", message }]);
      expect(host.textContent).toContain(message);
      const other = mountForm(block, [{ blockId: "another-blk-1", field: "image", message }]);
      expect(other.host.textContent).not.toContain(message);
    }
  });

  it("image: a value that is not a stored reference (field image.path) shows its message", () => {
    const block = blocks.image;
    const { host } = mountForm(block, [
      { blockId: block.id, field: "image.path", message: "Not a valid image reference." },
    ]);
    expect(host.textContent).toContain("Not a valid image reference.");
  });

  it("card: title, caption, link and the shared upload control", () => {
    const { host, latest } = mountForm(blockDefaults.card());
    type(input(host, "title"), "t".repeat(90));
    type(input(host, "caption"), "c".repeat(140));
    expect(latest.block).toMatchObject({ title: "t".repeat(60), caption: "c".repeat(100) });
    expect(input(host, "url").type).toBe("url");
    expect(button(host, "Upload image")).toBeDefined();
  });
});
