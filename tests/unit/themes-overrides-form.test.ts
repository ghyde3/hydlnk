// @vitest-environment jsdom
import { act, createElement, useState, type FunctionComponent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockDefaults, type Block, type CardBlock, type ImageRef, type LinkBlock } from "@/lib/document";
import { BLOCK_FORMS } from "@/components/blocks/forms";
import { PageTokensProvider } from "@/components/themes/page-tokens-context";
import { SYSTEM_DEFAULT_TOKENS, type TokenSet } from "@/lib/theme";

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

/** The form of `initial` inside a stateful harness (like the editor panel), optionally with page tokens. */
function mount(initial: Block, tokens = true) {
  const latest = { block: initial };
  function Harness() {
    const [block, setBlock] = useState<Block>(initial);
    latest.block = block;
    const Form = BLOCK_FORMS[block.type];
    const form = createElement(Form, {
      block,
      errors: [],
      onChange: (next: Block) => setBlock(next),
      onImage: (image: ImageRef | null) =>
        setBlock((current) =>
          current.type === "card" || current.type === "image" ? { ...current, image } : current,
        ),
    });
    return tokens
      ? createElement(
          // `createElement` cannot see that the third argument is the provider's children.
          PageTokensProvider as unknown as FunctionComponent<{ tokens: TokenSet }>,
          { tokens: { ...SYSTEM_DEFAULT_TOKENS, buttonStyle: "outline" as const } },
          form,
        )
      : form;
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
  host.querySelector<T>(`[data-field="${name}"]`)!;
const labels = (host: HTMLElement) =>
  Array.from(host.querySelectorAll("label")).map((label) => label.textContent?.trim());
const optionsOf = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.textContent);

const link = (): LinkBlock => blockDefaults.link() as LinkBlock;
const card = (): CardBlock => blockDefaults.card() as CardBlock;

describe("M3-17 button style override", () => {
  it("a link block shows a 'Button style' select: Theme default (Outline), Fill, Outline, Soft, Shadow, Pill", () => {
    const { host } = mount(link());
    const select = field<HTMLSelectElement>(host, "override-button-style");
    expect(labels(host)).toContain("Button style");
    expect(optionsOf(select)).toEqual(["Theme default (Outline)", "Fill", "Outline", "Soft", "Shadow", "Pill"]);
    expect(select.value).toBe("");
  });

  it("says plain 'Theme default' when the page tokens are not provided", () => {
    const { host } = mount(link(), false);
    expect(optionsOf(field<HTMLSelectElement>(host, "override-button-style"))[0]).toBe("Theme default");
  });

  it("choosing Fill sets overrides.buttonStyle; Theme default removes it, and the empty overrides with it", () => {
    const { host, latest } = mount(link());
    const select = field<HTMLSelectElement>(host, "override-button-style");
    choose(select, "fill");
    expect((latest.block as LinkBlock).overrides).toEqual({ buttonStyle: "fill" });
    choose(select, "");
    expect("overrides" in latest.block).toBe(false);
  });

  it("a card has no button style control, and no block type but link and card has any override control", () => {
    expect(labels(mount(card()).host)).not.toContain("Button style");
    for (const type of ["header", "text", "image", "social", "embed", "grid", "divider"] as const) {
      const { host } = mount(blockDefaults[type]());
      expect(host.querySelector('[data-testid="override-controls"]'), type).toBeNull();
    }
  });

  it("renders no Schedule field (scheduled links are out of v1)", () => {
    const { host } = mount(link());
    expect(host.textContent).not.toMatch(/schedule/i);
  });
});

describe("M3-18 color and corner radius overrides", () => {
  it("link and card show a Color control (swatch plus a 16px hex field) and a Corner radius select (Theme default, 0, 4, 12, 20)", () => {
    for (const block of [link(), card()]) {
      const { host } = mount(block);
      expect(labels(host)).toEqual(expect.arrayContaining(["Color", "Corner radius"]));
      expect(host.querySelector('input[type="color"]')).not.toBeNull();
      const hex = field<HTMLInputElement>(host, "override-color");
      expect(hex.className).toContain("text-base"); // 16px, so iOS does not zoom
      expect(optionsOf(field<HTMLSelectElement>(host, "override-radius"))).toEqual(["Theme default", "0", "4", "12", "20"]);
    }
  });

  it("exactly three override controls on a link, two on a card, and none for font, spacing or background", () => {
    const linkHost = mount(link()).host.querySelector('[data-testid="override-controls"]')!;
    expect(linkHost.querySelectorAll("select")).toHaveLength(2); // style, radius
    expect(linkHost.querySelectorAll('input[type="text"]')).toHaveLength(1); // the hex field
    expect(linkHost.textContent).not.toMatch(/font|spacing|density|background/i);
    const cardHost = mount(card()).host.querySelector('[data-testid="override-controls"]')!;
    expect(cardHost.querySelectorAll("select")).toHaveLength(1);
  });

  it("a complete hex writes the colour group; a half-typed one writes nothing", () => {
    const initial = link();
    const { host, latest } = mount(initial);
    const hex = field<HTMLInputElement>(host, "override-color");
    type(hex, "#C46");
    expect(latest.block).toBe(initial);
    expect(host.textContent).toContain("Use a #RRGGBB colour");
    type(hex, "#c46a4f");
    expect((latest.block as LinkBlock).overrides).toEqual({
      buttonBg: "#C46A4F",
      accent: "#C46A4F",
      buttonText: "#F7F3EC",
    });
  });

  it("a light colour gets the dark ink", () => {
    const { host, latest } = mount(link());
    type(field<HTMLInputElement>(host, "override-color"), "#E8E1D3");
    expect((latest.block as LinkBlock).overrides?.buttonText).toBe("#15110B");
  });

  it("Theme default clears only the colour keys, leaving the other overrides", () => {
    const { host, latest } = mount({ ...link(), overrides: { buttonStyle: "pill", radius: 0, buttonBg: "#C46A4F", accent: "#C46A4F", buttonText: "#F7F3EC" } });
    const reset = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Theme default")!;
    act(() => reset.click());
    expect((latest.block as LinkBlock).overrides).toEqual({ buttonStyle: "pill", radius: 0 });
  });

  it("Radius 0 is stored as 0 (not dropped); Theme default removes it", () => {
    const { host, latest } = mount(card());
    const select = field<HTMLSelectElement>(host, "override-radius");
    choose(select, "0");
    expect((latest.block as CardBlock).overrides).toEqual({ radius: 0 });
    choose(select, "");
    expect("overrides" in latest.block).toBe(false);
  });

  it("a stored radius the list does not offer is still shown", () => {
    const { host } = mount({ ...card(), overrides: { radius: 8 } });
    const select = field<HTMLSelectElement>(host, "override-radius");
    expect(select.value).toBe("8");
  });

  it("shows Publish messages for the override fields", () => {
    const block = { ...link(), overrides: { radius: -5 } } as LinkBlock;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const Form = BLOCK_FORMS.link;
    act(() =>
      root.render(
        createElement(Form, {
          block,
          errors: [{ blockId: block.id, field: "overrides.radius", message: "Corner radius isn’t valid." }],
          onChange: () => undefined,
          onImage: () => undefined,
        }),
      ),
    );
    expect(host.textContent).toContain("Corner radius isn’t valid.");
    cleanups.push(() => {
      act(() => root.unmount());
      host.remove();
    });
  });
});
