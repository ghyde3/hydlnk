import { describe, expect, it } from "vitest";
import {
  BLOG_LABEL,
  POST_OPTIONS_MAX,
  archiveLabel,
  buildPageOptions,
  pageFilterLabel,
  postOptionTitle,
} from "@/lib/analytics/dashboard/page-filter";

/**
 * M16-11: the Analytics page filter with a blog. The archive is one entry ("Blog": its archive,
 * paging and term pages share the Post type's id), each post with views is an entry under its
 * title, and a trashed or purged post (an id the site no longer has) reads "Deleted page".
 */

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const SUB = uuid(1);
const TYPE = uuid(2);
const POST_A = uuid(3);
const POST_B = uuid(4);
const TRASHED = uuid(5);

describe("M16-11 page options with posts", () => {
  it("names the built-in Post type's archive Blog and any other type by its plural label", () => {
    expect(BLOG_LABEL).toBe("Blog");
    expect(archiveLabel({ key: "post", labelPlural: "Posts" })).toBe("Blog");
    expect(archiveLabel({ key: "recipe", labelPlural: " Recipes " })).toBe("Recipes");
    expect(archiveLabel({ key: "recipe", labelPlural: "  " })).toBe("Archive");
  });

  it("lists Blog and each post by its title after the pages; a trashed post is a Deleted page", () => {
    const options = buildPageOptions(
      [
        { id: SUB, title: "Menu" },
        { id: TYPE, title: BLOG_LABEL },
        { id: POST_B, title: postOptionTitle("Second post") },
        { id: POST_A, title: postOptionTitle("First post") },
      ],
      [SUB, TYPE, POST_A, POST_B, TRASHED],
      "all",
    );
    expect(options).toEqual([
      { value: "all", label: "All pages" },
      { value: "home", label: "Home" },
      { value: SUB, label: "Menu" },
      { value: TYPE, label: "Blog" },
      { value: POST_B, label: "Second post" },
      { value: POST_A, label: "First post" },
      { value: TRASHED, label: "Deleted page" },
    ]);
    expect(pageFilterLabel(options, POST_A)).toBe("First post");
    expect(pageFilterLabel(options, TYPE)).toBe("Blog");
    expect(pageFilterLabel(options, TRASHED)).toBe("Deleted page");
  });

  it("a selected post that was trashed since still gets its Deleted page entry", () => {
    const options = buildPageOptions([{ id: TYPE, title: BLOG_LABEL }], [], TRASHED);
    expect(options.at(-1)).toEqual({ value: TRASHED, label: "Deleted page" });
  });

  it("names at most 50 posts", () => {
    expect(POST_OPTIONS_MAX).toBe(50);
  });

  it("a post title loses control and bidi characters; nothing usable is Untitled post", () => {
    expect(postOptionTitle("Safe\u202Etxt.exe\u0007")).toBe("Safetxt.exe");
    for (const title of ["", "  ", null, undefined, 7, { title: "x" }]) {
      expect(postOptionTitle(title)).toBe("Untitled post");
    }
  });
});
