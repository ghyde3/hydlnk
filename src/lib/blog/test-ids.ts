/**
 * The `data-testid` values of the Posts screen, the post editor and the Pages panel's blog rows, and
 * the class names of the live blog markup (Wave B, M16). One list, so the components and the
 * Playwright specs of different builders agree. Pure.
 */
export const POSTS_TEST_IDS = {
  screen: "posts-screen",
  newPost: "posts-new",
  filterStatus: "posts-filter-status",
  filterCategory: "posts-filter-category",
  search: "posts-search",
  row: "posts-row",
  limit: "posts-limit",
} as const;

export const POST_TEST_IDS = {
  title: "post-title",
  slug: "post-slug",
  body: "post-body",
  bodySource: "post-body-source",
  excerpt: "post-excerpt",
  featuredImage: "post-featured-image",
  categories: "post-categories",
  tags: "post-tags",
  seoTitle: "post-seo-title",
  seoDescription: "post-seo-description",
  noindex: "post-noindex",
  saveState: "post-save-state",
  conflict: "post-conflict",
  publish: "post-publish",
  unpublish: "post-unpublish",
  preview: "post-preview",
  revisions: "post-revisions",
  trash: "post-trash",
  restore: "post-restore",
} as const;

export const PAGES_BLOG_TEST_IDS = {
  blogRow: "pages-blog-row",
  addBlog: "pages-add-blog",
} as const;

/** Class names of the live blog markup (tenant side; styled from `--t-*` tokens only). */
export const BLOG_CLASSES = {
  post: "hl-post",
  postBody: "hl-post-body",
  postNav: "hl-post-nav",
  archive: "hl-archive",
  archiveCard: "hl-archive-card",
  latestPosts: "hl-latest-posts",
} as const;
