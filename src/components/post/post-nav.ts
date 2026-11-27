import { BLOG_CLASSES } from "@/lib/blog/test-ids";
import { postHref, type PostIndexItem } from "@/lib/blog/types";
import { escapeHtml } from "@/lib/tenant-render/escape";

/**
 * The previous and next links of a post page (Wave B, M16-04), as an HTML string. They are NOT part
 * of the post's cached HTML: the cached page holds `POST_NAV_MARKER` and the responder puts this
 * string in its place on every request, from the cached post index. So publishing post B changes
 * post A's "next" link without rendering A again.
 *
 * Built by hand, so everything is escaped here: titles through `escapeHtml`, hrefs from `postHref`
 * (the archive path and the slug both checked again), and nothing else varies.
 */

function link(
  archivePath: string,
  post: Pick<PostIndexItem, "slug" | "title"> | null,
  rel: "prev" | "next",
  label: string,
): string {
  const href = post ? postHref(archivePath, post.slug) : null;
  if (!post || href === null) return "";
  return (
    `<a class="pg-post-navlink" rel="${rel}" href="${escapeHtml(href)}">` +
    `<span class="pg-post-navlabel">${label}</span>` +
    `<span class="pg-post-navtitle">${escapeHtml(post.title)}</span></a>`
  );
}

/** The neighbours of `entryId` in the index (newest first): the newer post and the older one. */
export function postNeighbours(
  posts: readonly PostIndexItem[],
  entryId: string,
): { newer: PostIndexItem | null; older: PostIndexItem | null } {
  const at = posts.findIndex((post) => post.id === entryId);
  if (at < 0) return { newer: null, older: null };
  return { newer: posts[at - 1] ?? null, older: posts[at + 1] ?? null };
}

/** The nav markup, or "" when the post has no neighbour. */
export function postNavHtml(
  archivePath: string,
  neighbours: {
    newer: Pick<PostIndexItem, "slug" | "title"> | null;
    older: Pick<PostIndexItem, "slug" | "title"> | null;
  },
): string {
  const older = link(archivePath, neighbours.older, "prev", "Previous post");
  const newer = link(archivePath, neighbours.newer, "next", "Next post");
  if (older === "" && newer === "") return "";
  return `<nav class="pg-post-nav ${BLOG_CLASSES.postNav}" aria-label="More posts">${older}${newer}</nav>`;
}
