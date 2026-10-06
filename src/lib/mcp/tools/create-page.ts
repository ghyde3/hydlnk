import { z } from "zod";
import { SUB_PAGE_LIMITS } from "@/lib/document";
import { createSubPageWithClient, type SubPageError } from "@/lib/site-pages/sub-pages-core";
import { MCP_SCOPES } from "../constants";
import { cleanLine } from "../doc-view";
import { ToolFailure, type ToolErrorCode } from "../errors";
import { MESSAGES } from "../errors";
import type { ToolDefinition } from "../types";
import { DRAFT_ONLY, WRITE_NOT_IDEMPOTENT, pageIdField } from "./common";
import { writeMenuChange } from "./menu";

const input = z.strictObject({
  pageId: pageIdField,
  title: z
    .string()
    .max(200)
    .describe(`The page's title, 1 to ${SUB_PAGE_LIMITS.title} characters. It is the menu label.`),
  path: z
    .string()
    .max(64)
    .optional()
    .describe(
      "The address of the page on the site, one lower-case word such as items or our-story (letters, digits and hyphens). Leave it out to get one made from the title.",
    ),
  inMenu: z
    .boolean()
    .optional()
    .describe("Add the page to the site menu. Defaults to true, as the editor does."),
});

/** How the shared create code's refusals read as tool codes. */
const CODES: Record<SubPageError, ToolErrorCode> = {
  not_found: "not_found",
  account_suspended: "account_suspended",
  page_limit: "plan_required",
  storage_full: "too_large",
  path_invalid: "invalid_input",
  path_taken: "invalid_input",
  doc_invalid: "invalid_input",
  create_failed: "server_error",
  delete_failed: "server_error",
};

export const createPage: ToolDefinition<typeof input> = {
  name: "create_page",
  title: "Add a page to a site",
  description: `Adds an empty page to a site, next to Home: a title and an address (path) such as /items. ${DRAFT_ONLY} It is saved as a draft and goes live with the next publish_page, which publishes the whole site. The plan limits the pages a site can hold (Free 3 with Home, Pro 10): at the limit the answer is plan_required. By default the page is added to the end of the site menu, which changes Home's draft and its rev; pass inMenu false to keep it out. A page cannot be deleted from here, only in the app. Fill the page with add_block and its subPageId. Errors: invalid_input (a bad title or path, or a path another page uses), plan_required, too_large, not_found.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_NOT_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    const title = cleanLine(args.title).trim();
    const length = Array.from(title).length;
    if (length === 0 || length > SUB_PAGE_LIMITS.title) {
      const message =
        length === 0 ? "Add a page title." : `Use ${SUB_PAGE_LIMITS.title} characters or fewer.`;
      throw new ToolFailure("invalid_input", message, { issues: [{ path: "title", message }] });
    }
    const path = args.path === undefined ? undefined : args.path.trim();

    const created = await createSubPageWithClient(call.admin, {
      userId: call.userId,
      siteId: call.page!.id,
      title,
      path,
    });
    if (!created.ok) {
      const code = CODES[created.error];
      if (code === "server_error") throw new ToolFailure("server_error", MESSAGES.serverError);
      throw new ToolFailure(code, created.message, {
        ...(code === "invalid_input"
          ? {
              issues: [
                {
                  path: created.error === "doc_invalid" ? "title" : "path",
                  message: created.message,
                },
              ],
            }
          : {}),
      });
    }

    let inMenu = false;
    let homeRev: number | undefined;
    let menuNote: string | undefined;
    if (args.inMenu !== false) {
      try {
        const menu = await writeMenuChange(call, created.id, { inMenu: true });
        inMenu = menu.nav.items.includes(created.id);
        homeRev = menu.rev;
      } catch (error) {
        menuNote =
          error instanceof ToolFailure && error.code === "invalid_input"
            ? "The menu is full, so the page is not in it. Take a page out first, then use update_page_settings."
            : "The page was added but could not be put in the menu. Use update_page_settings to add it.";
      }
    }

    return {
      sentence: `Added the page “${created.draft.title}” at /${created.draft.path}.${inMenu ? " It is in the menu." : menuNote ? ` ${menuNote}` : ""}`,
      data: {
        subPageId: created.id,
        title: created.draft.title,
        path: `/${created.draft.path}`,
        rev: Date.parse(created.createdAt),
        inMenu,
        ...(homeRev !== undefined ? { homeRev } : {}),
        ...(menuNote ? { menuNote } : {}),
      },
    };
  },
};
