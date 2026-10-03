// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://mara.localhost:3000/"}
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
 * M6-27: Twitch plays only inside a site it knows, so a tap adds `parent={hostname}`. The value is
 * read from `window.location.hostname` (here `mara.localhost`), never from the document: a stored
 * `parent=evil.example` is dropped by parseEmbed, and a hostname that is not plain letters, digits,
 * dots and dashes mounts no iframe.
 */

const PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const mounted: { unmount: () => void; host: HTMLElement }[] = [];

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
        pageId: PAGE_ID,
        mode: "live",
      }),
    );
  });
  mounted.push({ host, unmount: () => act(() => root.unmount()) });
  return host;
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop()!;
    entry.unmount();
    entry.host.remove();
  }
});

describe("M6-27 the Twitch parent", () => {
  it("the page is on mara.localhost in this environment", () => {
    expect(window.location.hostname).toBe("mara.localhost");
  });

  it.each([
    ["a channel", "https://www.twitch.tv/mara_plays", "channel=mara_plays"],
    ["a video", "https://www.twitch.tv/videos/123456789", "video=v123456789"],
    [
      "a clip",
      "https://clips.twitch.tv/FamousHappyCaterpillar-AbCd",
      "clip=FamousHappyCaterpillar-AbCd",
    ],
  ])("%s: the iframe src ends with parent=mara.localhost", (_name, url, query) => {
    const host = mount(url);
    expect(host.querySelector("iframe")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    const src = host.querySelector("iframe")!.getAttribute("src")!;
    expect(src.endsWith("parent=mara.localhost")).toBe(true);
    expect(src).toContain(query);
    expect(src).toContain("autoplay=true");
    expect(src.match(/parent=/g)).toHaveLength(1);
  });

  it("a parent stored in the URL is dropped; only the page's hostname is used", () => {
    const host = mount("https://www.twitch.tv/mara_plays?parent=evil.example&autoplay=false");
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    const src = host.querySelector("iframe")!.getAttribute("src")!;
    expect(src).not.toContain("evil.example");
    expect(src).toBe(
      "https://player.twitch.tv/?channel=mara_plays&autoplay=true&parent=mara.localhost",
    );
  });

  it("the facade markup carries no parent at all before a tap", () => {
    const host = mount("https://www.twitch.tv/mara_plays");
    expect(host.innerHTML).not.toContain("parent");
  });
});
