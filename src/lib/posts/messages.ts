/**
 * Copy the post editor shares with the server (M16-13). The conflict sentence is the content
 * writer's own (`CONTENT_MESSAGES.conflict` in `src/lib/content/errors.ts`, a server module the
 * browser cannot import); `tests/unit/m16-posts-draft.test.ts` holds the two together.
 */
export const CONTENT_CONFLICT_MESSAGE =
  "This was changed somewhere else. Reload to see the latest version.";
