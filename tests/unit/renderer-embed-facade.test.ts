// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { blocks, fullPublished } from "./fixtures/page-document";

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { unmount: () => void; host: HTMLElement }[] = [];

function mount(blocksList = fullPublished.blocks) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(PageRenderer, {
        doc: { ...fullPublished, blocks: blocksList },
        pageId: "00000000-0000-4000-8000-0000000000b1",
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

describe("M2-19 YouTube click-to-play facade", () => {
  it("mounts no iframe until Play is pressed, then a privacy-enhanced iframe with its attributes", () => {
    const host = mount([blocks.embed]);
    expect(host.querySelector("iframe")).toBeNull();
    const button = host.querySelector<HTMLButtonElement>("[data-block-type=embed] button")!;
    expect(button).not.toBeNull();

    act(() => button.click());

    const frame = host.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    expect(host.querySelector("[data-block-type=embed] button")).toBeNull();
    const src = new URL(frame.getAttribute("src")!);
    expect(src.origin).toBe("https://www.youtube-nocookie.com");
    expect(src.pathname).toBe("/embed/jNQXAC9IVRw");
    expect(frame.getAttribute("title")).toContain("Behind the lens, ep. 4");
    expect(frame.getAttribute("allow")).toBe("autoplay; encrypted-media; picture-in-picture");
    expect(frame.hasAttribute("allowfullscreen")).toBe(true);
    expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(host.querySelector(".pg-embed-caption")?.textContent).toBe(
      "Behind the lens, ep. 4 · YouTube",
    );
  });

  it("moves focus into the player after Play", () => {
    const host = mount([blocks.embed]);
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.activeElement).toBe(host.querySelector("iframe"));
  });

  it("keeps the other blocks of the page untouched when one embed starts playing", () => {
    const host = mount();
    const before = host.querySelectorAll("[data-block-id]").length;
    act(() => host.querySelector<HTMLButtonElement>("[data-block-type=embed] button")!.click());
    expect(host.querySelectorAll("[data-block-id]")).toHaveLength(before);
  });
});
