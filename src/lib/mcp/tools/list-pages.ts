import { z } from "zod";
import { PLAN_LIMITS } from "@/lib/limits";
import { handleAddress } from "@/lib/pages/plans";
import { tenantOrigin } from "@/lib/publish/urls";
import { MCP_SCOPES } from "../constants";
import { publishStatusOf, readDraft } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import {
  listOwnedPages,
  listPageDomains,
  listUsableThemes,
  loadAccountPlan,
  PageReadError,
} from "../page-access";
import type { ToolDefinition } from "../types";
import { READ_ONLY } from "./common";

const STATUS_WORDS = {
  published: "published",
  "unpublished-changes": "unpublished changes",
  "not-published": "not published",
} as const;

const input = z.strictObject({});

export const listPages: ToolDefinition<typeof input> = {
  name: "list_pages",
  title: "List your pages",
  description:
    "Lists the pages in this HYDLNK account: id, name, handle, public address and url, custom domains with their status, publishStatus (published, unpublished-changes or not-published) and when each page was last published. Also returns the plan and how many pages it allows. Call this first to get a pageId for the other tools. It reads only and changes nothing. Errors: account_suspended, rate_limited.",
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "none",
  async handler(_args, call) {
    let pages, plan, domains, themes;
    try {
      [pages, plan] = await Promise.all([
        listOwnedPages(call.admin, call.userId),
        loadAccountPlan(call.admin, call.userId),
      ]);
      [domains, themes] = await Promise.all([
        listPageDomains(
          call.admin,
          pages.map((page) => page.id),
        ),
        listUsableThemes(call.admin, call.userId),
      ]);
    } catch (error) {
      if (error instanceof PageReadError)
        throw new ToolFailure("server_error", MESSAGES.serverError);
      throw error;
    }

    const rows = pages.map((page) => {
      const draft = readDraft(page.draft);
      const theme = draft?.theme.ref ? themes.find((row) => row.id === draft.theme.ref) : undefined;
      const publishStatus = draft
        ? publishStatusOf({
            draft,
            published: page.published,
            publishedAt: page.publishedAt,
            themeTokens: theme?.tokens ?? null,
          })
        : page.publishedAt
          ? "unpublished-changes"
          : "not-published";
      return {
        id: page.id,
        name: page.name,
        handle: page.handle,
        address: handleAddress(page.handle),
        url: tenantOrigin(page.handle),
        customDomains: domains
          .filter((domain) => domain.pageId === page.id)
          .map((domain) => ({ hostname: domain.hostname, status: domain.status })),
        publishStatus,
        publishedAt: page.publishedAt,
        updatedAt: page.updatedAt,
      };
    });

    const count = rows.length;
    const list = rows
      .map(
        (row) => `${row.address} (${STATUS_WORDS[row.publishStatus as keyof typeof STATUS_WORDS]})`,
      )
      .join(", ");
    return {
      sentence:
        count === 0
          ? "You have no pages yet."
          : `You have ${count} ${count === 1 ? "page" : "pages"}: ${list}.`,
      data: {
        account: { plan, pagesUsed: count, pagesAllowed: PLAN_LIMITS[plan].pages },
        pages: rows,
      },
    };
  },
};
