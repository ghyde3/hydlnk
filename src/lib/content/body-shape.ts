import { bodyShapeMessage } from "@/lib/blog/markdown";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

/**
 * The bound on a post body's Markdown (M16-13, the attack pass): a body the one bounded lexer
 * refuses (`lexBounded`: its formatting would cost too much to lex, or it nests too deep) is
 * refused at every save and publish, kind `invalid`, with a message on the field `body`. Runs
 * before any other reader of the body (the link and image checks), which then only ever see a body
 * that lexes. Returns null when the body lexes, or when there is no body.
 */
export function bodyShapeIssue(draft: unknown): ContentFailure | null {
  const body = (draft as { body?: unknown } | null)?.body;
  if (typeof body !== "string" || body === "") return null;
  const message = bodyShapeMessage(body);
  if (message === null) return null;
  return { ...failure("invalid"), issues: [{ path: "body", message }] };
}
