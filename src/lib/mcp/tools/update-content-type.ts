import { z } from "zod";
import { enableType, updateType, updateTypeAndSwitch } from "@/lib/content";
import type { TypeSummary } from "@/lib/content/schemas/summaries";
import { MCP_SCOPES } from "../constants";
import { cleanLine } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import type { ToolCall, ToolDefinition } from "../types";
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

interface TypeSettings {
  archivePath?: string;
  label?: string;
  labelPlural?: string;
}

/**
 * A call with `enabled` and other fields is all or nothing (M18-10 step 2: "nothing changes"): the
 * content layer's `updateTypeAndSwitch`, the same one the Posts route uses. When the switch is
 * refused and putting the settings back failed too, the answer says what stands.
 */
async function settingsThenSwitch(
  call: ToolCall,
  input: { siteId: string; typeKey: string; settings: TypeSettings; enabled: boolean },
): Promise<TypeSummary> {
  const out = await updateTypeAndSwitch({ actor: mcpActor(call), ...input });
  if (out.ok) return out;
  const failure = await refusal(call, out, { notFoundMessage: TYPE_NOT_FOUND });
  if (!out.settingsStand) throw failure;
  // Rare (the account or the site changed between the two writes): say what stands.
  const stands = `The blog was not turned ${input.enabled ? "on" : "off"}, but its new address or names stand. Call list_content_types.`;
  throw new ToolFailure(failure.code, `${stands} ${failure.message}`, {
    ...failure.extras,
    details: { ...failure.extras.details, settingsApplied: true },
  });
}

export const updateContentTypeTool: ToolDefinition<typeof input> = {
  name: "update_content_type",
  title: "Turn the blog on or off, or move it",
  description:
    "Changes a site's blog setting, and it changes the live site at once, with no publish step: enabled turns the blog on or off, archivePath moves the post list and every post's address, label and labelPlural rename it. Only call it when the person has asked. Turning the blog off takes its pages off the public site and deletes nothing: the posts, drafts and terms are kept and come back when it is turned on. Send only what should change; a call with enabled and other fields changes all of them or none. At most 60 an hour. Returns the type as list_content_types shows it. Errors: invalid_input (on archivePath: not valid, used by a page, or reserved), not_found, account_suspended, insufficient_scope.",
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
    let type: TypeSummary | undefined;
    if (!hasSettings) {
      const switched = await enableType({ actor, siteId, typeKey, enabled: args.enabled! });
      if (!switched.ok) throw await refusal(call, switched, where);
      type = switched;
    } else if (args.enabled === undefined) {
      const updated = await updateType({ actor, siteId, typeKey, ...settings });
      if (!updated.ok) throw await refusal(call, updated, where);
      type = updated;
    } else {
      type = await settingsThenSwitch(call, { siteId, typeKey, settings, enabled: args.enabled });
    }
    const now = type;
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
