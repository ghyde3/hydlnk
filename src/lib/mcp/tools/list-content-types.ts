import { z } from "zod";
import { countEntries, listTypes } from "@/lib/content";
import { PLAN_LIMITS } from "@/lib/limits";
import { MCP_SCOPES } from "../constants";
import { MESSAGES, ToolFailure } from "../errors";
import { PageReadError, loadAccountPlan } from "../page-access";
import type { ToolDefinition } from "../types";
import { READ_ONLY, pageIdField } from "./common";
import { mcpActor, refusal } from "./content-common";

const input = z.strictObject({ pageId: pageIdField });

export const listContentTypes: ToolDefinition<typeof input> = {
  name: "list_content_types",
  title: "List content types",
  description:
    "Lists what a site can hold besides pages. Today that is the blog: type post, with enabled (the blog is on or off), archivePath (the address of the post list, such as blog), label and labelPlural, and entries: used (posts the site holds, drafts and the trash included) and max (the plan's limit). A blog that is off still keeps its posts, and they can be read. Turn the blog on or move it with update_content_type. Posts are listed with list_entries. Errors: not_found.",
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "one",
  async handler(_args, call) {
    const actor = mcpActor(call);
    const siteId = call.page!.id;
    const found = await listTypes({ actor, siteId });
    if (!found.ok) throw await refusal(call, found, { notFoundMessage: MESSAGES.not_found });
    let max: number;
    try {
      max = PLAN_LIMITS[await loadAccountPlan(call.admin, call.userId)].entriesPerType;
    } catch (error) {
      if (error instanceof PageReadError)
        throw new ToolFailure("server_error", MESSAGES.serverError);
      throw error;
    }
    const types = [];
    for (const type of found.types.filter((item) => item.key !== "page")) {
      const count = await countEntries({ actor, siteId, typeKey: type.key });
      if (!count.ok) throw await refusal(call, count, { notFoundMessage: MESSAGES.not_found });
      types.push({
        type: type.key,
        label: type.label,
        labelPlural: type.labelPlural,
        enabled: type.enabled,
        archivePath: type.archivePath,
        entries: { used: count.count, max },
      });
    }
    const blog = types.find((item) => item.type === "post");
    return {
      sentence: blog
        ? `The blog is ${blog.enabled ? "on" : "off"}: ${blog.entries.used} of ${blog.entries.max} posts.`
        : "This site has no content types besides pages.",
      data: { pageId: siteId, types },
      exact: true,
    };
  },
};
