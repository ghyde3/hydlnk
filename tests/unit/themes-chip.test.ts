// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { blockDefaults, type Block } from "@/lib/document";
import { OverrideChip } from "@/components/themes/override-chip";

/**
 * M3-17 / M3-18: the block row's override chip. The row (editor-owned) renders `<OverrideChip
 * block={block} />`; this pins what the chip says and how it looks, so the wiring is one line.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function chipFor(block: Block): HTMLElement | null {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(OverrideChip, { block })));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host.querySelector<HTMLElement>("[data-testid=override-chip]");
}

const link = (overrides?: Record<string, unknown>) =>
  ({ ...blockDefaults.link(), ...(overrides ? { overrides } : {}) }) as Block;

describe("M3-17 / M3-18 the override chip", () => {
  it("says '<Style> override' for a button style, and nothing without an override", () => {
    expect(chipFor(link({ buttonStyle: "fill" }))!.textContent).toBe("Fill override");
    expect(chipFor(link({ buttonStyle: "pill" }))!.textContent).toBe("Pill override");
    expect(chipFor(link())).toBeNull();
    expect(chipFor(blockDefaults.header() as Block)).toBeNull();
  });

  it("names a colour or a radius override, and counts two or three", () => {
    expect(chipFor(link({ radius: 0 }))!.textContent).toBe("Radius override");
    expect(
      chipFor(link({ buttonBg: "#C46A4F", accent: "#C46A4F", buttonText: "#F7F3EC" }))!.textContent,
    ).toBe("Color override");
    expect(chipFor(link({ buttonStyle: "fill", radius: 20 }))!.textContent).toBe("2 overrides");
    expect(
      chipFor(link({ buttonStyle: "fill", radius: 20, buttonBg: "#C46A4F" }))!.textContent,
    ).toBe("3 overrides");
  });

  it("is a mono 11px chip in the brass-soft colours, hidden below 760px like the Hidden chip", () => {
    const chip = chipFor(link({ buttonStyle: "fill" }))!;
    for (const name of [
      "font-mono",
      "text-[11px]",
      "bg-brass-soft",
      "text-brass-soft-text",
      "rounded-sm",
      "hidden",
      "hl:inline-block",
    ]) {
      expect(chip.className.split(/\s+/)).toContain(name);
    }
  });
});
