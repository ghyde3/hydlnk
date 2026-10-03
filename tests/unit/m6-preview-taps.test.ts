// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Block, PublishDoc } from "@/lib/document";
import { PageRenderer } from "@/components/page/page-renderer";
import { checkTap, resolvePreviewTap } from "@/components/editor/preview-taps";
import {
  DOCK_HEIGHT,
  DOCK_STRIP_HEIGHT,
  BACK_BAR_HEIGHT,
  isTextField,
  stackHeight,
  toastLift,
} from "@/components/editor/mini-preview-dock";
import { blocks, fullPublished, noirTokens } from "./fixtures/page-document";

// The editor's contracts module re-exports the Publish server action, which needs the server.
vi.mock("@/lib/publish/actions", () => ({ publishPage: vi.fn() }));
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

function page(docBlocks: Block[], profile: Partial<PublishDoc["profile"]> = {}): HTMLElement {
  const doc: PublishDoc = {
    ...fullPublished,
    profile: { ...fullPublished.profile, ...profile },
    tokens: noirTokens,
    blocks: docBlocks,
  };
  const html = renderToStaticMarkup(
    createElement(PageRenderer, { doc, pageId: PAGE_ID, mode: "preview" }),
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe("M6-03 resolvePreviewTap reads the attributes the renderer outputs", () => {
  const host = page(Object.values(blocks));

  it("M6-03 a block resolves to its id, whichever element inside it was hit", () => {
    for (const block of Object.values(blocks)) {
      const el = host.querySelector(`[data-block-id="${block.id}"]`);
      expect(el, block.id).not.toBeNull();
      expect(resolvePreviewTap(el)).toEqual({ kind: "block", blockId: block.id });
    }
    const label = host.querySelector(`[data-block-id="${blocks.card.id}"] .pg-card-title`);
    expect(resolvePreviewTap(label)).toEqual({ kind: "block", blockId: blocks.card.id });
  });

  it("M6-03 a social icon and a grid cell resolve to the item and its block", () => {
    const icon = host.querySelector(`[data-item-id="${blocks.social.icons[1]!.id}"] svg`);
    expect(resolvePreviewTap(icon)).toEqual({
      kind: "block",
      blockId: blocks.social.id,
      itemId: blocks.social.icons[1]!.id,
    });
    const title = host.querySelector(`[data-item-id="${blocks.grid.cells[0]!.id}"] .pg-cell-title`);
    expect(resolvePreviewTap(title)).toEqual({
      kind: "block",
      blockId: blocks.grid.id,
      itemId: blocks.grid.cells[0]!.id,
    });
  });

  it("M6-03 the page background, empty space and the footer links resolve to nothing", () => {
    expect(resolvePreviewTap(host.querySelector("[data-page-root]"))).toBeNull();
    expect(resolvePreviewTap(host.querySelector(".pg-column"))).toBeNull();
    expect(resolvePreviewTap(host.querySelector("main.pg-blocks"))).toBeNull();
    expect(resolvePreviewTap(null)).toBeNull();
    const withFooter = document.createElement("div");
    withFooter.innerHTML = renderToStaticMarkup(
      createElement(PageRenderer, {
        doc: fullPublished,
        pageId: PAGE_ID,
        mode: "preview",
        chrome: { badge: true, reportHref: "/report/x" },
      }),
    );
    for (const link of Array.from(withFooter.querySelectorAll("[data-page-footer] a"))) {
      expect(resolvePreviewTap(link)).toBeNull();
    }
  });

  it("M6-03 nothing outside the frame counts, even with the attributes", () => {
    const outer = document.createElement("li");
    outer.setAttribute("data-block-id", "row-outside");
    const frame = document.createElement("div");
    const inner = document.createElement("span");
    frame.append(inner);
    outer.append(frame);
    expect(resolvePreviewTap(inner)).toEqual({ kind: "block", blockId: "row-outside" });
    expect(resolvePreviewTap(inner, frame)).toBeNull();
  });

  it("M6-03 profile parts resolve by data-profile-part and only the three known values", () => {
    const frame = document.createElement("div");
    frame.innerHTML =
      '<header><div data-profile-part="avatar"><span id="a"></span></div><h1 data-profile-part="name" id="n">x</h1>' +
      '<p data-profile-part="bio" id="b">y</p><p data-profile-part="other" id="o">z</p></header>';
    expect(resolvePreviewTap(frame.querySelector("#a"), frame)).toEqual({
      kind: "profile",
      part: "avatar",
    });
    expect(resolvePreviewTap(frame.querySelector("#n"), frame)).toEqual({
      kind: "profile",
      part: "name",
    });
    expect(resolvePreviewTap(frame.querySelector("#b"), frame)).toEqual({
      kind: "profile",
      part: "bio",
    });
    expect(resolvePreviewTap(frame.querySelector("#o"), frame)).toBeNull();
  });
});

describe("M6-03 abuse: tenant text cannot forge a tap target", () => {
  const forgedLabel = "<i data-block-id='x'>";
  const forgedName = "<b data-profile-part='bio'>";
  const host = page([{ ...blocks.link, label: forgedLabel }, blocks.text], {
    name: forgedName,
    bio: "A bio",
  });

  it("M6-03 the text renders as literal text: no element carries the forged attribute", () => {
    expect(host.querySelector('[data-block-id="x"]')).toBeNull();
    // The one element marked as the bio is the bio itself (a <p>), never the display name.
    const bios = Array.from(host.querySelectorAll("[data-profile-part='bio']"));
    expect(bios.map((el) => el.tagName)).toEqual(["P"]);
    expect(host.querySelector(`[data-block-id="${blocks.link.id}"]`)?.textContent).toBe(
      forgedLabel,
    );
    expect(host.querySelector("h1")?.textContent).toBe(forgedName);
    expect(host.querySelector("h1 b, h1 i, a i")).toBeNull();
  });

  it("M6-03 a tap on that text opens the block it really belongs to", () => {
    const link = host.querySelector(`[data-block-id="${blocks.link.id}"]`);
    expect(resolvePreviewTap(link)).toEqual({ kind: "block", blockId: blocks.link.id });
  });

  it("M6-03 checkTap drops ids that are not on the page", () => {
    const list: Block[] = [blocks.link, blocks.social, blocks.grid];
    expect(checkTap({ kind: "block", blockId: "x" }, list)).toBeNull();
    expect(checkTap({ kind: "block", blockId: blocks.link.id }, list)).toEqual({
      kind: "block",
      blockId: blocks.link.id,
    });
    // An item that is not in that block opens the block without the item.
    expect(
      checkTap({ kind: "block", blockId: blocks.link.id, itemId: "icon-instagram" }, list),
    ).toEqual({
      kind: "block",
      blockId: blocks.link.id,
    });
    expect(
      checkTap({ kind: "block", blockId: blocks.social.id, itemId: "icon-instagram" }, list),
    ).toEqual({ kind: "block", blockId: blocks.social.id, itemId: "icon-instagram" });
    expect(
      checkTap({ kind: "block", blockId: blocks.social.id, itemId: "cell-prints-01" }, list),
    ).toEqual({ kind: "block", blockId: blocks.social.id });
    expect(
      checkTap({ kind: "block", blockId: blocks.grid.id, itemId: "cell-prints-01" }, list),
    ).toEqual({ kind: "block", blockId: blocks.grid.id, itemId: "cell-prints-01" });
    expect(checkTap({ kind: "profile", part: "bio" }, list)).toEqual({
      kind: "profile",
      part: "bio",
    });
  });
});

describe("M6-01 the thumbnail mode of the renderer", () => {
  const embedDoc = (url: string): PublishDoc => ({
    ...fullPublished,
    blocks: [{ ...blocks.embed, url }],
  });
  const render = (doc: PublishDoc, thumbnail: boolean) =>
    renderToStaticMarkup(
      createElement(PageRenderer, { doc, pageId: PAGE_ID, mode: "preview", thumbnail }),
    );

  it("M6-01 a YouTube embed is a still poster: no button, no iframe", () => {
    const html = render(embedDoc("https://www.youtube.com/watch?v=jNQXAC9IVRw"), true);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/youtube(?:-nocookie)?\.com/);
    expect(html).toContain("pg-embed-play");
    expect(html).toContain('data-block-id="embed-yt-ep04"');
  });

  it("M6-01 a Spotify embed is an empty box of the player's height: no iframe, no request", () => {
    const html = render(embedDoc("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"), true);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("spotify.com");
    expect(html).toContain("height:152px");
  });

  it("M6-01 without the flag the markup is what it was: the Play button and the Spotify iframe", () => {
    expect(render(embedDoc("https://www.youtube.com/watch?v=jNQXAC9IVRw"), false)).toContain(
      "<button",
    );
    expect(
      render(embedDoc("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"), false),
    ).toContain("<iframe");
  });

  it("M6-01 a thumbnail holds nothing to activate: no anchor, button, iframe or input, no href", () => {
    const html = render({ ...fullPublished, blocks: Object.values(blocks) }, true);
    expect(html).not.toMatch(/<(?:a|button|iframe|input|textarea|select)\b/);
    expect(html).not.toMatch(/\shref="\/r\//);
    expect(html).not.toContain("/r/");
    // The tap attributes and the look stay.
    for (const block of Object.values(blocks))
      expect(html).toContain(`data-block-id="${block.id}"`);
    expect(html).toContain('class="pg-link"');
    expect(html).toContain('class="pg-social-link"');
    expect(html).toContain('class="pg-cell"');
  });

  it("M6-01 text blocks and headers are the same markup as the preview's", () => {
    const strip = (html: string) => html.replace(/\s+/g, " ");
    const doc: PublishDoc = {
      ...fullPublished,
      blocks: [blocks.header, blocks.text, blocks.divider],
    };
    expect(strip(render(doc, true))).toBe(strip(render(doc, false)));
  });

  it("M6-01 without the flag a link is the anchor it always was", () => {
    const html = render({ ...fullPublished, blocks: [blocks.link, blocks.social] }, false);
    expect(html).toMatch(/<a class="pg-link"[^>]*href="\/r\/[^"]+" rel="nofollow noopener"/);
    expect(html).toMatch(/<a class="pg-social-link" aria-label="Instagram"/);
  });
});

describe("M6-01 the dock's measures", () => {
  it("M6-01 the toasts are lifted by the dock, the strip or the bar, and not at all without them", () => {
    expect(toastLift(0)).toBe(0);
    expect(stackHeight("none", false)).toBe(0);
    expect(stackHeight("dock", false)).toBe(DOCK_HEIGHT);
    expect(stackHeight("dock", true)).toBe(DOCK_STRIP_HEIGHT);
    expect(stackHeight("bar", false)).toBe(BACK_BAR_HEIGHT);
    // The toast keeps its 11px over what is below it: 57 tab bar + 8 gap + height + 11 - 68.
    expect(toastLift(DOCK_HEIGHT)).toBe(57 + 8 + 96 + 11 - 68);
    expect(toastLift(DOCK_STRIP_HEIGHT)).toBeLessThan(toastLift(DOCK_HEIGHT));
  });

  it("M6-01 isTextField: text inputs, textareas and selects, not buttons, checkboxes or files", () => {
    const make = (html: string) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      return host.firstElementChild;
    };
    expect(isTextField(make("<input>"))).toBe(true);
    expect(isTextField(make('<input type="url">'))).toBe(true);
    expect(isTextField(make("<textarea></textarea>"))).toBe(true);
    expect(isTextField(make("<select></select>"))).toBe(true);
    expect(isTextField(make('<input type="checkbox">'))).toBe(false);
    expect(isTextField(make('<input type="file">'))).toBe(false);
    expect(isTextField(make("<button></button>"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});
