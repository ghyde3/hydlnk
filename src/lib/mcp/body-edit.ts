/**
 * Exact find and replace on a post body (M18-05). Pure. The steps run in order on the result of the
 * step before; a `find` must match exactly once unless `all` is true, and a step that matches zero
 * times, or more than once without `all`, stops everything: nothing is applied. Each step is one
 * scan of the body, so twenty steps on a full body stay linear.
 */

export interface BodyEdit {
  find: string;
  replace: string;
  all?: boolean | undefined;
}

export type BodyEditResult =
  { ok: true; body: string } | { ok: false; index: number; matches: number };

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

export function applyBodyEdits(body: string, edits: readonly BodyEdit[]): BodyEditResult {
  let next = body;
  for (const [index, edit] of edits.entries()) {
    const matches = countMatches(next, edit.find);
    if (matches === 0 || (matches > 1 && edit.all !== true)) return { ok: false, index, matches };
    // split and join: the replacement is taken literally (no `$1`, no `$&`).
    next = next.split(edit.find).join(edit.replace);
  }
  return { ok: true, body: next };
}
