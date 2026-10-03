// @vitest-environment jsdom
import { act, createElement, useState, type FunctionComponent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BLOCK_TYPES,
  blockDefaults,
  type Block,
  type BlockType,
  type ImageRef,
  type PublishError,
} from "@/lib/document";
import { BLOCK_FORMS } from "@/components/blocks/forms";
import { PageTokensProvider } from "@/components/themes/page-tokens-context";
import { SYSTEM_DEFAULT_TOKENS, blockOverridesSchema, type TokenSet } from "@/lib/theme";
import { friendlyPublishErrors } from "@/lib/themes";

/**
 * M6-46: the style controls in every block's edit panel. Each type shows its own controls in a
 * group headed "Style this block", under the block's own fields; a color control is a swatch, a
 * 16px hex field and a Theme default button; the selects offer Theme default and the short lists;
 * a half-typed or hostile hex shows the message and writes nothing; a stored off-list value is an
 * extra option. The model is in m6-block-style-model.test.ts, the browser flows in
 * tests/e2e/m6/block-style-editor.spec.ts.
 */

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

const COLOR = "#C46A4F";
const GROUP_LINE = "Only this block. Leave on Theme default to follow your page style.";

function mount(initial: Block, errors: PublishError[] = []) {
  const latest: { block: Block; writes: Block[] } = { block: initial, writes: [] };
  function Harness() {
    const [block, setBlock] = useState<Block>(initial);
    latest.block = block;
    const Form = BLOCK_FORMS[block.type];
    const form = createElement(Form, {
      block,
      errors,
      onChange: (next: Block) => {
        latest.writes.push(next);
        setBlock(next);
      },
      onImage: (image: ImageRef | null) =>
        setBlock((current) =>
          current.type === "card" || current.type === "image" ? { ...current, image } : current,
        ),
    });
    return createElement(
      PageTokensProvider as unknown as FunctionComponent<{ tokens: TokenSet }>,
      { tokens: { ...SYSTEM_DEFAULT_TOKENS, buttonStyle: "outline" as const } },
      form,
    );
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, latest };
}

function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const field = <T extends HTMLElement>(host: HTMLElement, name: string) =>
  host.querySelector<T>(`[data-field="${name}"]`);
const group = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-testid="override-controls"]');
/** The labels inside the style group, in order. */
const styleLabels = (host: HTMLElement) =>
  Array.from(group(host)!.querySelectorAll("label")).map((label) => label.textContent?.trim());
const optionsOf = (select: HTMLSelectElement) =>
  Array.from(select.options).map((option) => option.textContent);
const overridesOf = (block: Block) => (block as { overrides?: unknown }).overrides;
const themeDefaultButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Theme default");

const EXPECTED: Record<BlockType, string[]> = {
  link: ["Button style", "Color", "Corner radius"],
  card: ["Color", "Corner radius"],
  header: ["Text color"],
  text: ["Text color"],
  image: ["Corner radius", "Border thickness", "Border color"],
  embed: ["Corner radius", "Border thickness", "Border color"],
  grid: ["Color", "Corner radius", "Border thickness"],
  social: ["Icon color"],
  divider: ["Line color"],
};

describe("M6-46 every block type has a 'Style this block' group", () => {
  it.each(BLOCK_TYPES.map((t) => [t]))("%s: the group, its line and its controls", (blockType) => {
    const { host } = mount(blockDefaults[blockType]());
    const g = group(host);
    expect(g, blockType).not.toBeNull();
    // A labeled section (a region), not role=group: social and grid panels count their own groups.
    expect(g!.tagName).toBe("SECTION");
    expect(g!.getAttribute("role")).toBeNull();
    const heading = g!.querySelector(`#${CSS.escape(g!.getAttribute("aria-labelledby")!)}`);
    expect(heading?.textContent).toBe("Style this block");
    expect(g!.textContent).toContain(GROUP_LINE);
    expect(styleLabels(host), blockType).toEqual(EXPECTED[blockType]);
  });

  it.each(BLOCK_TYPES.map((t) => [t]))(
    "%s: the group sits after the block's own fields, and no font, spacing, background or Pro control is anywhere",
    (blockType) => {
      const { host } = mount(blockDefaults[blockType]());
      const g = group(host)!;
      // Everything else in the form comes before the group.
      const before = Array.from(host.querySelectorAll("input, select, textarea, button")).filter(
        (el) => !g.contains(el),
      );
      for (const el of before) {
        expect(
          g.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING,
          `${blockType}: ${el.tagName}`,
        ).toBeTruthy();
      }
      expect(host.textContent).not.toMatch(/\b(font|spacing|background|gap)\b/i);
      expect(g.textContent).not.toMatch(/\bPro\b|Studio|Upgrade/);
    },
  );

  it("a color control is a swatch, a 16px hex field and, once set, a Theme default button", () => {
    for (const blockType of BLOCK_TYPES) {
      const { host } = mount(blockDefaults[blockType]());
      expect(host.querySelector('input[type="color"]'), blockType).not.toBeNull();
      const hex = field<HTMLInputElement>(host, "override-color")!;
      expect(hex.className, blockType).toContain("text-base"); // 16px, so iOS does not zoom
      expect(hex.maxLength).toBe(7);
      expect(themeDefaultButton(host), blockType).toBeUndefined();
      type(hex, COLOR);
      expect(themeDefaultButton(host), blockType).toBeDefined();
    }
  });

  it("the selects offer Theme default and the short lists", () => {
    const radius = field<HTMLSelectElement>(mount(blockDefaults.image()).host, "override-radius")!;
    expect(optionsOf(radius)).toEqual(["Theme default", "0", "4", "12", "20"]);
    const thickness = field<HTMLSelectElement>(
      mount(blockDefaults.grid()).host,
      "override-border-width",
    )!;
    expect(optionsOf(thickness)).toEqual(["Theme default", "0", "1", "2"]);
    const style = field<HTMLSelectElement>(
      mount(blockDefaults.link()).host,
      "override-button-style",
    )!;
    expect(optionsOf(style)).toEqual([
      "Theme default (Outline)",
      "Fill",
      "Outline",
      "Soft",
      "Shadow",
      "Pill",
    ]);
  });
});

describe("M6-46 the header's text color", () => {
  it("setting a color writes only the text key; Theme default removes it, and the property with it", () => {
    const { host, latest } = mount(blockDefaults.header());
    const hex = field<HTMLInputElement>(host, "override-color")!;
    type(hex, COLOR);
    expect(overridesOf(latest.block)).toEqual({ text: COLOR });
    act(() => themeDefaultButton(host)!.click());
    expect(latest.block).not.toHaveProperty("overrides");
  });

  it("clearing the hex field removes the setting", () => {
    const { host, latest } = mount(blockDefaults.header());
    const hex = field<HTMLInputElement>(host, "override-color")!;
    type(hex, COLOR);
    type(hex, "");
    expect(latest.block).not.toHaveProperty("overrides");
  });

  it("accepts the hex with or without the #, in any case, and stores #RRGGBB uppercase", () => {
    const { host, latest } = mount(blockDefaults.header());
    type(field<HTMLInputElement>(host, "override-color")!, "c46a4f");
    expect(overridesOf(latest.block)).toEqual({ text: COLOR });
  });
});

describe("M6-46 a half-typed or hostile hex writes nothing", () => {
  const MESSAGE = "Use a #RRGGBB color, for example #C46A4F.";

  it.each([["#12"], ["#C46A4"], ["red"], ["#FFF;}</style>"], ["#GGGGGG"], ["javascript:alert(1)"]])(
    "typing %s shows the message and writes nothing",
    (bad) => {
      const { host, latest } = mount(blockDefaults.divider());
      const hex = field<HTMLInputElement>(host, "override-color")!;
      type(hex, bad);
      expect(host.textContent).toContain(MESSAGE);
      expect(latest.writes).toHaveLength(0);
      expect(latest.block).not.toHaveProperty("overrides");
      expect(hex.getAttribute("aria-invalid")).toBe("true");
    },
  );

  it("keeps the last valid value when a later half-typed one is left", () => {
    const { host, latest } = mount(blockDefaults.divider());
    const hex = field<HTMLInputElement>(host, "override-color")!;
    type(hex, COLOR);
    type(hex, "#12");
    expect(host.textContent).toContain(MESSAGE);
    expect(overridesOf(latest.block)).toEqual({ border: COLOR });
    act(() => hex.blur());
    expect(field<HTMLInputElement>(host, "override-color")!.value).toBe(COLOR);
    expect(host.textContent).not.toContain(MESSAGE);
  });

  it("nothing written ever fails the block schema, whatever is typed", () => {
    for (const blockType of BLOCK_TYPES) {
      const { host, latest } = mount(blockDefaults[blockType]());
      const hex = field<HTMLInputElement>(host, "override-color")!;
      for (const text of [
        "#",
        "#C",
        "#C46A4F",
        "#C46A4",
        "<script>",
        "#FFF;}</style>",
        "#00ff00",
      ]) {
        type(hex, text);
        const overrides = overridesOf(latest.block);
        if (overrides !== undefined) {
          expect(blockOverridesSchema.safeParse(overrides).success, `${blockType} ${text}`).toBe(
            true,
          );
        }
      }
      for (const write of latest.writes) {
        const overrides = overridesOf(write);
        if (overrides !== undefined) {
          expect(blockOverridesSchema.safeParse(overrides).success, blockType).toBe(true);
        }
      }
    }
  });
});

describe("M6-46 image, embed and grid shape controls", () => {
  it("an image: radius 20, thickness 2 and a border color write exactly those keys", () => {
    const { host, latest } = mount(blockDefaults.image());
    choose(field<HTMLSelectElement>(host, "override-radius")!, "20");
    choose(field<HTMLSelectElement>(host, "override-border-width")!, "2");
    type(field<HTMLInputElement>(host, "override-color")!, COLOR);
    expect(overridesOf(latest.block)).toEqual({ radius: 20, borderWidth: 2, border: COLOR });
  });

  it("Theme default on a select removes that one setting, and the last one removes the property", () => {
    const { host, latest } = mount(blockDefaults.embed());
    choose(field<HTMLSelectElement>(host, "override-radius")!, "4");
    choose(field<HTMLSelectElement>(host, "override-border-width")!, "1");
    expect(overridesOf(latest.block)).toEqual({ radius: 4, borderWidth: 1 });
    choose(field<HTMLSelectElement>(host, "override-radius")!, "");
    expect(overridesOf(latest.block)).toEqual({ borderWidth: 1 });
    choose(field<HTMLSelectElement>(host, "override-border-width")!, "");
    expect(latest.block).not.toHaveProperty("overrides");
  });

  it("a grid: color writes the cells' border and title color; thickness and radius are separate", () => {
    const { host, latest } = mount(blockDefaults.grid());
    type(field<HTMLInputElement>(host, "override-color")!, COLOR);
    expect(overridesOf(latest.block)).toEqual({ border: COLOR, text: COLOR });
    choose(field<HTMLSelectElement>(host, "override-border-width")!, "2");
    choose(field<HTMLSelectElement>(host, "override-radius")!, "12");
    expect(overridesOf(latest.block)).toEqual({
      border: COLOR,
      text: COLOR,
      borderWidth: 2,
      radius: 12,
    });
  });

  it("a stored radius or thickness the lists do not offer appears as an extra option, selected", () => {
    const image = {
      ...blockDefaults.image(),
      overrides: { radius: 8, borderWidth: 3 },
    } as Block;
    const { host } = mount(image);
    const radius = field<HTMLSelectElement>(host, "override-radius")!;
    const thickness = field<HTMLSelectElement>(host, "override-border-width")!;
    expect(optionsOf(radius)).toEqual(["Theme default", "0", "4", "12", "20", "8"]);
    expect(radius.value).toBe("8");
    expect(optionsOf(thickness)).toEqual(["Theme default", "0", "1", "2", "3"]);
    expect(thickness.value).toBe("3");
    // A listed value is never duplicated.
    const listed = { ...blockDefaults.image(), overrides: { radius: 12, borderWidth: 1 } } as Block;
    const again = mount(listed).host;
    expect(optionsOf(field<HTMLSelectElement>(again, "override-radius")!)).toHaveLength(5);
    expect(optionsOf(field<HTMLSelectElement>(again, "override-border-width")!)).toHaveLength(4);
  });

  it("a stored override shows in its controls: the hex, the selects, and the reset button", () => {
    const stored = {
      ...blockDefaults.social(),
      overrides: { text: COLOR, border: COLOR },
    } as Block;
    const { host } = mount(stored);
    expect(field<HTMLInputElement>(host, "override-color")!.value).toBe(COLOR);
    expect(themeDefaultButton(host)).toBeDefined();
  });
});

describe("M6-46 the Publish gate's messages show in the control", () => {
  const error = (blockId: string, field: string, message: string): PublishError => ({
    blockId,
    field,
    message,
  });

  it("a refused thickness, radius and color each show the gate's sentence in their own control", () => {
    const image = {
      ...blockDefaults.image(),
      overrides: { borderWidth: 99, radius: -5 },
    } as Block;
    const errors = friendlyPublishErrors([
      error(image.id, "overrides.borderWidth", "x"),
      error(image.id, "overrides.radius", "x"),
      error(image.id, "overrides.border", "x"),
    ]);
    const { host } = mount(image, errors);
    const text = host.textContent ?? "";
    expect(text).toContain(
      "Border thickness isn’t valid. Use 0 to 4, or reset it to the theme default.",
    );
    expect(text).toContain(
      "Corner radius isn’t valid. Use 0 to 32, or reset it to the theme default.",
    );
    expect(text).toContain(
      "Color isn’t a valid hex color. Use #RRGGBB, or reset it to the theme default.",
    );
  });

  it("a color error on any key the control owns shows in it (a grid's text, a social block's border)", () => {
    for (const [blockType, key] of [
      ["grid", "text"],
      ["social", "border"],
      ["header", "text"],
      ["text", "textMuted"],
    ] as const) {
      const block = blockDefaults[blockType]();
      const errors = friendlyPublishErrors([error(block.id, `overrides.${key}`, "x")]);
      const { host } = mount(block, errors);
      expect(host.textContent, blockType).toContain("Color isn’t a valid hex color.");
    }
  });
});
