import { z } from "zod";
import { enableType, updateType } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import { cleanLine } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT, pageIdField } from "./common";
import { mcpActor, refusal } from "./content-common";

const TYPE_NOT_FOUND = "We couldn’t find that content type. Call list_content_types.";

const input = z.strictObject({
  pageId: pageIdField,
  // A plain string: the page type and an unknown type answer one not_found, as a foreign id does.
  type: z
    .string()
    .max(40)
    .optional()
    .describe("The content type. Only post (the blog) can be changed, and it is the default."),
  enabled: z.boolean().optional().describe("True turns the blog on, false turns it off."),
  archivePath: z
    .string()
    .max(64)
    .optional()
    .describe(
      "The address of the post list on the site, one lower-case word such as blog or news (letters, digits and hyphens). Every post's address starts with it.",
    ),
  label: z
    .string()
    .max(60, { error: "Use 60 characters or fewer." })
    .optional()
    .describe("What one item is called, such as Post. 1 to 60 characters."),
  labelPlural: z
    .string()
    .max(60, { error: "Use 60 characters or fewer." })
    .optional()
    .describe("What the list is called, such as Blog or News. 1 to 60 characters."),
});

export const updateContentTypeTool: ToolDefinition<typeof input> = {
  name: "update_content_type",
  title: "Turn the blog on or off, or move it",
  description:
    "Changes a site's blog setting, and it changes the live site at once, with no publish step: enabled turns the blog on or off, archivePath moves the post list and every post's address, label and labelPlural rename it. Only call it when the person has asked. Turning the blog off takes its pages off the public site and deletes nothing: the posts, drafts and terms are kept and come back when it is turned on. Send only what should change; with enabled and other fields in one call, enabled is applied first and the answer says which step failed. At most 60 an hour. Returns the type as list_content_types shows it. Errors: invalid_input (on archivePath: not valid, used by a page, or reserved), not_found, account_suspended, insufficient_scope.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "one",
  changesLive: true,
  async handler(args, call) {
    const siteId = call.page!.id;
    const typeKey = args.type ?? "post";
    if (typeKey !== "post") throw new ToolFailure("not_found", TYPE_NOT_FOUND);
    const settings = {
      ...(args.archivePath !== undefined ? { archivePath: args.archivePath.trim() } : {}),
      ...(args.label !== undefined ? { label: cleanLine(args.label).trim() } : {}),
      ...(args.labelPlural !== undefined
        ? { labelPlural: cleanLine(args.labelPlural).trim() }
        : {}),
    };
    const hasSettings = Object.keys(settings).length > 0;
    if (args.enabled === undefined && !hasSettings) {
      throw new ToolFailure("invalid_input", MESSAGES.nothingToChange);
    }
    const actor = mcpActor(call);
    const where = { notFoundMessage: TYPE_NOT_FOUND };
    let type;
    if (args.enabled !== undefined) {
      const switched = await enableType({ actor, siteId, typeKey, enabled: args.enabled });
      if (!switched.ok) throw await refusal(call, switched, where);
      type = switched;
    }
    if (hasSettings) {
      const updated = await updateType({ actor, siteId, typeKey, ...settings });
      if (!updated.ok) {
        const failure = await refusal(call, updated, where);
        if (args.enabled === undefined) throw failure;
        // The switch above stands: say so, so the AI does not repeat it or assume it failed. An
        // invalid_input is worded from its issues, so the sentence goes there too.
        const stands = `The blog was turned ${args.enabled ? "on" : "off"}, but the other changes were not made.`;
        throw new ToolFailure(failure.code, `${stands} ${failure.message}`, {
          ...failure.extras,
          ...(failure.extras.issues
            ? {
                issues: failure.extras.issues.map((issue) => ({
                  path: issue.path,
                  message: `${stands} ${issue.message}`,
                })),
              }
            : {}),
          details: { ...failure.extras.details, enabledApplied: true },
        });
      }
      type = updated;
    }
    const now = type!;
    return {
      sentence: `The blog is ${now.enabled ? "on" : "off"}${now.archivePath ? `, at /${now.archivePath}` : ""}. This is live now.`,
      data: {
        pageId: siteId,
        type: now.key,
        label: now.label,
        labelPlural: now.labelPlural,
        enabled: now.enabled,
        archivePath: now.archivePath,
      },
      exact: true,
    };
  },
};
