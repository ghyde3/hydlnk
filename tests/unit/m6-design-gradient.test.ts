// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundSection } from "@/components/design/sections/background-section";
import { GradientPanel } from "@/components/design/sections/gradient-panel";
import {
  GRADIENT_DIRECTIONS,
  GRADIENT_PRESETS,
  GRADIENT_READABILITY_HINT,
  hardToRead,
} from "@/lib/design/gradient";
import {
  GRADIENT_ANGLES,
  resolveTokens,
  tokenOverridesSchema,
  tokenSetSchema,
  type TokenSet,
} from "@/lib/theme";
import { HEX_ERROR_MESSAGE } from "@/lib/design";
import { OWNER_UID, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M6-42: the Design screen's gradient controls. The data they offer (eight directions, eight
 * presets, the readability check) and the panel itself, driven the way the screen drives it: every
 * change is a `setToken` call and nothing else, so nothing but a value the token schema accepts is
 * ever written.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

type Call = [keyof TokenSet, unknown];

function mount(theme: Partial<TokenSet> = {}, start: Partial<TokenSet> = {}) {
  const calls: Call[] = [];
  const state = { overrides: { ...start } as Partial<TokenSet> };
  function Harness() {
    const [overrides, setOverrides] = useState<Partial<TokenSet>>(start);
    state.overrides = overrides;
    const resolved = resolveTokens({ ...noirTokens, ...theme }, overrides);
    return createElement(BackgroundSection, {
      resolved,
      overrides,
      pageId: "00000000-0000-4000-8000-0000000000b1",
      ownerId: OWNER_UID,
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
  return { host, calls, state };
}

const panel = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-testid="gradient-panel"]');
const byLabel = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const byText = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  )!;
const click = (element: HTMLElement) => act(() => element.click());
const hex = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLInputElement>(`input[type=text][aria-label="${label}"]`)!;

/** Types into a controlled input the way a browser does. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("M6-42 the directions", () => {
  it("are eight, named by where they start and end, one per allowed angle", () => {
    expect(GRADIENT_DIRECTIONS.map((direction) => direction.label)).toEqual([
      "Top to bottom",
      "Bottom to top",
      "Left to right",
      "Right to left",
      "Top left to bottom right",
      "Top right to bottom left",
      "Bottom left to top right",
      "Bottom right to top left",
    ]);
    expect(GRADIENT_DIRECTIONS.map((direction) => direction.angle).sort((a, b) => a - b)).toEqual([
      ...GRADIENT_ANGLES,
    ]);
  });

  it("agree with CSS: 180 runs top to bottom, 0 bottom to top, 90 left to right", () => {
    const angleOf = (label: string) =>
      GRADIENT_DIRECTIONS.find((direction) => direction.label === label)!.angle;
    expect(angleOf("Top to bottom")).toBe(180);
    expect(angleOf("Bottom to top")).toBe(0);
    expect(angleOf("Left to right")).toBe(90);
    expect(angleOf("Right to left")).toBe(270);
    expect(angleOf("Top left to bottom right")).toBe(135);
    expect(angleOf("Top right to bottom left")).toBe(225);
    expect(angleOf("Bottom left to top right")).toBe(45);
    expect(angleOf("Bottom right to top left")).toBe(315);
  });
});

describe("M6-42 the presets", () => {
  it("are the eight named ones", () => {
    expect(GRADIENT_PRESETS.map((preset) => preset.name)).toEqual([
      "Dusk",
      "Ocean",
      "Peach",
      "Mint",
      "Slate",
      "Sunrise",
      "Berry",
      "Night",
    ]);
  });

  it("every preset is a valid direction and two different valid hex colors", () => {
    for (const preset of GRADIENT_PRESETS) {
      expect(tokenSetSchema.shape.gradientAngle.safeParse(preset.angle).success, preset.name).toBe(
        true,
      );
      for (const color of [preset.from, preset.to]) {
        expect(
          tokenSetSchema.shape.gradientFrom.safeParse(color).success,
          `${preset.name} ${color}`,
        ).toBe(true);
        expect(color, preset.name).toMatch(/^#[0-9A-F]{6}$/);
      }
      expect(preset.from, preset.name).not.toBe(preset.to);
      // The whole edit a preset makes is accepted by the page-level overrides schema.
      expect(
        tokenOverridesSchema.safeParse({
          bgType: "gradient",
          gradientAngle: preset.angle,
          gradientFrom: preset.from,
          gradientTo: preset.to,
        }).success,
        preset.name,
      ).toBe(true);
    }
  });

  it("no two presets are the same gradient", () => {
    const keys = GRADIENT_PRESETS.map((preset) => `${preset.angle}/${preset.from}/${preset.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("M6-42 the readability check", () => {
  it("is on when the text has less than 4.5:1 contrast with either gradient color", () => {
    expect(hardToRead("#EFE8DC", ["#FFFFFF", "#16120E"])).toBe(true); // light text on a white stop
    expect(hardToRead("#EFE8DC", ["#16120E", "#FFFFFF"])).toBe(true); // ... on the last stop
    expect(hardToRead("#1A1A1A", ["#16120E", "#221B13"])).toBe(true); // dark text on dark colors
  });

  it("is off when both ratios are 4.5:1 or better", () => {
    expect(hardToRead("#EFE8DC", ["#16120E", "#221B13"])).toBe(false);
    expect(hardToRead("#000000", ["#FFFFFF", "#F0FFF4"])).toBe(false);
  });

  it("reads shorthand and alpha forms, and counts an unreadable color as readable", () => {
    expect(hardToRead("#FFF", ["#FFF"])).toBe(true);
    expect(hardToRead("#000", ["#FFFFFF80"])).toBe(false);
    expect(hardToRead("not a color", ["#FFFFFF"])).toBe(false);
    expect(hardToRead("#000000", ["red"])).toBe(false);
  });

  it("the hint is the sentence the screen shows", () => {
    expect(GRADIENT_READABILITY_HINT).toBe(
      "Your text may be hard to read on this gradient. Pick a lighter or darker color.",
    );
  });
});

describe("M6-42 the panel", () => {
  it("shows only while the background is a gradient", () => {
    expect(panel(mount({ bgType: "solid" }).host)).toBeNull();
    expect(panel(mount({ bgType: "gradient" }).host)).not.toBeNull();
  });

  it("holds the direction group, two color rows, Swap colors, eight presets and Use theme colors", () => {
    const { host } = mount({ bgType: "gradient" });
    const root = panel(host)!;
    const direction = root.querySelector('[role="group"][aria-label="Direction"]')!;
    expect(
      Array.from(direction.querySelectorAll("button")).map((b) => b.getAttribute("aria-label")),
    ).toEqual(GRADIENT_DIRECTIONS.map((d) => d.label));
    // 'Top to bottom' is pressed for a page that never set a direction.
    expect(
      Array.from(direction.querySelectorAll("button"))
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Top to bottom"]);

    expect(root.querySelector('[data-color-row="gradientFrom"]')).not.toBeNull();
    expect(root.querySelector('[data-color-row="gradientTo"]')).not.toBeNull();
    expect(root.querySelector('input[type="color"][aria-label="From color"]')).not.toBeNull();
    expect(root.querySelector('input[type="color"][aria-label="To color"]')).not.toBeNull();
    expect(byText(root, "Swap colors")).toBeDefined();
    const presets = root.querySelector('[role="group"][aria-label="Presets"]')!;
    expect(
      Array.from(presets.querySelectorAll("button")).map((b) => b.getAttribute("aria-label")),
    ).toEqual(GRADIENT_PRESETS.map((preset) => `Preset ${preset.name}`));
    expect(byText(root, "Use theme colors")).toBeDefined();
  });

  it("shows the theme's surface and background until a color is edited", () => {
    const { host } = mount({ bgType: "gradient" });
    expect(hex(host, "From hex").value).toBe(noirTokens.surface);
    expect(hex(host, "To hex").value).toBe(noirTokens.bg);
  });

  it("the hex fields are 16px, so a phone does not zoom in", () => {
    const { host } = mount({ bgType: "gradient" });
    expect(hex(host, "From hex").className).toMatch(/\btext-base\b/);
  });

  it("choosing a direction writes only the direction", () => {
    const { host, calls } = mount({ bgType: "gradient" });
    click(byLabel(host, "Left to right"));
    expect(calls).toEqual([["gradientAngle", 90]]);
    expect(byLabel(host, "Left to right").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(host, "Top to bottom").getAttribute("aria-pressed")).toBe("false");
  });

  it("choosing a preset sets the background, the direction and both colors in one go", () => {
    const { host, calls } = mount({ bgType: "solid" }, {});
    click(byText(host, "Gradient"));
    calls.length = 0;
    click(byLabel(host, "Preset Ocean"));
    expect(calls).toEqual([
      ["bgType", "gradient"],
      ["gradientAngle", 135],
      ["gradientFrom", "#0F4C81"],
      ["gradientTo", "#7FD1E8"],
    ]);
    expect(byLabel(host, "Preset Ocean").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(host, "Preset Dusk").getAttribute("aria-pressed")).toBe("false");
    expect(hex(host, "From hex").value).toBe("#0F4C81");
    expect(hex(host, "To hex").value).toBe("#7FD1E8");
  });

  it("editing From through the hex field stores uppercase #RRGGBB", () => {
    const { host, calls } = mount({ bgType: "gradient" });
    type(hex(host, "From hex"), "c46a4f");
    expect(calls).toEqual([["gradientFrom", "#C46A4F"]]);
  });

  it("a hostile or incomplete value shows the message and writes nothing", () => {
    const { host, calls } = mount({ bgType: "gradient" });
    for (const bad of [
      "#12",
      "#FFF;}</style>",
      "red",
      "url(//evil.example/x)",
      "#GGGGGG",
      "180deg; x",
    ]) {
      type(hex(host, "From hex"), bad);
      type(hex(host, "To hex"), bad);
    }
    expect(calls).toEqual([]);
    expect(host.textContent).toContain(HEX_ERROR_MESSAGE);
    expect(hex(host, "From hex").getAttribute("aria-invalid")).toBe("true");
  });

  it("whatever the panel writes is accepted by the token schema", () => {
    const { host, calls } = mount({ bgType: "gradient" });
    for (const direction of GRADIENT_DIRECTIONS) click(byLabel(host, direction.label));
    type(hex(host, "From hex"), "#abc");
    hex(host, "From hex").dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    for (const preset of GRADIENT_PRESETS) click(byLabel(host, `Preset ${preset.name}`));
    click(byText(host, "Swap colors"));
    click(byText(host, "Use theme colors"));
    const written: Record<string, unknown> = {};
    for (const [key, value] of calls) if (value !== undefined) written[key] = value;
    expect(tokenOverridesSchema.safeParse(written).success).toBe(true);
    expect(calls.length).toBeGreaterThan(20);
  });

  it("Swap colors exchanges the two colors, as the draft will store them", () => {
    const { host, calls } = mount({ bgType: "gradient" });
    click(byText(host, "Swap colors"));
    expect(calls).toEqual([
      ["gradientFrom", noirTokens.bg],
      ["gradientTo", noirTokens.surface],
    ]);
    expect(hex(host, "From hex").value).toBe(noirTokens.bg);
    expect(hex(host, "To hex").value).toBe(noirTokens.surface);
  });

  it("Use theme colors removes the three gradient settings, and is disabled when none is set", () => {
    const { host, calls, state } = mount({ bgType: "gradient" });
    expect(byText(host, "Use theme colors").disabled).toBe(true);
    click(byLabel(host, "Right to left"));
    type(hex(host, "To hex"), "#445566");
    expect(byText(host, "Use theme colors").disabled).toBe(false);
    calls.length = 0;
    click(byText(host, "Use theme colors"));
    expect(calls).toEqual([
      ["gradientAngle", undefined],
      ["gradientFrom", undefined],
      ["gradientTo", undefined],
    ]);
    expect(state.overrides).not.toHaveProperty("gradientAngle");
    expect(state.overrides).not.toHaveProperty("gradientTo");
    expect(byText(host, "Use theme colors").disabled).toBe(true);
    expect(byLabel(host, "Top to bottom").getAttribute("aria-pressed")).toBe("true");
  });

  it("the Solid and Gradient buttons keep the stored gradient settings", () => {
    const { host, state } = mount({ bgType: "gradient" });
    click(byLabel(host, "Bottom to top"));
    click(byText(host, "Solid"));
    expect(panel(host)).toBeNull();
    expect(state.overrides.gradientAngle).toBe(0);
    click(byText(host, "Gradient"));
    expect(panel(host)).not.toBeNull();
    expect(byLabel(host, "Bottom to top").getAttribute("aria-pressed")).toBe("true");
  });

  it("the readability line appears for a low-contrast color and goes when both are fine", () => {
    const { host } = mount({ bgType: "gradient" });
    const line = () => host.querySelector('[data-testid="gradient-readability"]')!;
    expect(line().textContent).toBe("");
    expect(line().getAttribute("role")).toBe("status");
    expect(line().getAttribute("aria-live")).toBe("polite");
    type(hex(host, "From hex"), "#FFFFFF");
    expect(line().textContent).toBe(GRADIENT_READABILITY_HINT);
    type(hex(host, "From hex"), "#000000");
    expect(line().textContent).toBe("");
    // The hint never blocks: every control stays enabled while it shows.
    type(hex(host, "To hex"), "#FFFFFF");
    expect(line().textContent).toBe(GRADIENT_READABILITY_HINT);
    expect(byText(host, "Swap colors").disabled).toBe(false);
  });

  it("every control is at least 44px tall on a phone", () => {
    const { host } = mount({ bgType: "gradient" });
    for (const element of Array.from(panel(host)!.querySelectorAll<HTMLElement>("button, input"))) {
      expect(element.className, element.outerHTML.slice(0, 80)).toMatch(/\b(min-h-11|size-11)\b/);
    }
  });

  it("is also reachable as a component of its own", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const calls: Call[] = [];
    act(() =>
      root.render(
        createElement(GradientPanel, {
          resolved: resolveTokens(noirTokens, { bgType: "gradient" }),
          overrides: { bgType: "gradient" },
          pageId: "00000000-0000-4000-8000-0000000000b1",
          ownerId: OWNER_UID,
          setToken: (key, value) => calls.push([key, value]),
        }),
      ),
    );
    click(byLabel(host, "Preset Night"));
    expect(calls.map(([key]) => key)).toEqual([
      "bgType",
      "gradientAngle",
      "gradientFrom",
      "gradientTo",
    ]);
    act(() => root.unmount());
    host.remove();
  });
});
