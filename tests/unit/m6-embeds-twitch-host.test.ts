// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://[::1]:3000/"}
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import type { Block } from "@/lib/document";
import { fullPublished } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M6-27: a hostname that is not `^[a-z0-9.-]{1,253}$` (an IPv6 literal keeps its brackets) mounts no
 * Twitch iframe and says so. Other providers do not need a parent and still play.
 */
describe("M6-27 a hostname Twitch cannot use", () => {
  function mount(url: string) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const block = {
      id: "embed-twitch-01",
      type: "embed",
      visible: true,
      url,
      caption: "Live",
    } as Block;
    act(() => {
      root.render(
        createElement(PageRenderer, {
          doc: { ...fullPublished, blocks: [block] },
          pageId: "00000000-0000-4000-8000-0000000000b1",
          mode: "live",
        }),
      );
    });
    return host;
  }

  it("shows 'This embed can’t load here.' and no iframe", () => {
    expect(window.location.hostname).toBe("[::1]");
    const host = mount("https://www.twitch.tv/mara_plays");
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("[data-block-type=embed] button")).toBeNull();
    expect(host.querySelector(".pg-embed-unavailable")?.textContent).toBe(
      "This embed can’t load here.",
    );
  });

  it("a Vimeo embed plays on the same page", () => {
    const host = mount("https://vimeo.com/76979871");
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector("iframe")?.getAttribute("src")).toContain("player.vimeo.com");
  });
});
