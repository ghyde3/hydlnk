// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import {
  IMAGE_SHAPES,
  draftDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { blocks, noirTokens } from "./fixtures/page-document";

/**
 * M6-23 renderer: the shaped frame, the focus as `object-position`, the same markup in the editor
 * preview and on the live page, and the static rules that keep tenant strings out of `style`.
 */

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

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";

function pageOf(...docBlocks: Block[]): PublishDoc {
  return {
    version: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens: noirTokens,
    blocks: docBlocks,
  };
}

function render(doc: PublishDoc, mode: "live" | "preview"): Document {
  const html = renderToStaticMarkup(createElement(PageRenderer, { doc, pageId: PAGE_ID, mode }));
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

/** A block's markup in a rendered page, found by its id. */
function blockOf(dom: Document, id: string): HTMLElement {
  const el = dom.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  if (!el) throw new Error(`no block ${id}`);
  return el;
}

const image = (extra: Record<string, unknown> = {}, ref: Record<string, unknown> = {}) =>
  ({ ...blocks.image, image: { ...blocks.image.image, ...ref }, ...extra }) as unknown as Block;
const card = (ref: Record<string, unknown> = {}) =>
  ({ ...blocks.card, image: { ...blocks.card.image, ...ref } }) as unknown as Block;

const imgOf = (el: HTMLElement) => el.querySelector("img")!;

describe("M6-23 the image block's shaped frame", () => {
  it.each(IMAGE_SHAPES)("a %s image sits in a frame that holds the picture", (shape) => {
    const el = blockOf(render(pageOf(image({ shape, url: undefined })), "live"), blocks.image.id);
    const frame = el.querySelector<HTMLElement>(".pg-image-frame")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("data-shape")).toBe(shape);
    expect(frame.parentElement).toBe(el);
    expect(imgOf(frame).classList.contains("pg-image-img")).toBe(true);
    // The picture still carries its real size, for the browser's own layout hints.
    expect(imgOf(frame).getAttribute("width")).toBe(String(blocks.image.image.width));
    expect(imgOf(frame).getAttribute("height")).toBe(String(blocks.image.image.height));
  });

  it("an anchor still wraps the frame when the block has a link", () => {
    const el = blockOf(render(pageOf(image({ shape: "wide" })), "live"), blocks.image.id);
    const anchor = el.querySelector("a.pg-image-link")!;
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute("href")).toBe(`/r/${PAGE_ID}/${blocks.image.id}`);
    expect(anchor.firstElementChild?.classList.contains("pg-image-frame")).toBe(true);
    expect(anchor.querySelectorAll("img")).toHaveLength(1);
  });

  it("the original shape (no shape) is drawn as before: no frame, no style", () => {
    const el = blockOf(render(pageOf(image({ url: undefined })), "live"), blocks.image.id);
    expect(el.querySelector(".pg-image-frame")).toBeNull();
    expect(imgOf(el).hasAttribute("style")).toBe(false);
    expect(el.hasAttribute("data-shape")).toBe(false);
  });

  it("with the original shape a focus has no effect: the markup is the same as without one", () => {
    const withFocus = render(pageOf(image({ url: undefined }, { focus: { x: 0, y: 0 } })), "live");
    const without = render(pageOf(image({ url: undefined })), "live");
    expect(blockOf(withFocus, blocks.image.id).outerHTML).toBe(
      blockOf(without, blocks.image.id).outerHTML,
    );
  });

  it("a shaped image with a focus carries object-position built from the two numbers", () => {
    const el = blockOf(
      render(pageOf(image({ shape: "wide" }, { focus: { x: 0, y: 0.5 } })), "live"),
      blocks.image.id,
    );
    expect(imgOf(el).getAttribute("style")).toBe("object-position:0% 50%");
    const el2 = blockOf(
      render(pageOf(image({ shape: "square" }, { focus: { x: 1, y: 0.5 } })), "live"),
      blocks.image.id,
    );
    expect(imgOf(el2).getAttribute("style")).toBe("object-position:100% 50%");
    const el3 = blockOf(
      render(pageOf(image({ shape: "landscape" }, { focus: { x: 0.333, y: 0.667 } })), "live"),
      blocks.image.id,
    );
    expect(imgOf(el3).getAttribute("style")).toBe("object-position:33.3% 66.7%");
  });

  it("no focus and a centered focus leave the style off", () => {
    for (const focus of [undefined, { x: 0.5, y: 0.5 }]) {
      const el = blockOf(
        render(pageOf(image({ shape: "wide" }, focus ? { focus } : {})), "live"),
        blocks.image.id,
      );
      expect(imgOf(el).hasAttribute("style")).toBe(false);
    }
  });

  it("an image with no file yet still shows the placeholder in the preview and nothing live", () => {
    const empty = { ...blocks.image, image: null, shape: "wide" } as unknown as Block;
    expect(render(pageOf(empty), "live").querySelector(".pg-image-frame")).toBeNull();
    expect(render(pageOf(empty), "preview").querySelector(".pg-placeholder")).not.toBeNull();
  });
});

describe("M6-23 the card banner's focus", () => {
  it("uses the same object-position", () => {
    const el = blockOf(render(pageOf(card({ focus: { x: 0, y: 0.5 } })), "live"), blocks.card.id);
    expect(el.querySelector(".pg-card-image")!.getAttribute("style")).toBe(
      "object-position:0% 50%",
    );
    const el2 = blockOf(render(pageOf(card({ focus: { x: 1, y: 0.5 } })), "live"), blocks.card.id);
    expect(el2.querySelector(".pg-card-image")!.getAttribute("style")).toBe(
      "object-position:100% 50%",
    );
  });

  it("without a focus, or with the center, the image has no style", () => {
    for (const ref of [{}, { focus: { x: 0.5, y: 0.5 } }]) {
      const el = blockOf(render(pageOf(card(ref)), "live"), blocks.card.id);
      expect(el.querySelector(".pg-card-image")!.hasAttribute("style")).toBe(false);
    }
  });
});

describe("M6-23 hostile values never reach the markup", () => {
  it("a shape that is not one of the three words draws the original shape", () => {
    const el = blockOf(
      render(pageOf(image({ shape: 'x"><b>pwn</b>', url: undefined })), "live"),
      blocks.image.id,
    );
    expect(el.querySelector(".pg-image-frame")).toBeNull();
    expect(el.innerHTML).not.toContain("pwn");
    expect(el.querySelector("b")).toBeNull();
    expect(el.outerHTML).not.toContain("x&quot;");
  });

  it.each([
    { x: "0%; background:url(//evil.example/a)", y: 0.5 },
    { x: 5, y: 0.5 },
    { x: null, y: "a" },
    "50% 50%",
    [0, 0],
  ])("a focus of %j on a shaped image or card adds no style", (focus) => {
    const imageEl = blockOf(
      render(pageOf(image({ shape: "wide" }, { focus })), "live"),
      blocks.image.id,
    );
    expect(imgOf(imageEl).hasAttribute("style")).toBe(false);
    const cardEl = blockOf(render(pageOf(card({ focus })), "live"), blocks.card.id);
    expect(cardEl.querySelector(".pg-card-image")!.hasAttribute("style")).toBe(false);
    expect(imageEl.outerHTML + cardEl.outerHTML).not.toContain("evil.example");
  });
});

describe("M6-23 parity: the editor preview and the live page draw the same markup", () => {
  const FOCI = [undefined, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }, { x: 0.333, y: 0.667 }];
  const SHAPES = [undefined, ...IMAGE_SHAPES];

  function draftWith(...docBlocks: unknown[]): DraftDoc {
    return draftDocSchema.parse({
      version: 1,
      rev: 1,
      profile: { name: "Mara Okafor", bio: "", photo: null },
      theme: { ref: null, overrides: {} },
      blocks: docBlocks,
    });
  }

  it("every shape with every focus, linked or not, and the card with every focus", () => {
    for (const shape of SHAPES) {
      for (const focus of FOCI) {
        for (const url of [undefined, "https://maraokafor.com/studio"]) {
          const draft = draftWith(
            image({ ...(shape ? { shape } : {}), url }, focus ? { focus } : {}),
            { ...card(focus ? { focus } : {}), id: "card-parity-01" },
          );
          const form = toPublishForm(draft, noirTokens);
          const preview = render(form, "preview");
          const live = render(form, "live");
          const label = JSON.stringify({ shape, focus, url });
          expect(blockOf(live, blocks.image.id).outerHTML, label).toBe(
            blockOf(preview, blocks.image.id).outerHTML,
          );
          expect(blockOf(live, "card-parity-01").outerHTML, label).toBe(
            blockOf(preview, "card-parity-01").outerHTML,
          );
        }
      }
    }
  });

  it("a centered focus in the draft draws the same markup as the published form without one", () => {
    const withCenter = toPublishForm(
      draftWith(image({ shape: "wide" }, { focus: { x: 0.5, y: 0.5 } })),
      noirTokens,
    );
    const without = toPublishForm(draftWith(image({ shape: "wide" })), noirTokens);
    expect(blockOf(render(withCenter, "preview"), blocks.image.id).outerHTML).toBe(
      blockOf(render(without, "live"), blocks.image.id).outerHTML,
    );
  });

  it("changing only the focus changes the markup (and the published form)", () => {
    const a = toPublishForm(draftWith(image({ shape: "wide" }, { focus: { x: 0, y: 0.5 } })), null);
    const b = toPublishForm(draftWith(image({ shape: "wide" }, { focus: { x: 1, y: 0.5 } })), null);
    expect(blockOf(render(a, "live"), blocks.image.id).outerHTML).not.toBe(
      blockOf(render(b, "live"), blocks.image.id).outerHTML,
    );
  });
});

describe("M6-23 static rules for the renderer", () => {
  const dir = resolve(process.cwd(), "src/components/page");
  const files = readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((file) => statSync(file).isFile());
  const code = files.filter((f) => /\.tsx?$/.test(f));
  const css = files.filter((f) => f.endsWith(".css"));
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("object-position is written in one place, from two numbers, through objectPositionOf", () => {
    const uses: string[] = [];
    for (const file of code) {
      const source = stripComments(readFileSync(file, "utf8"));
      // Any mention that is not the helper's own name.
      const bare = source.replace(/objectPositionOf/g, "");
      expect(bare, file).not.toMatch(/object-?position/i);
      if (/objectPositionOf/.test(source)) uses.push(file);
    }
    // The renderer reaches the helper in one file, and nothing builds the value by hand.
    expect(uses.map((f) => f.split("/").pop())).toEqual(["image-frame.tsx"]);
  });

  it("no file in the renderer reads a focus coordinate or builds a style string from one", () => {
    for (const file of code) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source, file).not.toMatch(/focus\??\.(x|y)\b/);
      expect(source, file).not.toMatch(/`[^`]*\$\{[^}]*focus/);
      expect(source, file).not.toMatch(/style=\{\{[^}]*focus/);
      expect(source, file).not.toMatch(/\+\s*["']%/);
    }
  });

  it("the frame's ratios are in the stylesheet, so the height is fixed before the file loads", () => {
    const sheet = css.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(sheet).toMatch(
      /\.pg-image-frame\[data-shape="square"\]\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/,
    );
    expect(sheet).toMatch(
      /\.pg-image-frame\[data-shape="landscape"\]\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/,
    );
    expect(sheet).toMatch(
      /\.pg-image-frame\[data-shape="wide"\]\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/,
    );
    expect(sheet).toMatch(/\.pg-image-frame\s*\{[^}]*overflow:\s*hidden/);
    expect(sheet).toMatch(/\.pg-image-frame\s*\{[^}]*border-radius:\s*var\(--t-radius\)/);
    expect(sheet).toMatch(/\.pg-image-frame\s*>\s*\.pg-image-img\s*\{[^}]*object-fit:\s*cover/);
  });
});
