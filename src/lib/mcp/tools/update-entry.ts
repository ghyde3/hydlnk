import { z } from "zod";
import { updateEntry } from "@/lib/content";
import { POST_BODY_TOO_LARGE, POST_LIMITS } from "@/lib/content/schemas";
import { applyBodyEdits } from "../body-edit";
import { charCount, contentHash } from "../body-range";
import { MCP_SCOPES } from "../constants";
import { MESSAGES, ToolFailure } from "../errors";
import { bodyOf } from "../post-view";
import { preparePostDraft } from "../post-write";
import type { ToolDefinition } from "../types";
import { WRITE_IDEMPOTENT } from "./common";
import {
  NOT_LIVE_UNTIL_PUBLISH,
  entryIdField,
  entryPageIdField,
  entryRevField,
  mcpActor,
  postFieldInputs,
  refusal,
  requireRev,
  titleInput,
} from "./content-common";

const BODY_EDITS_MAX = 20;
const FIND_MAX = 100_000;
/** A replace longer than the body limit could never be saved. */
const REPLACE_MAX = POST_LIMITS.bodyBytes;
const BOTH = "Send body or bodyEdits, not both.";

const input = z.strictObject({
  entryId: entryIdField,
  pageId: entryPageIdField,
  ifRev: entryRevField,
  title: titleInput.optional(),
  ...postFieldInputs,
  bodyEdits: z
    .array(
      z.strictObject({
        find: z
          .string()
          .min(1, { error: "find can’t be empty." })
          .max(FIND_MAX, { error: `find takes up to ${FIND_MAX} characters.` })
          .describe("The exact text to find in the body, copied from get_entry."),
        replace: z
          .string()
          .max(REPLACE_MAX, { error: `replace takes up to ${REPLACE_MAX} characters.` })
          .describe("What to put in its place. An empty string removes the text."),
        all: z
          .boolean()
          .optional()
          .describe("True replaces every match. Left out, find must match exactly once."),
      }),
    )
    .min(1)
    .max(BODY_EDITS_MAX, { error: `Send up to ${BODY_EDITS_MAX} edits in one call.` })
    .optional()
    .describe(
      `Up to ${BODY_EDITS_MAX} exact find and replace steps on the body, run in order. Use them for a small change to a long body instead of sending body. If one step does not match, nothing is written.`,
    ),
});

export const updateEntryTool: ToolDefinition<typeof input> = {
  name: "update_entry",
  title: "Update a post",
  description: `Changes a post's draft. Send only what should change: title, slug, excerpt, featuredImageId, ogImageId, seoTitle, seoDescription, noindex, categories, tags, and either body (the whole Markdown body) or bodyEdits (exact find and replace steps), never both. Everything left out stays as it is. ${NOT_LIVE_UNTIL_PUBLISH} ifRev is required: when the post changed since you read it the answer is conflict, nothing is written, and you call get_entry again. A find that matches zero times, or more than once without all, writes nothing and names the step. Sending the same change again answers unchanged true. Returns the new rev, bodyChars and contentHash. Errors: conflict, invalid_input, blocked_link, image_not_found, type_disabled, too_large, not_found.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "entry",
  entryTypes: ["post"],
  needsDraft: true,
  async handler(args, call) {
    const entry = call.entry!;
    const { entryId: _entryId, pageId: _pageId, ifRev, bodyEdits, ...fields } = args;
    void _entryId;
    void _pageId;
    requireRev(call, ifRev);
    if (fields.body !== undefined && bodyEdits !== undefined) {
      throw new ToolFailure("invalid_input", BOTH, {
        issues: [{ path: "bodyEdits", message: BOTH }],
      });
    }
    if (bodyEdits === undefined && Object.values(fields).every((value) => value === undefined)) {
      throw new ToolFailure("invalid_input", MESSAGES.nothingToChange);
    }

    let body = fields.body;
    if (bodyEdits !== undefined) {
      const edited = applyBodyEdits(bodyOf(entry.draft), bodyEdits);
      if (!edited.ok && edited.tooLarge) {
        const message = `Step ${edited.index + 1} would make the body larger than 512 KiB. Nothing was changed.`;
        throw new ToolFailure("invalid_input", message, {
          issues: [{ path: "body", message: POST_BODY_TOO_LARGE }],
          details: { step: edited.index + 1 },
        });
      }
      if (!edited.ok) {
        const message =
          edited.matches === 0
            ? `Step ${edited.index + 1}: that text is not in the body. Call get_entry and copy it exactly. Nothing was changed.`
            : `Step ${edited.index + 1}: that text is in the body ${edited.matches} times. Make find longer so it matches once, or set all to true. Nothing was changed.`;
        throw new ToolFailure("invalid_input", message, {
          issues: [{ path: `bodyEdits[${edited.index}].find`, message }],
          details: { step: edited.index + 1, matches: edited.matches },
        });
      }
      body = edited.body;
    }

    const draft = await preparePostDraft(call, entry.siteId, entry.draft, { ...fields, body });
    const saved = await updateEntry({
      actor: mcpActor(call),
      entryId: entry.id,
      expectedRev: ifRev,
      draft,
    });
    if (!saved.ok) throw await refusal(call, saved);
    const stored = bodyOf(draft);
    return {
      sentence: saved.unchanged
        ? "Nothing changed: the draft already holds this."
        : `Saved the post’s draft. ${NOT_LIVE_UNTIL_PUBLISH}`,
      data: {
        id: entry.id,
        pageId: entry.siteId,
        rev: saved.rev,
        unchanged: saved.unchanged,
        slug: typeof draft.slug === "string" ? draft.slug : "",
        bodyChars: charCount(stored),
        contentHash: contentHash(stored),
      },
      exact: true,
    };
  },
};
