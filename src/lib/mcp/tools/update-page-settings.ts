import { z } from "zod";
import { SUB_PAGE_LIMITS, resolveNav, type SubPageDraft } from "@/lib/document";
import { pathProblem } from "@/lib/site-pages/pages";
import { MCP_SCOPES } from "../constants";
import { commitSubPage } from "../commit";
import { cleanLine, readDraft } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import { listSubPageSummaries, PageReadError } from "../page-access";
import type { ToolDefinition } from "../types";
import { DRAFT_ONLY, WRITE_IDEMPOTENT, ifRevField, pageIdField } from "./common";
import { applyMenuChange, writeMenuChange } from "./menu";

const input = z
  .strictObject({
    pageId: pageIdField,
    subPageId: z
      .string()
      .max(64)
      .meta({ format: "uuid" })
      .describe("The page to change: its id from list_pages. Home is changed with update_profile."),
    ifRev: ifRevField,
    title: z
      .string()
      .max(200)
      .optional()
      .describe(`The page's title, 1 to ${SUB_PAGE_LIMITS.title} characters.`),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe(
        `The page's description for search results, up to ${SUB_PAGE_LIMITS.description} characters. An empty string clears it.`,
      ),
    path: z
      .string()
      .max(64)
      .optional()
      .describe(
        "The address of the page on the site, one lower-case word. A page that is already live keeps its old address until the next publish.",
      ),
    inMenu: z.boolean().optional().describe("Put the page in the site menu or take it out."),
    menuPosition: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Where the page goes in the menu, counting from 0 (the first item below Home). Goes with inMenu true, or for a page already in the menu.",
      ),
  })
  .refine(
    (value) =>
      [value.title, value.description, value.path, value.inMenu, value.menuPosition].some(
        (item) => item !== undefined,
      ),
    { error: MESSAGES.nothingToChange },
  );

function refuse(path: string, message: string): never {
  throw new ToolFailure("invalid_input", message, { issues: [{ path, message }] });
}

export const updatePageSettings: ToolDefinition<typeof input> = {
  name: "update_page_settings",
  title: "Change a page's settings",
  description: `Changes the settings of one page of a site other than Home: its title, description and path, and whether it is in the site menu and where. Send only what changes. ${DRAFT_ONLY} The menu belongs to Home, so a menu change writes Home's draft and returns Home's new rev as homeRev; ifRev is the page's own rev from get_page. Paths follow the same rules as in the editor: one lower-case word, not reserved and not used by another page. Sending the same values twice changes nothing. Errors: invalid_input, conflict, not_found.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "one",
  needsDraft: true,
  async handler(args, call) {
    const sub = call.subPage;
    if (!sub)
      refuse(
        "subPageId",
        "Home has no page settings here. Use update_profile for Home, or send a page id from list_pages.",
      );
    const page = call.page!;

    // The page's own fields, checked before anything is written.
    let title: string | undefined;
    if (args.title !== undefined) {
      title = cleanLine(args.title).trim();
      const length = Array.from(title).length;
      if (length === 0) refuse("title", "Add a page title.");
      if (length > SUB_PAGE_LIMITS.title)
        refuse("title", `Use ${SUB_PAGE_LIMITS.title} characters or fewer.`);
    }
    let description: string | undefined;
    if (args.description !== undefined) {
      description = cleanLine(args.description).trim();
      if (Array.from(description).length > SUB_PAGE_LIMITS.description) {
        refuse("description", `Use ${SUB_PAGE_LIMITS.description} characters or fewer.`);
      }
    }
    let path: string | undefined;
    if (args.path !== undefined) {
      path = args.path.trim();
      let others;
      try {
        others = await listSubPageSummaries(call.admin, call.userId, [page.id]);
      } catch (error) {
        if (error instanceof PageReadError)
          throw new ToolFailure("server_error", MESSAGES.serverError);
        throw error;
      }
      const taken = others
        .filter((row) => row.id !== sub.id)
        .flatMap((row) => (row.livePath === null ? [row.path] : [row.path, row.livePath]));
      const problem = pathProblem(path, taken);
      if (problem !== null) refuse("path", problem);
    }

    const wantsMenu = args.inMenu !== undefined || args.menuPosition !== undefined;
    const home = readDraft(page.draft);
    if (wantsMenu) {
      // Refuse a menu change the menu cannot take before the page is written.
      applyMenuChange(home?.nav, sub.id, { inMenu: args.inMenu, position: args.menuPosition });
    }
    if (args.ifRev !== undefined && args.ifRev !== sub.rev) {
      throw new ToolFailure("conflict", MESSAGES.conflict);
    }

    let rev = sub.rev;
    let current: { title: string; description: string; path: string } | null = null;
    let unchanged = true;
    // The page as it was before the first write, kept so a failed menu write can put it back.
    let before: SubPageDraft | null = null;
    let wroteSubPage = false;
    if (title !== undefined || description !== undefined || path !== undefined) {
      const result = await commitSubPage(call, args.ifRev, (doc) => {
        before = doc;
        const next = {
          ...doc,
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(path !== undefined ? { path } : {}),
        };
        return { kind: "write", doc: next, value: next };
      });
      rev = result.rev;
      unchanged = result.unchanged;
      wroteSubPage = !result.unchanged;
      current = result.value;
    }
    let homeRev: number | undefined;
    let inMenu = home ? resolveNav(home.nav).items.includes(sub.id) : false;
    let menuPosition: number | null = inMenu ? resolveNav(home?.nav).items.indexOf(sub.id) : null;
    if (wantsMenu) {
      let menu;
      try {
        menu = await writeMenuChange(call, sub.id, {
          inMenu: args.inMenu,
          position: args.menuPosition,
        });
      } catch (error) {
        // All or nothing: the menu write failed after the page was saved, so put the page back.
        // The restore is guarded by the rev the first write made, so it never overwrites an edit
        // made in between; if it cannot be done, say exactly what was saved.
        let restored = !wroteSubPage;
        if (wroteSubPage && before) {
          const original: SubPageDraft = before;
          try {
            await commitSubPage(call, rev, () => ({ kind: "write", doc: original, value: null }));
            restored = true;
          } catch {
            restored = false;
          }
        }
        if (!restored) {
          throw new ToolFailure(
            "server_error",
            "Part of this change was saved: the page’s title, description or path was updated, but the menu was not changed. Call get_page to see the page as it is now, then send the menu change again on its own.",
          );
        }
        if (error instanceof ToolFailure && error.code === "invalid_input") throw error;
        throw new ToolFailure(
          error instanceof ToolFailure && error.code === "conflict" ? "conflict" : "server_error",
          `The menu could not be changed, so nothing was changed. ${
            error instanceof ToolFailure && error.code === "conflict"
              ? "Home changed while I was working. Call get_page and redo the change."
              : "Try again."
          }`,
        );
      }
      inMenu = menu.nav.items.includes(sub.id);
      menuPosition = inMenu ? menu.nav.items.indexOf(sub.id) : null;
      if (menu.changed) {
        homeRev = menu.rev;
        unchanged = false;
      }
    }

    return {
      sentence: unchanged
        ? "Nothing changed. The page already looked like that."
        : "Updated the page’s settings.",
      data: {
        subPageId: sub.id,
        rev,
        unchanged,
        ...(current
          ? { title: current.title, description: current.description, path: `/${current.path}` }
          : {}),
        inMenu,
        menuPosition,
        ...(homeRev !== undefined ? { homeRev } : {}),
      },
    };
  },
};
