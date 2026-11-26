// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  choosePreviewLink,
  forgetPreview,
  HAS_PREVIEW_LINK_MESSAGE,
  rememberedPreview,
  rememberPreview,
} from "@/lib/posts/preview-link";

/**
 * M16-16: Preview on a post makes a share link only when the site has none, as the Share tab does
 * (it never makes one on its own, and an address cannot be shown again). A remembered address is
 * reused only while it is still one of the site's active links; an unreadable list never leads to a
 * new link, nor to opening one that may be dead.
 */
const MINE = { id: "link-1", url: "http://x/share/t" };

describe("choosePreviewLink", () => {
  it("reuses the address this tab remembers while the site still has that link", () => {
    expect(choosePreviewLink({ remembered: MINE, activeLinkIds: ["link-1"] })).toBe(
      "use-remembered",
    );
    expect(
      choosePreviewLink({ remembered: MINE, activeLinkIds: ["a", "b", "link-1", "c", "d"] }),
    ).toBe("use-remembered");
  });

  it("does not reuse a remembered link that was turned off: it makes one when none is left", () => {
    expect(choosePreviewLink({ remembered: MINE, activeLinkIds: [] })).toBe("create");
  });

  it("does not reuse a remembered link that was turned off while others are active", () => {
    expect(choosePreviewLink({ remembered: MINE, activeLinkIds: ["other"] })).toBe("has-link");
  });

  it("makes a link only when the site has none", () => {
    expect(choosePreviewLink({ remembered: null, activeLinkIds: [] })).toBe("create");
  });

  it.each([1, 2, 5])("does not make one when the site already has %i", (count) => {
    const ids = Array.from({ length: count }, (_, i) => `l${i}`);
    expect(choosePreviewLink({ remembered: null, activeLinkIds: ids })).toBe("has-link");
  });

  it("neither makes nor opens one when the links could not be read", () => {
    expect(choosePreviewLink({ remembered: null, activeLinkIds: null })).toBe("unknown");
    expect(choosePreviewLink({ remembered: MINE, activeLinkIds: null })).toBe("unknown");
  });

  it("points the owner at the Share tab", () => {
    expect(HAS_PREVIEW_LINK_MESSAGE).toContain("Share tab");
  });
});

describe("the remembered link in this tab", () => {
  const later = () => new Date(Date.now() + 86_400_000).toISOString();
  beforeEach(() => window.sessionStorage.clear());

  it("is remembered with its id, per site", () => {
    rememberPreview("site-a", { ...MINE, expiresAt: later() });
    expect(rememberedPreview("site-a")).toEqual(MINE);
    expect(rememberedPreview("site-b")).toBeNull();
  });

  it("an address remembered without its id (before this change) is not used", () => {
    window.sessionStorage.setItem(
      "hl-post-preview:site-a",
      JSON.stringify({ url: MINE.url, expiresAt: later() }),
    );
    expect(rememberedPreview("site-a")).toBeNull();
  });

  it("one that runs out within a minute is not used", () => {
    rememberPreview("site-a", { ...MINE, expiresAt: new Date(Date.now() + 30_000).toISOString() });
    expect(rememberedPreview("site-a")).toBeNull();
  });

  it("turning off that link forgets it; turning off another link does not", () => {
    rememberPreview("site-a", { ...MINE, expiresAt: later() });
    forgetPreview("site-a", "other");
    expect(rememberedPreview("site-a")).toEqual(MINE);
    forgetPreview("site-a", MINE.id);
    expect(rememberedPreview("site-a")).toBeNull();
  });
});
