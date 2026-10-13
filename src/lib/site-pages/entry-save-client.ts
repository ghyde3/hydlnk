/**
 * The browser side of the page-entry save route (1b1-16, 1b1-17): one POST of `{rev, draft}` to
 * /api/pages/{site}/entries/{entry}/draft, with the answer read as the route's `{kind, ...}` body.
 * Home's blocks and every sub-page go through here; the callers map the answer to their own queue's
 * vocabulary. Never throws: a network failure or an answer that is not JSON is `{kind: "error"}`.
 */
export type EntrySaveAnswer =
  | { kind: "ok"; rev: number; unchanged: boolean }
  | { kind: "conflict" }
  | { kind: "missing" }
  | { kind: "too-large" }
  | { kind: "storage-full" }
  | { kind: "blocked"; hosts: string[]; blockIds: string[] }
  | { kind: "unauthorized" }
  | { kind: "invalid" }
  | { kind: "error" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export async function postEntryDraft(
  siteId: string,
  entryId: string,
  rev: number,
  draft: unknown,
): Promise<EntrySaveAnswer> {
  let response: Response;
  try {
    response = await fetch(`/api/pages/${siteId}/entries/${entryId}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev, draft }),
    });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) return { kind: "error" };
  switch (body.kind) {
    case "ok":
      return typeof body.rev === "number"
        ? { kind: "ok", rev: body.rev, unchanged: body.unchanged === true }
        : { kind: "error" };
    case "conflict":
    case "missing":
    case "too-large":
    case "storage-full":
    case "invalid":
      return { kind: body.kind };
    case "blocked":
      return { kind: "blocked", hosts: strings(body.hosts), blockIds: strings(body.blockIds) };
    default:
      return { kind: "error" };
  }
}
