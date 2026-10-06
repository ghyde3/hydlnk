// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  createElement,
  Fragment,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignCard } from "@/components/design/design-card";
import { BackgroundSection } from "@/components/design/sections/background-section";
import { ColorSection } from "@/components/design/sections/color-section";
import { FontSection } from "@/components/design/sections/font-section";
import { ShapeSection } from "@/components/design/sections/shape-section";
import { SpacingSection } from "@/components/design/sections/spacing-section";
import { TypeSection } from "@/components/design/sections/type-section";
import type { DesignSectionProps } from "@/components/design/types";
import { resolveTokens, TOKEN_LABELS } from "@/lib/theme";
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
 * M6-47: the Design screen's five style groups, their headings and their plain words. The screen
 * itself needs a browser and a database, so the Playwright spec checks it whole; this checks what
 * the groups are made of, with every state that shows different words (a gradient, an image).
 */

const BASE = "http://127.0.0.1:54321/storage/v1/object/public/page-media";
const OWN = `${BASE}/${OWNER_UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.jpg`;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"));
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  vi.unstubAllEnvs();
});

function props(overrides: Parameters<typeof resolveTokens>[1] = {}): DesignSectionProps {
  return {
    resolved: resolveTokens(noirTokens, overrides),
    overrides: overrides ?? {},
    setToken: () => {},
    pageId: "00000000-0000-4000-8000-0000000000b1",
    ownerId: OWNER_UID,
  };
}

/** The five cards, built the way design-screen.tsx builds them. */
/** `DesignCard` with its children passed the createElement way (as arguments, not as a prop). */
const Card = DesignCard as unknown as ComponentType<{
  section: ComponentProps<typeof DesignCard>["section"];
  title: string;
}>;

function screen(p: DesignSectionProps) {
  const card = (
    section: ComponentProps<typeof DesignCard>["section"],
    title: string,
    ...parts: ReactNode[]
  ) => createElement(Card, { section, title }, ...parts);
  return createElement(
    Fragment,
    null,
    card("color", "Colors", createElement(ColorSection, p)),
    card("fonts", "Fonts", createElement(FontSection, p), createElement(TypeSection, p)),
    card("buttons", "Buttons", createElement(ShapeSection, p)),
    card("layout", "Layout", createElement(SpacingSection, p)),
    card("background", "Background", createElement(BackgroundSection, p)),
  );
}

function mount(p: DesignSectionProps): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(screen(p)));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** Every string a person can see or hear in `host`: text, aria-label, title, alt, placeholder. */
function words(host: HTMLElement): string[] {
  const out: string[] = [host.textContent ?? ""];
  for (const element of Array.from(host.querySelectorAll("*"))) {
    for (const attribute of ["aria-label", "title", "alt", "placeholder"]) {
      const value = element.getAttribute(attribute);
      if (value) out.push(value);
    }
  }
  return out;
}

const STATES: [string, Parameters<typeof resolveTokens>[1]][] = [
  ["a solid page", { bgType: "solid" }],
  ["a gradient page", { bgType: "gradient" }],
  ["a gradient page with colors of its own", { bgType: "gradient", gradientFrom: "#C46A4F" }],
  [
    "a page with a background image",
    { bgType: "image", bgImage: OWN, overlayOpacity: 0.4, blur: 6 },
  ],
];

describe("M6-47 no jargon", () => {
  it.each(STATES)("%s shows no token, no override and no raw key", (_name, overrides) => {
    const host = mount(props(overrides));
    for (const text of words(host)) {
      expect(text, text.slice(0, 60)).not.toMatch(/token/i);
      expect(text, text.slice(0, 60)).not.toMatch(/override/i);
      expect(text, text.slice(0, 60)).not.toMatch(
        /\b(bg|textMuted|buttonBg|buttonText|borderWidth|weightHeading|letterCase|maxWidth|overlayOpacity|bgType|bgImage|fontHeading|fontBody|gradientAngle|gradientFrom|gradientTo)\b/,
      );
    }
  });

  it("the old control names are gone", () => {
    const host = mount(props({ bgType: "image", bgImage: OWN }));
    const text = words(host).join("\n");
    for (const old of [
      "Border width",
      "Content width",
      "Heading weight",
      "Letter case",
      "Spacing",
      "Alignment",
    ]) {
      expect(text, old).not.toContain(old);
    }
    expect(host.querySelector('[role="group"][aria-label="Overlay"]')).toBeNull();
    expect(Array.from(host.querySelectorAll("label")).map((label) => label.textContent)).toEqual(
      expect.arrayContaining(["Image overlay", "Image blur"]),
    );
  });
});

describe("M6-47 the five groups", () => {
  it("are sections in order, each named by its h2 through aria-labelledby", () => {
    const host = mount(props());
    const cards = Array.from(host.querySelectorAll<HTMLElement>("[data-design-section]"));
    expect(cards.map((card) => card.getAttribute("data-design-section"))).toEqual([
      "color",
      "fonts",
      "buttons",
      "layout",
      "background",
    ]);
    expect(cards.map((card) => card.tagName)).toEqual(Array(5).fill("SECTION"));
    const titles = cards.map((card) => {
      const heading = card.querySelector(`#${CSS.escape(card.getAttribute("aria-labelledby")!)}`)!;
      expect(heading.tagName).toBe("H2");
      expect(card.querySelectorAll("h2")).toHaveLength(1);
      return heading.textContent;
    });
    expect(titles).toEqual(["Colors", "Fonts", "Buttons", "Layout", "Background"]);
  });

  it("headings run h2, h3 with no level skipped, and no group heading is an h2", () => {
    const host = mount(props({ bgType: "gradient" }));
    const levels = Array.from(host.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((heading) =>
      Number(heading.tagName[1]),
    );
    let previous = 1; // the page's h1
    for (const level of levels) {
      expect(level - previous, levels.join(",")).toBeLessThanOrEqual(1);
      previous = level;
    }
    expect(levels.filter((level) => level === 2)).toHaveLength(5);
    expect(levels.some((level) => level > 3)).toBe(false);
  });

  it("holds the groups and options the spec names", () => {
    const host = mount(props());
    const group = (name: string) =>
      Array.from(host.querySelectorAll(`[role="group"][aria-label="${name}"] button`)).map(
        (button) => button.textContent,
      );
    expect(group("Text size")).toEqual(["0.9×", "1×", "1.1×", "1.2×"]);
    expect(group("Heading boldness")).toEqual(["Regular"]); // Instrument Serif ships one weight
    expect(group("Capital letters")).toEqual(["Normal", "Uppercase", "Lowercase"]);
    expect(group("Button style")).toEqual(["Fill", "Outline", "Soft", "Shadow", "Pill"]);
    expect(group("Corner radius")).toEqual(["0px", "4px", "12px", "20px"]);
    expect(group("Border thickness")).toEqual(["0px", "1px", "2px"]);
    expect(group("Space between blocks")).toEqual(["Compact", "Regular", "Airy"]);
    expect(group("Page width")).toEqual(["480", "560", "640"]);
    expect(group("Text alignment")).toEqual(["Center", "Left"]);
    expect(group("Background")).toEqual(["Solid", "Gradient", "Image…"]);
    expect(host.textContent).toContain(
      "Corners and borders also apply to cards, images and embeds.",
    );
    expect(
      Array.from(host.querySelectorAll("[data-font-picker]")).map((picker) =>
        picker.getAttribute("data-font-picker"),
      ),
    ).toEqual(["Heading font", "Body font"]);
  });

  it("the Colors group has six accent swatches and eight rows in the old order, named in plain words", () => {
    const host = mount(props());
    expect(
      Array.from(host.querySelectorAll('button[aria-pressed][aria-label^="Accent "]')).map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Accent Brass",
      "Accent Terracotta",
      "Accent Sage",
      "Accent Steel",
      "Accent Bone",
      "Accent Ink",
    ]);
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-color-row]"));
    const keys = [
      "bg",
      "surface",
      "text",
      "textMuted",
      "accent",
      "buttonBg",
      "buttonText",
      "border",
    ];
    expect(rows.map((row) => row.getAttribute("data-color-row"))).toEqual(keys);
    expect(rows.map((row) => row.querySelector("span")!.textContent)).toEqual(
      keys.map((key) => TOKEN_LABELS[key as keyof typeof TOKEN_LABELS]),
    );
    for (const key of keys) {
      const name = TOKEN_LABELS[key as keyof typeof TOKEN_LABELS];
      expect(
        host.querySelector(`button[type="button"][aria-label="${name} color"]`),
        name,
      ).not.toBeNull();
      expect(
        host.querySelector(`input[type="text"][aria-label="${name} hex"]`),
        name,
      ).not.toBeNull();
    }
  });

  it("the screen builds exactly these five cards, in this order", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/design/design-screen.tsx"),
      "utf8",
    );
    const cards = [...source.matchAll(/<DesignCard section="(\w+)" title="([^"]+)"/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(cards).toEqual([
      ["color", "Colors"],
      ["fonts", "Fonts"],
      ["buttons", "Buttons"],
      ["layout", "Layout"],
      ["background", "Background"],
    ]);
    expect(source).not.toContain('data-design-section="style"');
    expect(source).not.toMatch(/<Card\b/);
  });

  it("the preview says a block's own style still wins", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-preview.tsx"),
      "utf8",
    );
    expect(source).toContain("A block’s own style still wins");
    expect(source).not.toContain("Block overrides still win");
  });
});
