import { z } from "zod";
import { BLOCK_ID_PATTERN } from "./ids";
import {
  LOCK_HASH_PATTERN,
  LOCK_KIND_MESSAGE,
  LOCK_SALT_PATTERN,
  LOCK_SET_CODE_MESSAGE,
  type LockKind,
} from "./lock";
import { REDIRECT_PICK_MESSAGE } from "./redirect";
import { UTM_DRAFT_MAX, UTM_LENGTH_MESSAGE, utmValueError } from "./utm";

/**
 * The Zod rules of the Wave K link fields that are not a block of their own: UTM tags (M9-27),
 * the link lock (M9-29) and redirect mode (M9-31). Each builder takes the schema's mode: a DRAFT is
 * lenient (half-typed content autosaves, a hidden block must not stop Publish) and Publish is
 * strict. The types are the union of both, like the other lenient-or-strict fields in schema.ts.
 *
 * Every key is optional, so `version` stays 1 and a document that never used one parses, publishes
 * and renders exactly as before. Unknown keys inside each object are stripped by Zod.
 */

type Mode = "draft" | "publish";

/** One UTM value: a draft keeps any string up to 100 characters; Publish wants the pattern, 1 to 40. */
function utmValue(mode: Mode) {
  if (mode === "draft") return z.string().max(UTM_DRAFT_MAX, { error: UTM_LENGTH_MESSAGE });
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const message = utmValueError(value);
      if (message !== null) ctx.addIssue({ code: "custom", message });
    });
}

/** The page's default tags: `{source, medium, campaign}`, each optional. */
export function pageUtmSchema(mode: Mode) {
  return z.object({
    source: utmValue(mode).optional(),
    medium: utmValue(mode).optional(),
    campaign: utmValue(mode).optional(),
  });
}

/** A link's own tags: the same three, and `off`. A draft keeps any `off` (a hidden block must not stop Publish). */
export function linkUtmSchema(mode: Mode) {
  return z.object({
    source: utmValue(mode).optional(),
    medium: utmValue(mode).optional(),
    campaign: utmValue(mode).optional(),
    off: (mode === "publish" ? z.boolean() : z.custom<boolean>()).optional(),
  });
}

/**
 * A link's lock. A draft keeps `{kind, salt?, hash?}` with any strings (a code lock with no hash
 * yet autosaves); Publish wants an age check, or a code lock with exactly a 22 and a 43 character
 * base64url salt and hash ('Set a code for this lock.').
 */
export function lockSchema(mode: Mode) {
  if (mode === "draft") {
    return z.object({
      kind: z.custom<LockKind>((value) => typeof value === "string", { error: LOCK_KIND_MESSAGE }),
      salt: z.string().optional(),
      hash: z.string().optional(),
    });
  }
  const part = (pattern: RegExp) =>
    z.string({ error: LOCK_SET_CODE_MESSAGE }).regex(pattern, { error: LOCK_SET_CODE_MESSAGE });
  return z.discriminatedUnion(
    "kind",
    [
      z.object({ kind: z.literal("age") }),
      z.object({
        kind: z.literal("code"),
        salt: part(LOCK_SALT_PATTERN),
        hash: part(LOCK_HASH_PATTERN),
      }),
    ],
    { error: LOCK_KIND_MESSAGE },
  );
}

/**
 * Redirect mode, `{linkId}`: the block whose link the live page answers with. A draft keeps any
 * string (the editor only ever writes an id the select offered); Publish wants the id shape. That
 * the id is a visible, unlocked link block of this page, the plan and the loop rule are the Publish
 * gate's, not the schema's (they need the plan and the page's hosts).
 */
export function redirectSchema(mode: Mode) {
  return z.object({
    linkId:
      mode === "publish"
        ? z
            .string({ error: REDIRECT_PICK_MESSAGE })
            .regex(BLOCK_ID_PATTERN, { error: REDIRECT_PICK_MESSAGE })
        : z.string({ error: REDIRECT_PICK_MESSAGE }),
  });
}
