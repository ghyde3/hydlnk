import { z } from "zod";
import {
  LIMITS,
  PHOTO_BORDERS,
  PHOTO_SHAPES,
  PHOTO_SIZES,
  PROFILE_OPTION_MESSAGES,
  publishDocSchema,
  type DraftDoc,
} from "@/lib/document";
import { MCP_SCOPES } from "../constants";
import { patchProfile, profileView, type ProfileChange } from "../doc-view";
import { MESSAGES, ToolFailure, type ToolIssue } from "../errors";
import { commitDraft } from "../commit";
import { createImageResolver } from "../images";
import type { ToolDefinition } from "../types";
import { DRAFT_ONLY, WRITE_IDEMPOTENT, ifRevField, pageIdField } from "./common";

const input = z
  .strictObject({
    pageId: pageIdField,
    ifRev: ifRevField,
    name: z
      .string()
      .max(LIMITS.displayName * 2, { error: `Use ${LIMITS.displayName} characters or fewer.` })
      .optional()
      .describe(`The display name, 1 to ${LIMITS.displayName} characters, on one line.`),
    bio: z
      .string()
      .max(LIMITS.bio * 2, { error: `Use ${LIMITS.bio} characters or fewer.` })
      .optional()
      .describe(`The bio, up to ${LIMITS.bio} characters, on one line. An empty string clears it.`),
    photo: z
      .union([z.strictObject({ imageId: z.string().max(100) }), z.null()])
      .optional()
      .describe(
        "{ imageId } to use a photo that is already on one of your pages, or null to remove the photo.",
      ),
    photoShape: z
      .enum(PHOTO_SHAPES, { error: PROFILE_OPTION_MESSAGES.photoShape })
      .optional()
      .describe("The photo's shape."),
    photoSize: z
      .enum(PHOTO_SIZES, { error: PROFILE_OPTION_MESSAGES.photoSize })
      .optional()
      .describe("The photo's size."),
    photoBorder: z
      .enum(PHOTO_BORDERS, { error: PROFILE_OPTION_MESSAGES.photoBorder })
      .optional()
      .describe("The photo's border. page follows the theme."),
    showPhoto: z
      .boolean({ error: PROFILE_OPTION_MESSAGES.showPhoto })
      .optional()
      .describe("Whether the photo shows on the page."),
    showName: z
      .boolean({ error: PROFILE_OPTION_MESSAGES.showName })
      .optional()
      .describe("Whether the display name shows on the page."),
    showBio: z
      .boolean({ error: PROFILE_OPTION_MESSAGES.showBio })
      .optional()
      .describe("Whether the bio shows on the page."),
  })
  .refine(
    (value) =>
      [
        value.name,
        value.bio,
        value.photo,
        value.photoShape,
        value.photoSize,
        value.photoBorder,
        value.showPhoto,
        value.showName,
        value.showBio,
      ].some((field) => field !== undefined),
    { error: MESSAGES.nothingToChange },
  );

export const updateProfile: ToolDefinition<typeof input> = {
  name: "update_profile",
  title: "Update the profile",
  description: `Changes the page's profile: display name (1 to ${LIMITS.displayName} characters), bio (up to ${LIMITS.bio}), photo (an imageId from get_page, or null to remove it), photo shape, size and border, and whether the photo, name and bio show. Send only what should change. Line breaks become spaces. ${DRAFT_ONLY} Returns the profile and the new rev. Errors: invalid_input, image_not_found, conflict, not_found.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    const resolve = createImageResolver(call.admin, call.userId);
    const change: ProfileChange = {};
    if (args.name !== undefined) change.name = args.name;
    if (args.bio !== undefined) change.bio = args.bio;
    if (args.photo !== undefined) {
      change.photo =
        args.photo === null
          ? null
          : await resolve(args.photo.imageId).then((ref) => ({
              path: ref.path,
              width: ref.width,
              height: ref.height,
            }));
    }
    for (const key of [
      "photoShape",
      "photoSize",
      "photoBorder",
      "showPhoto",
      "showName",
      "showBio",
    ] as const) {
      if (args[key] !== undefined) Object.assign(change, { [key]: args[key] });
    }
    const touched = Object.keys(change);

    const result = await commitDraft(call, args.ifRev, (doc: DraftDoc) => {
      const profile = patchProfile(doc.profile, change);
      const next: DraftDoc = { ...doc, profile };
      // The document's own profile rules, from the Publish schema (a draft keeps an empty name).
      const checked = publishDocSchema.safeParse(next);
      if (!checked.success) {
        const issues: ToolIssue[] = checked.error.issues
          .filter((issue) => issue.path[0] === "profile" && touched.includes(String(issue.path[1])))
          .map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message.slice(0, 200),
          }));
        if (issues.length > 0) {
          throw new ToolFailure("invalid_input", issues[0]!.message, {
            issues: issues.slice(0, 10),
          });
        }
      }
      return { kind: "write", doc: next, value: profile };
    });

    const profile = (result.unchanged ? result.doc.profile : result.value) as DraftDoc["profile"];
    return {
      sentence: result.unchanged
        ? "Nothing changed. Your profile already looked like that."
        : "Updated your profile.",
      data: { profile: profileView(profile), rev: result.rev, unchanged: result.unchanged },
    };
  },
};
