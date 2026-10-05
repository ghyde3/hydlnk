import {
  PATH_MESSAGES,
  pageLinkTargetErrors,
  publishNav,
  pruneNav,
  siteBlockIdClashes,
  sitePathClashes,
  type PublishDoc,
  type PublishError,
  type SubPagePublish,
} from "@/lib/document";

/**
 * The checks of a whole-site Publish that span several documents (M11-05, M11-07), as pure
 * functions over the published forms: the core runs them after every page validated on its own and
 * before anything is written. Every error names its page (`subPageId`, `pageTitle`, and the title in
 * the message) so the editor and the MCP tool can say which page to fix; Home's errors carry none of
 * the two fields and read as they always did.
 */

/** A sub-page ready to publish: its row id, the title to name it by and its validated publish form. */
export interface SiteSubPage {
  id: string;
  title: string;
  form: SubPagePublish;
}

/** The title an error names a sub-page by: its draft title, or a stand-in for an empty or odd one. */
export function pageTitleOf(raw: unknown): string {
  const title =
    typeof raw === "object" && raw !== null ? (raw as { title?: unknown }).title : undefined;
  return typeof title === "string" && title.trim() !== ""
    ? title.trim().slice(0, 60)
    : "Untitled page";
}

/** The message of an error on a sub-page: it names the page. */
export function namedMessage(title: string, message: string): string {
  return `Page “${title}”: ${message}`;
}

/** The errors of one sub-page, each marked with the page and with its message naming it. */
export function nameErrors<T extends PublishError>(
  errors: readonly T[],
  page: { id: string; title: string },
): T[] {
  return errors.map((error) => ({
    ...error,
    message: namedMessage(page.title, error.message),
    subPageId: page.id,
    pageTitle: page.title,
  }));
}

/**
 * Two sub-pages with one path, a block id used twice anywhere in the site (they key
 * `/r/[pageId]/[blockId]`, so a repeat would make a click ambiguous), and a `page_link` whose target
 * is neither Home nor a page of the site. Hidden blocks are not in a publish form, so they never count.
 */
export function siteErrors(home: PublishDoc, subPages: readonly SiteSubPage[]): PublishError[] {
  const errors: PublishError[] = [];
  const byId = new Map(subPages.map((page) => [page.id, page]));

  for (const clash of sitePathClashes(
    subPages.map((page) => ({ id: page.id, path: page.form.path, title: page.title })),
  )) {
    for (const id of clash.pageIds) {
      const page = byId.get(id)!;
      errors.push(
        ...nameErrors([{ blockId: null, field: "path", message: PATH_MESSAGES.taken }], page),
      );
    }
  }

  for (const clash of siteBlockIdClashes(
    home,
    subPages.map((p) => ({ id: p.id, ...p.form })),
  )) {
    // The first page holding the id keeps it; every other holder is told to change it.
    clash.pages.slice(1).forEach((where) => {
      const message =
        "This block shares its id with another block of the site. Remove it and add it again.";
      if (where === "home") errors.push({ blockId: clash.id, field: "id", message });
      else
        errors.push(...nameErrors([{ blockId: clash.id, field: "id", message }], byId.get(where)!));
    });
  }

  const targets = pageLinkTargetErrors(
    [
      { pageId: "home", blocks: home.blocks },
      ...subPages.map((page) => ({
        pageId: page.id,
        title: page.title,
        blocks: page.form.blocks,
      })),
    ],
    subPages.map((page) => page.id),
  );
  for (const error of targets) {
    const base: PublishError = { blockId: error.blockId, field: "target", message: error.message };
    errors.push(
      error.pageId === "home"
        ? base
        : { ...base, subPageId: error.pageId, pageTitle: error.pageTitle ?? "Untitled page" },
    );
  }
  return errors;
}

/**
 * Home's form as it is stored when the site has these sub-pages: the menu without entries that point
 * at a page no longer in the site (state the owner cannot see, left by a delete or a version
 * restore). Stored as `publishNav` says: absent when it is the default, so a site that never used a
 * menu publishes byte-identically to before.
 */
export function homeForSite(home: PublishDoc, subPageIds: readonly string[]): PublishDoc {
  const nav = publishNav(pruneNav(home.nav, subPageIds));
  const { nav: _dropped, ...rest } = home;
  void _dropped;
  return nav ? { ...rest, nav } : rest;
}
