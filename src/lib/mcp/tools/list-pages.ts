import { z } from "zod";
import { resolveNav } from "@/lib/document";
import { PLAN_LIMITS } from "@/lib/limits";
import { handleAddress } from "@/lib/pages/plans";
import { orderSitePages } from "@/lib/site-pages/pages";
import { tenantOrigin } from "@/lib/publish/urls";
import { MCP_LIST_SUB_PAGES_MAX, MCP_SCOPES } from "../constants";
import { publishStatusOf, readDraft } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import {
  listOwnedPages,
  listPageDomains,
  listSubPageSummaries,
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
    "Lists the sites in this HYDLNK account: id, name, handle, public address and url, custom domains with their status, publishStatus of Home (published, unpublished-changes or not-published) and when it was last published. Each site also lists its pages: Home first (id home), then the others in menu order, each with id, title, path, inMenu and live (it has been published). Use a page's id as subPageId in get_page and the block tools; leave subPageId out for Home. Also returns the plan and how many sites and how many pages per site it allows. Call this first to get a pageId for the other tools. It reads only and changes nothing. Errors: account_suspended, rate_limited.",
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "none",
  async handler(_args, call) {
    let pages, plan, domains, themes, subPages;
    try {
      [pages, plan] = await Promise.all([
        listOwnedPages(call.admin, call.userId),
        loadAccountPlan(call.admin, call.userId),
      ]);
      [domains, themes, subPages] = await Promise.all([
        listPageDomains(
          call.admin,
          pages.map((page) => page.id),
        ),
        listUsableThemes(call.admin, call.userId),
        listSubPageSummaries(
          call.admin,
          call.userId,
          pages.map((page) => page.id),
        ),
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
      const mine = subPages.filter((row) => row.siteId === page.id);
      const ordered = orderSitePages(
        "Home",
        draft?.nav,
        mine.map((row) => ({
          id: row.id,
          title: row.title,
          path: row.path,
          livePath: row.livePath,
          createdAt: row.createdAt,
        })),
      );
      const liveIds = new Set(mine.filter((row) => row.livePath !== null).map((row) => row.id));
      const inMenuIds = new Set(resolveNav(draft?.nav).items);
      const sitePages = ordered.slice(0, MCP_LIST_SUB_PAGES_MAX + 1).map((item) =>
        item.home
          ? {
              id: "home",
              title: "Home",
              path: "/",
              inMenu: true,
              live: page.publishedAt !== null,
            }
          : {
              id: item.id,
              title: item.title,
              path: item.path,
              inMenu: inMenuIds.has(item.id),
              live: liveIds.has(item.id),
            },
      );
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
        pageCount: ordered.length,
        pages: sitePages,
        ...(ordered.length > sitePages.length ? { morePagesNotListed: true } : {}),
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
        account: {
          plan,
          pagesUsed: count,
          pagesAllowed: PLAN_LIMITS[plan].pages,
          pagesPerSiteAllowed: PLAN_LIMITS[plan].pagesPerSite,
        },
        pages: rows,
      },
    };
  },
};
