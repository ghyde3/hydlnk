// @vitest-environment jsdom
import { act, createElement, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesignSectionProps } from "@/components/design/types";
import { ShapeSection } from "@/components/design/sections/shape-section";
import { SpacingSection } from "@/components/design/sections/spacing-section";
import { resolveTokens, type TokenSet } from "@/lib/theme";
import { noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M3-11, M3-12, M3-13: the shape and spacing groups show the resolved theme with aria-pressed and
 * write exactly one page-level token when an option is chosen.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

type Call = [keyof TokenSet, unknown];

function mount(Section: ComponentType<DesignSectionProps>, theme: Partial<TokenSet> = {}) {
  const calls: Call[] = [];
  function Harness() {
    const [overrides, setOverrides] = useState<Partial<TokenSet>>({});
    const resolved = resolveTokens({ ...noirTokens, ...theme }, overrides);
    return createElement(Section, {
      resolved,
      overrides,
      pageId: "00000000-0000-4000-8000-0000000000b1",
      ownerId: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
      setToken: (key, value) => {
        calls.push([key, value]);
        setOverrides((current) => {
          const next: Partial<TokenSet> = { ...current };
          if (value === undefined) delete next[key];
          else (next as Record<string, unknown>)[key] = value;
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
  return { host, calls };
}

const group = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)!;
const options = (host: HTMLElement, name: string) =>
  Array.from(group(host, name).querySelectorAll("button"));
const pressed = (host: HTMLElement, name: string) =>
  options(host, name)
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);
const click = (button: HTMLElement) => act(() => button.click());
const pick = (host: HTMLElement, name: string, label: string) =>
  click(options(host, name).find((button) => button.textContent?.trim() === label)!);

describe("M3-11 button style", () => {
  it("offers Fill, Outline, Soft, Shadow and Pill, with exactly one pressed", () => {
    const { host } = mount(ShapeSection);
    expect(options(host, "Button style").map((b) => b.textContent)).toEqual([
      "Fill",
      "Outline",
      "Soft",
      "Shadow",
      "Pill",
    ]);
    for (const b of options(host, "Button style")) {
      expect(b.getAttribute("aria-pressed")).toMatch(/^(true|false)$/);
      expect(b.type).toBe("button");
    }
  });

  it.each([
    ["fill", "Fill"],
    ["outline", "Outline"],
    ["soft", "Soft"],
    ["shadow", "Shadow"],
    ["pill", "Pill"],
  ] as const)("shows the resolved %s theme as the one pressed option", (buttonStyle, label) => {
    const { host } = mount(ShapeSection, { buttonStyle });
    expect(pressed(host, "Button style")).toEqual([label]);
  });

  it("choosing an option writes buttonStyle once and moves the pressed state", () => {
    const { host, calls } = mount(ShapeSection, { buttonStyle: "outline" });
    pick(host, "Button style", "Shadow");
    expect(calls).toEqual([["buttonStyle", "shadow"]]);
    expect(pressed(host, "Button style")).toEqual(["Shadow"]);
  });

  it("every option is at least 44px tall on a phone (min-h-11) and wraps (flex-wrap)", () => {
    const { host } = mount(ShapeSection);
    expect(group(host, "Button style").className).toContain("flex-wrap");
    for (const b of options(host, "Button style")) expect(b.className).toContain("min-h-11");
  });
});

describe("M3-12 corner radius and border width", () => {
  it("offers 0px, 4px, 12px and 20px with a radius glyph, and presses the resolved radius", () => {
    const { host } = mount(ShapeSection, { radius: 12 });
    expect(options(host, "Corner radius").map((b) => b.textContent)).toEqual([
      "0px",
      "4px",
      "12px",
      "20px",
    ]);
    expect(pressed(host, "Corner radius")).toEqual(["12px"]);
    for (const b of options(host, "Corner radius")) {
      expect(b.querySelector("[aria-hidden=true]")).not.toBeNull();
      expect(b.className).toContain("font-mono");
    }
  });

  it("the glyph's radius follows the option, capped at 7px like the mockup", () => {
    const { host } = mount(ShapeSection);
    const glyphs = options(host, "Corner radius").map(
      (b) => (b.querySelector("[aria-hidden=true]") as HTMLElement).style.borderRadius,
    );
    expect(glyphs).toEqual(["0px", "4px", "7px", "7px"]);
  });

  it.each([0, 4, 12, 20])("choosing %ipx writes radius %i", (radius) => {
    const { host, calls } = mount(ShapeSection, { radius: 8 });
    expect(pressed(host, "Corner radius")).toEqual([]); // 8 is not one of the options
    pick(host, "Corner radius", `${radius}px`);
    expect(calls).toEqual([["radius", radius]]);
    expect(pressed(host, "Corner radius")).toEqual([`${radius}px`]);
  });

  it("offers 0px, 1px and 2px border widths and writes borderWidth", () => {
    const { host, calls } = mount(ShapeSection, { borderWidth: 1 });
    expect(options(host, "Border width").map((b) => b.textContent)).toEqual(["0px", "1px", "2px"]);
    expect(pressed(host, "Border width")).toEqual(["1px"]);
    pick(host, "Border width", "2px");
    pick(host, "Border width", "0px");
    expect(calls).toEqual([
      ["borderWidth", 2],
      ["borderWidth", 0],
    ]);
    expect(pressed(host, "Border width")).toEqual(["0px"]);
  });
});

describe("M3-13 spacing, content width and alignment", () => {
  it("Spacing offers Compact, Regular and Airy and writes density", () => {
    const { host, calls } = mount(SpacingSection, { density: "regular" });
    expect(options(host, "Spacing").map((b) => b.textContent)).toEqual([
      "Compact",
      "Regular",
      "Airy",
    ]);
    expect(pressed(host, "Spacing")).toEqual(["Regular"]);
    pick(host, "Spacing", "Compact");
    pick(host, "Spacing", "Airy");
    expect(calls).toEqual([
      ["density", "compact"],
      ["density", "airy"],
    ]);
  });

  it("Content width offers 480, 560 and 640 and writes maxWidth", () => {
    const { host, calls } = mount(SpacingSection, { maxWidth: 480 });
    expect(options(host, "Content width").map((b) => b.textContent)).toEqual(["480", "560", "640"]);
    expect(pressed(host, "Content width")).toEqual(["480"]);
    pick(host, "Content width", "640");
    expect(calls).toEqual([["maxWidth", 640]]);
    expect(pressed(host, "Content width")).toEqual(["640"]);
  });

  it("Alignment offers Center and Left and writes align", () => {
    const { host, calls } = mount(SpacingSection, { align: "center" });
    expect(options(host, "Alignment").map((b) => b.textContent)).toEqual(["Center", "Left"]);
    expect(pressed(host, "Alignment")).toEqual(["Center"]);
    pick(host, "Alignment", "Left");
    expect(calls).toEqual([["align", "left"]]);
    expect(pressed(host, "Alignment")).toEqual(["Left"]);
  });

  it("every option is at least 44px tall on a phone and the groups wrap", () => {
    const { host } = mount(SpacingSection);
    for (const name of ["Spacing", "Content width", "Alignment"]) {
      expect(group(host, name).className).toContain("flex-wrap");
      for (const b of options(host, name)) expect(b.className).toContain("min-h-11");
    }
  });
});
