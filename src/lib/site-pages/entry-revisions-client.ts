/**
 * The browser side of a page's revisions (M15-10): the list and Restore, through the two routes
 * under /api/pages/{site}/entries/{entry}/revisions. Never throws: a network failure or an answer
 * that is not JSON is `{kind: "error"}`.
 */
export interface PageRevision {
  rev: number;
  wasPublished: boolean;
  source: string;
  createdAt: string;
}

export type RevisionsAnswer =
  | { kind: "ok"; revisions: PageRevision[] }
  | { kind: "unauthorized" }
  | { kind: "missing" }
  | { kind: "error" };

export type RestoreRevisionAnswer =
  | { kind: "ok"; rev: number; unchanged: boolean }
  | { kind: "conflict" }
  | { kind: "unauthorized" }
  | { kind: "missing" }
  | { kind: "blocked" }
  | { kind: "suspended" }
  | { kind: "error" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const base = (siteId: string, entryId: string) =>
  `/api/pages/${siteId}/entries/${entryId}/revisions`;

export async function fetchPageRevisions(
  siteId: string,
  entryId: string,
): Promise<RevisionsAnswer> {
  let response: Response;
  try {
    response = await fetch(base(siteId, entryId), { cache: "no-store" });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) return { kind: "error" };
  if (body.kind === "missing") return { kind: "missing" };
  if (body.kind !== "ok" || !Array.isArray(body.revisions)) return { kind: "error" };
  const revisions: PageRevision[] = [];
  for (const row of body.revisions) {
    if (!isRecord(row) || typeof row.rev !== "number" || typeof row.createdAt !== "string")
      continue;
    revisions.push({
      rev: row.rev,
      wasPublished: row.wasPublished === true,
      source: typeof row.source === "string" ? row.source : "",
      createdAt: row.createdAt,
    });
  }
  return { kind: "ok", revisions };
}

/** Restore revision `rev` into the page's draft, at `expectedRev` (the entry rev the editor holds). */
export async function restorePageRevision(
  siteId: string,
  entryId: string,
  rev: number,
  expectedRev: number,
): Promise<RestoreRevisionAnswer> {
  let response: Response;
  try {
    response = await fetch(`${base(siteId, entryId)}/${rev}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: expectedRev }),
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
    case "blocked":
    case "suspended":
      return { kind: body.kind };
    default:
      return { kind: "error" };
  }
}
