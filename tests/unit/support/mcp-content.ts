import { ENTRY_A, PAGE_A } from "./mcp-fakes";

/**
 * The seventeen content tools of M18 and one valid input for each, for the tests that run every one
 * of them (the door, the scopes, the activity log). Ids are the fakes of `mcp-fakes.ts`.
 */

export const TERM_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export const CONTENT_TOOL_INPUTS: Record<string, Record<string, unknown>> = {
  list_content_types: { pageId: PAGE_A },
  list_entries: { pageId: PAGE_A },
  get_entry: { entryId: ENTRY_A },
  list_terms: { pageId: PAGE_A },
  list_revisions: { entryId: ENTRY_A },
  create_entry: { pageId: PAGE_A, title: "A title" },
  update_entry: { entryId: ENTRY_A, ifRev: 3, title: "A title" },
  delete_entry: { entryId: ENTRY_A, ifRev: 3 },
  restore_entry: { entryId: ENTRY_A, ifRev: 3 },
  create_term: { pageId: PAGE_A, taxonomy: "tag", name: "A tag" },
  restore_revision: { entryId: ENTRY_A, revision: 1, ifRev: 3 },
  rename_term: { pageId: PAGE_A, termId: TERM_A, name: "A name" },
  delete_term: { pageId: PAGE_A, termId: TERM_A },
  publish_entry: { entryId: ENTRY_A, ifRev: 3 },
  unpublish_entry: { entryId: ENTRY_A, ifRev: 3 },
  publish_design: { pageId: PAGE_A, ifDesignRev: "3" },
  update_content_type: { pageId: PAGE_A, enabled: true },
};

export const CONTENT_TOOL_NAMES = Object.keys(CONTENT_TOOL_INPUTS);

/** The tools that work on one entry (`page: "entry"`). */
export const ENTRY_TOOL_NAMES = [
  "get_entry",
  "list_revisions",
  "update_entry",
  "delete_entry",
  "restore_entry",
  "restore_revision",
  "publish_entry",
  "unpublish_entry",
];

/** Everything that changes what a visitor sees, and so sits behind the publish scope. */
export const PUBLISH_SCOPE_TOOL_NAMES = [
  "rename_term",
  "delete_term",
  "publish_entry",
  "unpublish_entry",
  "publish_design",
  "update_content_type",
  "publish_page",
];

/** The tools that count against the per-item publish limit. */
export const CHANGES_LIVE_TOOL_NAMES = [
  "publish_entry",
  "unpublish_entry",
  "publish_design",
  "update_content_type",
];
