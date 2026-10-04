import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import type { McpScope } from "./constants";
import type { ToolFailureInfo, ToolSuccess } from "./result";

/** The secret-key client the tools' data layer uses. Tool modules never import the client itself. */
export type AdminClient = SupabaseClient<Database>;

/** The four hints on every tool; all four are always set because a client reads a missing one as true. */
export interface ToolAnnotationSet {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

/** A page the caller owns, as the one page lookup (`loadOwnedPage`) returns it. */
export interface OwnedPage {
  id: string;
  name: string;
  handle: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** Only when the tool asked for the draft (`needsDraft`). */
  draft?: unknown;
  published?: unknown;
}

export type LoadPageResult =
  { ok: true; page: OwnedPage } | { ok: false; failure: ToolFailureInfo };

export interface RateVerdict {
  allowed: boolean;
  retryAfter: number;
}

export interface ActivityRow {
  userId: string;
  clientId: string;
  grantId: string | null;
  tokenId: string;
  tool: string;
  pageId: string | null;
  ok: boolean;
  errorCode: string | null;
}

/** Everything `runTool` and the tools reach outside the process through, injected so tests can spy. */
export interface ToolDeps {
  admin: AdminClient;
  limit: (key: string, limit: number, windowSeconds: number) => Promise<RateVerdict>;
  /** Is the account suspended right now, read fresh? A failed read throws. */
  isSuspended: (userId: string) => Promise<boolean>;
  loadPage: (
    userId: string,
    pageId: string | undefined,
    options: { withDraft: boolean },
  ) => Promise<LoadPageResult>;
  recordActivity: (row: ActivityRow) => Promise<void>;
  /** Runs work after the response (`after()` in production). */
  defer: (work: () => Promise<unknown> | unknown) => void;
  now: () => Date;
  /** One log line; the tool name and a short code only. */
  log: (line: string) => void;
  /** The RFC 9728 metadata URL named in a missing-scope challenge. */
  resourceMetadataUrl: string;
  timeoutMs?: number;
}

/** Who is calling, taken from the verified token and from nowhere else. */
export interface ToolIdentity {
  userId: string;
  clientId: string;
  grantId: string | null;
  tokenId: string;
  scopes: readonly string[];
}

/** What a tool's handler receives besides its arguments. */
export interface ToolCall extends ToolIdentity {
  admin: AdminClient;
  /** The caller's page, resolved and ownership-checked, for a tool that works on one; else null. */
  page: OwnedPage | null;
  deps: ToolDeps;
  defer: ToolDeps["defer"];
  now: () => Date;
}

export interface ToolDefinition<Schema extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  annotations: ToolAnnotationSet;
  input: Schema;
  /** `none`: the tool does not work on one page. `one`: `pageId`, or the only page the account has. */
  page: "none" | "one";
  /** The tool reads the draft (and the published page) of the page it works on. */
  needsDraft?: boolean;
  handler: (args: z.output<Schema>, call: ToolCall) => Promise<ToolSuccess>;
}

/** A tool as stored in the registry: its schema is erased so one list can hold all twelve. */
export type AnyToolDefinition = ToolDefinition<z.ZodType>;

export type { ToolFailureInfo, ToolSuccess };
