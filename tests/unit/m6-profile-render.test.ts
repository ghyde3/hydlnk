// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublishDoc } from "@/lib/document";
import { PageRenderer } from "@/components/page/page-renderer";
import { Profile } from "@/components/page/profile";
import { noirTokens, photoRef } from "./fixtures/page-document";

/**
 * M6-15 and M6-17 on the renderer: the avatar's shape, size and border come from fixed lists, a
 * hidden photo draws nothing, a hidden name stays as the page's one visually hidden heading, a
 * hidden bio draws nothing, and with all three hidden the header is gone.
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

type ProfileDoc = PublishDoc["profile"];

function profile(patch: Record<string, unknown> = {}): ProfileDoc {
  return { name: "Mara Okafor", bio: "Photographer", photo: null, ...patch } as ProfileDoc;
}

function page(p: ProfileDoc): string {
  const doc: PublishDoc = {
    version: 1,
    profile: p,
    theme: { ref: null, overrides: {} },
    tokens: noirTokens,
    blocks: [
      { id: "header-aaaa1", type: "header", visible: true, text: "First block" },
      { id: "text-bbbbb1", type: "text", visible: true, text: "Second" },
    ],
  };
  return renderToStaticMarkup(createElement(PageRenderer, { doc, pageId: PAGE_ID, mode: "live" }));
}

const dom = (html: string): Document =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

describe("M6-15 the avatar's attributes", () => {
  it("an older profile (none of the options) renders the defaults, exactly the old avatar", () => {
    const html = page(profile());
    const avatar = dom(html).querySelector(".pg-avatar")!;
    expect(avatar.getAttribute("data-shape")).toBe("circle");
    expect(avatar.getAttribute("data-size")).toBe("medium");
    expect(avatar.getAttribute("data-border")).toBe("page");
    expect(avatar.textContent).toBe("MO");
    expect(dom(html).querySelector(".pg-name")!.textContent).toBe("Mara Okafor");
    expect(dom(html).querySelector(".pg-bio")!.textContent).toBe("Photographer");
  });

  it("an older profile with a photo draws a 96px image with the name as alt", () => {
    const img = dom(page(profile({ photo: photoRef }))).querySelector("img.pg-avatar-img")!;
    expect(img.getAttribute("alt")).toBe("Mara Okafor");
    expect(img.getAttribute("width")).toBe("96");
    expect(img.getAttribute("height")).toBe("96");
  });

  it.each([
    ["rounded", "large", "thick", "144"],
    ["square", "small", "none", "64"],
    ["circle", "medium", "thin", "96"],
  ])("%s, %s, %s", (photoShape, photoSize, photoBorder, px) => {
    const doc = dom(page(profile({ photo: photoRef, photoShape, photoSize, photoBorder })));
    const avatar = doc.querySelector(".pg-avatar")!;
    expect(avatar.getAttribute("data-shape")).toBe(photoShape);
    expect(avatar.getAttribute("data-size")).toBe(photoSize);
    expect(avatar.getAttribute("data-border")).toBe(photoBorder);
    expect(avatar.querySelector("img")!.getAttribute("width")).toBe(px);
  });

  it("never puts a raw tenant string into an attribute: an unknown value falls back to the default", () => {
    const html = page(
      profile({
        photoShape: 'blob" onmouseover="alert(1)',
        photoSize: "999",
        photoBorder: "url(x)",
      }),
    );
    const avatar = dom(html).querySelector(".pg-avatar")!;
    expect(avatar.getAttribute("data-shape")).toBe("circle");
    expect(avatar.getAttribute("data-size")).toBe("medium");
    expect(avatar.getAttribute("data-border")).toBe("page");
    expect(html).not.toMatch(/blob|999|url\(x\)|onmouseover/);
  });

  it("an XSS name beside a square, thick, large avatar is text, not markup", () => {
    const name = "<img src=x onerror=alert(1)>";
    const html = page(
      profile({ name, photoShape: "square", photoSize: "large", photoBorder: "thick" }),
    );
    const doc = dom(html);
    expect(doc.querySelector(".pg-name")!.textContent).toBe(name);
    expect(doc.querySelectorAll("img[onerror]")).toHaveLength(0);
    expect(doc.querySelector(".pg-avatar")!.getAttribute("data-shape")).toBe("square");
  });
});

describe("M6-15 showPhoto", () => {
  it("false draws no avatar element at all, not even the initials", () => {
    const html = page(profile({ showPhoto: false }));
    const doc = dom(html);
    expect(doc.querySelector(".pg-avatar")).toBeNull();
    expect(doc.querySelector("[data-profile-part=avatar]")).toBeNull();
    expect(doc.querySelector(".pg-profile")!.textContent).not.toContain("MO");
    expect(doc.querySelector(".pg-name")!.textContent).toBe("Mara Okafor");
  });

  it("false with a photo draws no image either", () => {
    const html = page(profile({ photo: photoRef, showPhoto: false }));
    expect(dom(html).querySelector("img")).toBeNull();
    expect(html).not.toContain(photoRef.path);
  });

  it("the name that was under an avatar is the first thing in the header, with no gap rule target", () => {
    const header = dom(page(profile({ showPhoto: false }))).querySelector(".pg-profile")!;
    expect(header.firstElementChild!.classList.contains("pg-name")).toBe(true);
  });
});

describe("M6-17 showName", () => {
  it("false keeps the one h1 with the name, marked as visually hidden, and no tap target for it", () => {
    const doc = dom(page(profile({ showName: false })));
    const headings = doc.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    const h1 = headings[0]!;
    expect(h1.textContent).toBe("Mara Okafor");
    expect(h1.classList.contains("pg-name")).toBe(true);
    expect(h1.hasAttribute("data-visually-hidden")).toBe(true);
    expect(h1.hasAttribute("data-profile-part")).toBe(false);
    expect(doc.querySelector("[data-profile-part=name]")).toBeNull();
    // The avatar and bio are still drawn.
    expect(doc.querySelector(".pg-avatar")).not.toBeNull();
    expect(doc.querySelector(".pg-bio")!.textContent).toBe("Photographer");
  });

  it("true (and the default) is a normal heading that is a tap target", () => {
    for (const p of [profile(), profile({ showName: true })]) {
      const doc = dom(page(p));
      expect(doc.querySelectorAll("h1")).toHaveLength(1);
      const h1 = doc.querySelector("h1")!;
      expect(h1.hasAttribute("data-visually-hidden")).toBe(false);
      expect(h1.getAttribute("data-profile-part")).toBe("name");
    }
  });

  it("keeps the hidden heading out of the header's flow when the header is also gone", () => {
    const html = page(profile({ showName: false, showPhoto: false, showBio: false }));
    const doc = dom(html);
    expect(doc.querySelector("header")).toBeNull();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    const column = doc.querySelector(".pg-column")!;
    // The hidden heading, then the blocks: the first block starts at the column's padding.
    expect(column.children[0]!.tagName).toBe("H1");
    expect(column.children[1]!.tagName).toBe("MAIN");
  });

  it("an empty name draws no heading whether it is shown or hidden", () => {
    expect(dom(page(profile({ name: "" }))).querySelectorAll("h1")).toHaveLength(0);
    expect(dom(page(profile({ name: "", showName: false }))).querySelectorAll("h1")).toHaveLength(
      0,
    );
  });
});

describe("M6-17 showBio", () => {
  it("false renders no bio element in the page body", () => {
    const html = page(profile({ showBio: false }));
    const doc = dom(html);
    expect(doc.querySelector(".pg-bio")).toBeNull();
    expect(doc.querySelector("[data-profile-part=bio]")).toBeNull();
    expect(html).not.toContain("Photographer");
  });

  it("an empty bio draws nothing, shown or not", () => {
    expect(dom(page(profile({ bio: "" }))).querySelector(".pg-bio")).toBeNull();
  });

  it("a script as the name and bio is escaped text where it is shown", () => {
    const text = "<script>alert(1)</script>";
    const html = page(profile({ name: text, bio: text }));
    expect(html).not.toContain("<script>");
    const doc = dom(html);
    expect(doc.querySelector(".pg-name")!.textContent).toBe(text);
    expect(doc.querySelector(".pg-bio")!.textContent).toBe(text);
  });
});

describe("M6-15 / M6-17 the header collapses", () => {
  it("photo, name and bio hidden: no header, the first block follows the column's top padding", () => {
    const doc = dom(page(profile({ showPhoto: false, showName: false, showBio: false })));
    expect(doc.querySelector(".pg-profile")).toBeNull();
    expect(doc.querySelector(".pg-avatar")).toBeNull();
    expect(doc.querySelector(".pg-bio")).toBeNull();
    expect(doc.querySelector(".pg-blocks")).not.toBeNull();
  });

  it("photo hidden, name and bio empty: no header at all", () => {
    const doc = dom(page(profile({ showPhoto: false, name: "", bio: "" })));
    expect(doc.querySelector("header")).toBeNull();
    expect(doc.querySelectorAll("h1")).toHaveLength(0);
  });

  it("only the bio shown keeps a header with just the bio (and the hidden heading)", () => {
    const doc = dom(page(profile({ showPhoto: false, showName: false })));
    const header = doc.querySelector(".pg-profile")!;
    expect(header.querySelector(".pg-bio")).not.toBeNull();
    expect(header.querySelectorAll("h1")).toHaveLength(1);
    expect(header.querySelector(".pg-avatar")).toBeNull();
  });
});

describe("M6-03 / M6-17 markers for the editor's preview", () => {
  it("marks the avatar, the name and the bio on every page, in both modes", () => {
    const doc = dom(page(profile()));
    expect(doc.querySelector(".pg-avatar")!.getAttribute("data-profile-part")).toBe("avatar");
    expect(doc.querySelector(".pg-name")!.getAttribute("data-profile-part")).toBe("name");
    expect(doc.querySelector(".pg-bio")!.getAttribute("data-profile-part")).toBe("bio");
  });

  it("sets data-block-id='profile' only when the preview asks for it", () => {
    const live = dom(renderToStaticMarkup(createElement(Profile, { profile: profile() })));
    expect(live.querySelector("[data-block-id]")).toBeNull();
    const editable = dom(
      renderToStaticMarkup(createElement(Profile, { profile: profile(), editable: true })),
    );
    expect(editable.querySelector("header")!.getAttribute("data-block-id")).toBe("profile");
    expect(editable.querySelectorAll("[data-block-id]")).toHaveLength(1);
  });

  it("tenant text cannot forge a tap target", () => {
    const html = page(
      profile({ name: "<b data-profile-part='bio'>", bio: "<i data-block-id='x'>" }),
    );
    const doc = dom(html);
    expect(doc.querySelectorAll("[data-block-id='x']")).toHaveLength(0);
    expect(doc.querySelectorAll("[data-profile-part=bio]")).toHaveLength(1);
    expect(doc.querySelector("[data-profile-part=bio]")!.textContent).toBe("<i data-block-id='x'>");
    expect(doc.querySelector("[data-profile-part=name]")!.textContent).toBe(
      "<b data-profile-part='bio'>",
    );
  });
});
