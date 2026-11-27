/**
 * Which navigation item the open screen belongs to (M7-01). The app shell's layout is
 * `src/app/(editor)/app/(screens)/layout.tsx`, so `useSelectedLayoutSegment()` there reports the
 * first segment BELOW it, and Next.js reports a route group by its own name (it does not skip it):
 *
 *   /editor, /design, /share   the workspace's route group, "(workspace)"
 *   /editor/history            "editor" (it is not part of the workspace)
 *   /posts, /posts/{id}        "posts" (the blog of the current site, M16-12: opened from the
 *                              Pages panel, with no item of its own)
 *   /analytics, /domains, /settings, /pages/new     "analytics", "domains", "settings", "pages"
 *   /audience                  "audience" (the forms' submissions, Wave D, M17-08)
 *   /members                   "members" (who works on the current site, Wave F): under Settings
 *
 * All of the first three belong to the one Editor item. `tests/unit/m7-nav-segments.test.ts` walks the
 * real src/app tree and checks every route against this function.
 */
export type NavKey = "editor" | "analytics" | "audience" | "domains" | "settings";

/** The route group that holds the workspace's three tabs: its directory name under `(screens)`. */
export const WORKSPACE_SEGMENT = "(workspace)";

export function navKeyForSegment(segment: string | null): NavKey | null {
  switch (segment) {
    case WORKSPACE_SEGMENT:
    case "editor":
    case "posts":
      return "editor";
    case "analytics":
    case "audience":
    case "domains":
    case "settings":
      return segment;
    case "members":
      return "settings";
    default:
      return null;
  }
}
