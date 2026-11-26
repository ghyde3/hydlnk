import type { EntrySummary, TermSummary, TypeSummary } from "@/lib/content";
import type { RevisionSummary } from "@/lib/content";
import type { PostEntry } from "./routes-core";

/**
 * The browser side of the Posts routes (M16-12 to M16-15): one small fetch per route under
 * /api/pages/{site}/, the answer read as the route's `{kind, ...}` body. Nothing here throws: a
 * network failure or an answer that is not JSON is `{kind: "error"}`. Types only are imported from
 * the server modules.
 */

export interface FieldIssue {
  path: string;
  message: string;
}

export type Refused =
  | { kind: "unauthorized" }
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string; issues: FieldIssue[] }
  | { kind: "slug"; message: string }
  | { kind: "path"; message: string }
  | { kind: "limit"; message: string }
  | { kind: "suspended"; message: string }
  | { kind: "blocked"; hosts: string[] }
  | { kind: "too-large" }
  | { kind: "storage-full" }
  | { kind: "error" };

type Ok<T> = { kind: "ok" } & T;
export type Answer<T> = Ok<T> | Refused;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function issuesOf(value: unknown): FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((issue) => ({ path: text(issue.path), message: text(issue.message) }))
    .filter((issue) => issue.message !== "");
}

function refusal(status: number, body: unknown): Refused {
  if (status === 401) return { kind: "unauthorized" };
  if (!isRecord(body)) return { kind: "error" };
  switch (body.kind) {
    case "missing":
    case "conflict":
    case "too-large":
    case "storage-full":
      return { kind: body.kind };
    case "invalid":
      return { kind: "invalid", message: text(body.message), issues: issuesOf(body.issues) };
    case "slug":
    case "path":
    case "limit":
    case "suspended":
      return { kind: body.kind, message: text(body.message) };
    case "blocked":
      return {
        kind: "blocked",
        hosts: Array.isArray(body.hosts) ? body.hosts.filter((h) => typeof h === "string") : [],
      };
    default:
      return { kind: "error" };
  }
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: "no-store",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    return { kind: "error" };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok && isRecord(json) && json.kind === "ok") return json as Ok<T>;
  return refusal(response.status, json);
}

const base = (siteId: string) => `/api/pages/${encodeURIComponent(siteId)}`;
const entry = (siteId: string, entryId: string) =>
  `${base(siteId)}/entries/${encodeURIComponent(entryId)}`;

export interface TypesAnswer {
  types: TypeSummary[];
  usage: { posts: number; limit: number };
}

export const fetchTypes = (siteId: string) => request<TypesAnswer>("GET", `${base(siteId)}/types`);

export const setPostType = (siteId: string, change: { enabled?: boolean; archivePath?: string }) =>
  request<{ type: TypeSummary }>("POST", `${base(siteId)}/types/post`, change);

export interface PostsQuery {
  status?: string;
  term?: string;
  q?: string;
  sort?: string;
  cursor?: string;
}

export function fetchPosts(siteId: string, query: PostsQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const tail = params.toString();
  return request<{ items: EntrySummary[]; nextCursor: string | null }>(
    "GET",
    `${base(siteId)}/posts${tail === "" ? "" : `?${tail}`}`,
  );
}

export const createPost = (siteId: string, title?: string) =>
  request<{ id: string; rev: number }>("POST", `${base(siteId)}/posts`, title ? { title } : {});

export const fetchPost = (siteId: string, entryId: string) =>
  request<{ entry: PostEntry }>("GET", entry(siteId, entryId));

export const postAction = (
  siteId: string,
  entryId: string,
  action: "publish" | "unpublish" | "trash" | "restore",
  rev: number,
) =>
  request<{ rev: number; publishedAt?: string }>("POST", `${entry(siteId, entryId)}/${action}`, {
    rev,
  });

export const fetchRevisions = (siteId: string, entryId: string) =>
  request<{ revisions: RevisionSummary[] }>("GET", `${entry(siteId, entryId)}/revisions`);

export const restoreRevision = (siteId: string, entryId: string, revision: number, rev: number) =>
  request<{ rev: number }>("POST", `${entry(siteId, entryId)}/revisions/${revision}/restore`, {
    rev,
  });

export const fetchTerms = (siteId: string) =>
  request<{ terms: TermSummary[] }>("GET", `${base(siteId)}/terms`);

export const createTerm = (
  siteId: string,
  term: { taxonomy: "category" | "tag"; name: string; parentId?: string },
) => request<{ term: TermSummary }>("POST", `${base(siteId)}/terms`, term);

export const renameTerm = (siteId: string, termId: string, name: string) =>
  request<{ term: TermSummary }>("PATCH", `${base(siteId)}/terms/${encodeURIComponent(termId)}`, {
    name,
  });

export const deleteTerm = (siteId: string, termId: string) =>
  request<{ id: string }>("DELETE", `${base(siteId)}/terms/${encodeURIComponent(termId)}`);

/** One sentence for a refusal that has none of its own. */
export function refusalMessage(refused: Refused): string {
  switch (refused.kind) {
    case "unauthorized":
      return "You’re signed out. Sign in again to continue.";
    case "missing":
      return "That doesn’t exist any more. Reload the page.";
    case "conflict":
      return "This was changed somewhere else. Reload to see the latest version.";
    case "invalid":
      return refused.issues[0]?.message || refused.message || "That isn’t valid.";
    case "slug":
    case "path":
    case "limit":
    case "suspended":
      return refused.message || "That can’t be done right now.";
    case "blocked":
      return `That links to a site that isn’t allowed${
        refused.hosts.length > 0 ? ` (${refused.hosts.join(", ")})` : ""
      }. Remove the link and try again.`;
    case "too-large":
      return "That is too large to save. Shorten it and try again.";
    case "storage-full":
      return "Your storage is full. Remove some images or upgrade, then try again.";
    default:
      return "Something went wrong. Try again.";
  }
}
