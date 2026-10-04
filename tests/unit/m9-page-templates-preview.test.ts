// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PREVIEW_HEIGHT,
  PREVIEW_PAGE_WIDTH,
  TemplatePreview,
} from "@/components/templates/template-preview";
import * as barrel from "@/components/templates";
import { emptyDraft, type DraftDoc } from "@/lib/document";
import { TEMPLATES } from "@/lib/templates";
import { photoRef } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M9-33 (Gary's decision closing the held M7-07): the template picker's live preview starts at the
 * very top of the page, so the profile photo and the display name are visible, followed by the
 * first block, in a window 300px tall (it was 190). The offset code is gone.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/components/templates/template-preview.tsx"),
  "utf8",
);
const profile = (over: Partial<DraftDoc["profile"]> = {}): DraftDoc["profile"] => ({
  ...emptyDraft("mara").profile,
  name: "Mara Okafor",
  photo: photoRef,
  ...over,
});

describe("M9-33 the offset code is deleted", () => {
  it.each([
    "PREVIEW_LEAD",
    "data-profile-part",
    "translateY",
    "getBoundingClientRect",
    "setOffset",
    "offset",
  ])("the preview module holds no %s", (word) => {
    expect(SOURCE).not.toContain(word);
  });

  it("no other module of the templates folder uses them, and the barrel no longer exports PREVIEW_LEAD", () => {
    expect("PREVIEW_LEAD" in barrel).toBe(false);
    for (const file of [
      "template-dialog.tsx",
      "template-choice.tsx",
      "start-from-template.tsx",
      "index.ts",
    ]) {
      expect(
        readFileSync(join(process.cwd(), "src/components/templates", file), "utf8"),
      ).not.toContain("PREVIEW_LEAD");
    }
  });

  it("the window is 300px tall (it was 190), laid out at phone width", () => {
    expect(PREVIEW_HEIGHT).toBe(300);
    expect(PREVIEW_PAGE_WIDTH).toBe(390);
    expect(barrel.PREVIEW_HEIGHT).toBe(300);
  });
});

describe("M9-33 what the card draws", () => {
  const draw = (template = TEMPLATES[0]!, p = profile()) =>
    renderToStaticMarkup(
      createElement(TemplatePreview, { template, profile: p, themeTokens: null }),
    );

  it("a box of the final height, inert and hidden from assistive technology, with no tab stop", () => {
    const html = draw();
    const box = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector<HTMLElement>("[data-testid=template-preview]")!;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.hasAttribute("inert")).toBe(true);
    expect(box.style.height).toBe("300px");
    expect(box.querySelector("[tabindex]")).toBeNull();
  });

  it("the page inside starts at its top: no translate, only the scale", () => {
    const html = draw();
    const frame = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector<HTMLElement>("[data-testid=template-preview-page]")!;
    expect(frame.style.transform).toMatch(/^scale\(/);
    expect(frame.style.transform).not.toContain("translate");
    expect(frame.style.width).toBe("390px");
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    "%s: the person's photo and display name come before the template's first block, in the page's own order",
    (_id, template) => {
      const doc = new DOMParser().parseFromString(draw(template), "text/html");
      const root = doc.querySelector("[data-page-root]")!;
      const avatar = root.querySelector('[data-profile-part="avatar"]')!;
      const name = root.querySelector('[data-profile-part="name"]')!;
      const firstBlock = root.querySelector("main > *")!;
      expect(avatar).not.toBeNull();
      expect(name.textContent).toBe("Mara Okafor");
      const order = (a: Element, b: Element) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(order(avatar, name)).toBeTruthy();
      expect(order(name, firstBlock)).toBeTruthy();
      // The preview is a thumbnail: nothing in it is a link.
      expect(root.querySelectorAll("a[href]")).toHaveLength(0);
    },
  );

  it("with the photo, the name and the bio off the window still starts at the page top and shows what remains", () => {
    const html = draw(
      TEMPLATES[0]!,
      profile({ showPhoto: false, showName: false, showBio: false }),
    );
    const root = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("[data-page-root]")!;
    expect(root.querySelector('[data-profile-part="avatar"]')).toBeNull();
    expect(root.querySelector("header")).toBeNull();
    expect(root.querySelector("main > *")).not.toBeNull();
    const only = draw(TEMPLATES[0]!, profile({ showName: false }));
    expect(
      new DOMParser()
        .parseFromString(only, "text/html")
        .querySelector('[data-profile-part="avatar"]'),
    ).not.toBeNull();
  });

  it("a 60-character name and an empty one draw without throwing", () => {
    expect(draw(TEMPLATES[1]!, profile({ name: "N".repeat(60) }))).toContain("N".repeat(60));
    expect(() => draw(TEMPLATES[1]!, profile({ name: "" }))).not.toThrow();
  });

  it("draws the person's logo and name style too (the profile is theirs, as applying would give)", () => {
    const html = draw(TEMPLATES[0]!, profile({ nameSize: "xlarge", nameFont: "Lora" }));
    expect(html).toContain("pg-name-xl");
  });
});
