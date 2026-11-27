import { POST_LIMITS } from "@/lib/content/schemas";

/**
 * Exact find and replace on a post body (M18-05). Pure. The steps run in order on the result of the
 * step before; a `find` must match exactly once unless `all` is true, and a step that matches zero
 * times, or more than once without `all`, stops everything: nothing is applied. Each step is one
 * scan of the body, so twenty steps on a full body stay linear.
 *
 * A step is never built when its result would be longer than the body limit: the length it would
 * have is counted from the matches first (`matches * (replace - find)`), so one short `find` with
 * `all` and a long `replace` cannot build hundreds of megabytes before the size check. A result
 * longer than `POST_LIMITS.bodyBytes` UTF-16 units is over the limit in UTF-8 bytes as well.
 */

export interface BodyEdit {
  find: string;
  replace: string;
  all?: boolean | undefined;
}

export type BodyEditResult =
  | { ok: true; body: string }
  | { ok: false; index: number; matches: number; tooLarge?: false }
  | { ok: false; index: number; matches: number; tooLarge: true };

/** How many times `find` occurs in `body`, counting from left to right without overlap. */
function countMatches(body: string, find: string): number {
  if (find === "") return 0;
  let count = 0;
  let from = body.indexOf(find);
  while (from !== -1) {
    count += 1;
    from = body.indexOf(find, from + find.length);
  }
  return count;
}

export function applyBodyEdits(
  body: string,
  edits: readonly BodyEdit[],
  maxLength: number = POST_LIMITS.bodyBytes,
): BodyEditResult {
  let next = body;
  for (const [index, edit] of edits.entries()) {
    const matches = countMatches(next, edit.find);
    if (matches === 0 || (matches > 1 && edit.all !== true)) return { ok: false, index, matches };
    const projected = next.length + matches * (edit.replace.length - edit.find.length);
    if (projected > maxLength) return { ok: false, index, matches, tooLarge: true };
    // split and join: the replacement is taken literally (no `$1`, no `$&`).
    next = next.split(edit.find).join(edit.replace);
  }
  return { ok: true, body: next };
}
