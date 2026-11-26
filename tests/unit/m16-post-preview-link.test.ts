import { describe, expect, it } from "vitest";
import { choosePreviewLink, HAS_PREVIEW_LINK_MESSAGE } from "@/lib/posts/preview-link";

/**
 * M16-16: Preview on a post makes a share link only when the site has none, as the Share tab does
 * (it never makes one on its own, and an address cannot be shown again). A remembered address is
 * reused; an unreadable list never leads to a new link.
 */
describe("choosePreviewLink", () => {
  it("reuses the address this tab remembers, without asking what the site has", () => {
    expect(choosePreviewLink({ remembered: "http://x/share/t", activeLinks: 5 })).toBe(
      "use-remembered",
    );
    expect(choosePreviewLink({ remembered: "http://x/share/t", activeLinks: null })).toBe(
      "use-remembered",
    );
  });

  it("makes a link only when the site has none", () => {
    expect(choosePreviewLink({ remembered: null, activeLinks: 0 })).toBe("create");
  });

  it.each([1, 2, 5])("does not make one when the site already has %i", (count) => {
    expect(choosePreviewLink({ remembered: null, activeLinks: count })).toBe("has-link");
  });

  it("does not make one when the links could not be read", () => {
    expect(choosePreviewLink({ remembered: null, activeLinks: null })).toBe("unknown");
  });

  it("points the owner at the Share tab", () => {
    expect(HAS_PREVIEW_LINK_MESSAGE).toContain("Share tab");
  });
});
