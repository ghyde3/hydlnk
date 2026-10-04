// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickedColor, pickerValue } from "@/components/design/color-picker";
import { ColorRow } from "@/components/design/sections/color-section";
import { HEX_ERROR_MESSAGE } from "@/lib/design";
import { listFiles, stripComments, walk } from "./support/module-graph";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M9-07: react-colorful replaces every native color input. What is checked here: the picker never
 * writes a value that is not a six-digit hex (NaN, Infinity and hostile strings through `onChange`),
 * a stored color in another form opens the picker on its six-digit equivalent, no `type="color"` is
 * left in `src`, the library stays out of public pages, and the row's controls behave (a 44px named
 * swatch button, an inline panel with the two sliders and Done, one panel open at a time, Escape).
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const code = (path: string) => stripComments(read(path));

describe("M9-07 what the picker may write", () => {
  it("accepts a complete six-digit hex in either case and returns it upper case", () => {
    expect(pickedColor("#c46a4f")).toBe("#C46A4F");
    expect(pickedColor("#C46A4F")).toBe("#C46A4F");
    expect(pickedColor("#000000")).toBe("#000000");
  });

  it("refuses everything else: NaN, Infinity, numbers, objects, shorthand, alpha, markup", () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      12,
      null,
      undefined,
      {},
      [],
      { r: 1, g: 2, b: 3 },
      "",
      "#",
      "#12",
      "#FFF",
      "#C46A4",
      "#C46A4FF",
      "C46A4F",
      "red",
      "rgb(1,2,3)",
      "#GGGGGG",
      "#FFF;}</style>",
      "#C46A4F;}</style><script>alert(1)</script>",
      "#C46A4F\n",
      " #C46A4F",
      "javascript:alert(1)",
      "url(https://example.com/x)",
    ]) {
      expect(pickedColor(bad), String(bad)).toBeNull();
    }
  });

  it("opens on the six-digit equivalent of a stored #RGB or #RRGGBBAA, and on the fallback for anything else", () => {
    expect(pickerValue("#C46A4F")).toBe("#c46a4f");
    expect(pickerValue("#FA0")).toBe("#ffaa00");
    expect(pickerValue("#C46A4F80")).toBe("#c46a4f");
    expect(pickerValue("not a color")).toBe("#000000");
    expect(pickerValue("not a color", "#FFFFFF")).toBe("#ffffff");
    expect(pickerValue(undefined)).toBe("#000000");
    expect(pickerValue("#FFF;}</style>")).toBe("#000000");
  });
});

describe("M9-07 no native color input is left, and the library stays out of public pages", () => {
  it("a scan of src finds no type=\"color\" and no type='color'", () => {
    const found = listFiles("src", /\.(tsx?|css|mjs|jsx?)$/).filter((file) =>
      /type\s*=\s*["']color["']|type:\s*["']color["']/.test(code(file)),
    );
    expect(found).toEqual([]);
  });

  it("react-colorful is imported by the picker only", () => {
    const importers = listFiles("src").filter((file) => /["']react-colorful["']/.test(code(file)));
    expect(importers).toEqual(["src/components/design/color-picker.tsx"]);
  });

  it("nothing reachable from the tenant routes, the page renderer, the static renderer or the marketing site imports it", () => {
    const entries = [
      ...listFiles("src/app/(tenant)"),
      ...listFiles("src/app/(marketing)"),
      ...listFiles("src/components/page"),
      ...listFiles("src/components/marketing"),
      ...listFiles("src/lib/tenant-render"),
      ...listFiles("src/lib/tenant-assets"),
    ];
    const { packages } = walk(entries);
    expect(packages.has("react-colorful")).toBe(false);
  });

  it("the picker makes no request and keeps nothing in the browser", () => {
    const source = code("src/components/design/color-picker.tsx");
    expect(source).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });
});

describe("M9-07 a color row", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const swatch = (name: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${name} color"]`)!;
  // react-colorful reads `keyCode` (37 to 40 are the arrows); the others are read by `key`.
  const KEY_CODES: Record<string, number> = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
  };
  const key = (target: Element, name: string) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: name,
          keyCode: KEY_CODES[name] ?? 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

  function mount(onChange = vi.fn(), value = "#C46A4F") {
    const rows = [
      createElement(ColorRow, {
        key: "a",
        rowKey: "accent",
        name: "Accent",
        value,
        onChange,
        last: false,
      }),
      createElement(ColorRow, {
        key: "b",
        rowKey: "bg",
        name: "Background",
        value: "#FFFFFF",
        onChange: vi.fn(),
        last: true,
      }),
    ];
    act(() => root.render(createElement("div", null, ...rows)));
    return onChange;
  }

  it("has a 44px swatch button named '<name> color', closed, with aria-expanded and no panel", () => {
    mount();
    const button = swatch("Accent");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBeNull();
    expect(button.className).toContain("size-11");
    expect(button.className).toContain("border-line-2");
    expect(button.style.background).toContain("rgb(196, 106, 79)");
    expect(host.querySelector(".react-colorful")).toBeNull();
    expect(host.querySelector('input[type="color"]')).toBeNull();
    // The hex field is still there, 16px, named '<name> hex'.
    const hex = host.querySelector<HTMLInputElement>('input[aria-label="Accent hex"]')!;
    expect(hex.value).toBe("#C46A4F");
    expect(hex.className).toContain("text-base");
  });

  it("opens an inline panel under the row with the two sliders, named Color and Hue, and a Done button", () => {
    mount();
    act(() => swatch("Accent").click());
    expect(swatch("Accent").getAttribute("aria-expanded")).toBe("true");
    const panel = host.querySelector<HTMLElement>(
      `#${swatch("Accent").getAttribute("aria-controls")}`,
    )!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("group");
    expect(panel.getAttribute("aria-label")).toBe("Accent color picker");
    // In the row, not a dialog and not a popover.
    expect(host.querySelector('[data-color-row="accent"]')!.contains(panel)).toBe(true);
    expect(host.querySelector('[role="dialog"], dialog, [popover]')).toBeNull();
    const sliders = Array.from(panel.querySelectorAll<HTMLElement>('[role="slider"]'));
    expect(sliders.map((s) => s.getAttribute("aria-label"))).toEqual(["Color", "Hue"]);
    expect(sliders[0]!.getAttribute("aria-valuetext")).toMatch(
      /^Saturation \d+%, Brightness \d+%$/,
    );
    expect(sliders[1]!.getAttribute("aria-valuetext")).toMatch(/^\d+ degrees$/);
    expect(Array.from(panel.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Done",
    ]);
    expect(panel.querySelector("button")!.className).toContain("min-h-11");
  });

  it("the arrow keys on the square move the color, one step at a time, and write an upper case #RRGGBB", () => {
    const onChange = mount();
    act(() => swatch("Accent").click());
    const square = host.querySelector<HTMLElement>('[role="slider"][aria-label="Color"]')!;
    key(square, "ArrowRight");
    key(square, "ArrowDown");
    expect(onChange).toHaveBeenCalled();
    for (const [hex] of onChange.mock.calls) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    const hue = host.querySelector<HTMLElement>('[role="slider"][aria-label="Hue"]')!;
    onChange.mockClear();
    key(hue, "ArrowRight");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("a stored #RRGGBBAA opens the picker without rewriting the draft", () => {
    const onChange = mount(vi.fn(), "#C46A4F80");
    act(() => swatch("Accent").click());
    expect(host.querySelector('[role="slider"][aria-label="Color"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Done and Escape close the panel and put focus back on the swatch; another row's swatch closes this one", () => {
    mount();
    const accent = swatch("Accent");
    act(() => accent.click());
    expect(host.querySelector(".react-colorful")).not.toBeNull();
    act(() =>
      host.querySelector<HTMLElement>(`#${accent.getAttribute("aria-controls")} button`)!.click(),
    );
    expect(host.querySelector(".react-colorful")).toBeNull();
    expect(accent.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(accent);

    act(() => accent.click());
    key(host.querySelector('[role="slider"][aria-label="Hue"]')!, "Escape");
    expect(host.querySelector(".react-colorful")).toBeNull();
    expect(document.activeElement).toBe(accent);

    act(() => accent.click());
    act(() => swatch("Background").click());
    expect(accent.getAttribute("aria-expanded")).toBe("false");
    expect(swatch("Background").getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll(".react-colorful")).toHaveLength(1);
  });

  it("the hex field keeps its rules: '#12' shows the message and writes nothing; a hostile string too; a full hex applies as typed", () => {
    const onChange = mount();
    const hex = host.querySelector<HTMLInputElement>('input[aria-label="Accent hex"]')!;
    const type = (value: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(hex, value);
        hex.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("#12");
    expect(host.textContent).toContain(HEX_ERROR_MESSAGE);
    expect(onChange).not.toHaveBeenCalled();
    type("#FFF;}</style>");
    expect(host.textContent).toContain(HEX_ERROR_MESSAGE);
    expect(onChange).not.toHaveBeenCalled();
    type("#1B1814");
    expect(onChange).toHaveBeenCalledWith("#1B1814");
  });
});
