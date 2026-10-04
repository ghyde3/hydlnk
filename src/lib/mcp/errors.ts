import { LIMITS } from "@/lib/document/limits";
import type { McpScope } from "./constants";

/**
 * The sixteen failure codes of a tool call, pinned (M10-22). The activity log stores one of these for
 * a failed call, and every tool answers with one of them and a sentence a person can act on. A code
 * is never a database code, a stack or a path.
 */
export const TOOL_ERROR_CODES = [
  "invalid_input",
  "not_found",
  "block_not_found",
  "conflict",
  "blocked_link",
  "too_large",
  "block_limit",
  "image_not_found",
  "theme_not_found",
  "plan_required",
  "preview_link_limit",
  "publish_refused",
  "insufficient_scope",
  "rate_limited",
  "account_suspended",
  "server_error",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export interface ToolIssue {
  path: string;
  message: string;
}

/** What a failure can carry besides its sentence. */
export interface ToolFailureExtras {
  retryAfterSeconds?: number;
  issues?: ToolIssue[];
  requiredScope?: McpScope;
  /** Extra structured fields for the AI (for example the hosts of a blocked link). */
  details?: Record<string, unknown>;
}

/** Thrown by a tool to refuse with a code. `runTool` shapes it; nothing else ever leaves a tool. */
export class ToolFailure extends Error {
  readonly code: ToolErrorCode;
  readonly extras: ToolFailureExtras;

  constructor(code: ToolErrorCode, message: string, extras: ToolFailureExtras = {}) {
    super(message);
    this.name = "ToolFailure";
    this.code = code;
    this.extras = extras;
  }
}

export const MESSAGES = {
  not_found: "We couldn’t find that page. Call list_pages to see your pages.",
  block_not_found: "No block with that id on this page. Call get_page.",
  conflict: "This page changed while I was working on it. Call get_page again and redo the change.",
  blocked_link: "That site is blocked. Use a different link.",
  too_large: "This page is too large to save. Remove some content, then try again.",
  block_limit: `Pages can have ${LIMITS.blocks} blocks. Remove one first.`,
  image_not_found: "That image isn’t on any of your pages. Upload it in the editor first.",
  imageIsUrl: "Images must already be uploaded. Use an imageId from get_page.",
  serverError: "Something went wrong on our side. Try again.",
  tookTooLong: "This took too long. Try again.",
  draftUnreadable: "This page’s draft can’t be read. Open it in the editor.",
  nothingToChange: "Nothing to change.",
  planFree30: "Free keeps 30 days of numbers. Pro and Studio show up to a year.",
} as const;

/** The plain-words version of what a missing scope would have allowed, for the 'connect it again' sentence. */
const SCOPE_VERBS: Record<McpScope, { verb: string; allow: string }> = {
  "hydlnk.read": { verb: "see your pages", allow: "See your sites, pages and analytics" },
  "hydlnk.write": { verb: "edit your drafts", allow: "Edit your drafts" },
  "hydlnk.publish": { verb: "publish your pages", allow: "Publish your pages" },
};

/** 'This connection can’t publish your pages. In HYDLNK open Settings, remove this app under Connected apps, then connect it again and allow “Publish your pages”.' */
export function insufficientScopeMessage(scope: McpScope): string {
  const { verb, allow } = SCOPE_VERBS[scope];
  return `This connection can’t ${verb}. In HYDLNK open Settings, remove this app under Connected apps, then connect it again and allow “${allow}”.`;
}

export function rateLimitedMessage(seconds: number): string {
  return `You’re going too fast. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

/** `pageId is required. You have 3 pages: call list_pages.` */
export function pageIdRequiredMessage(count: number): string {
  return `pageId is required. You have ${count} pages: call list_pages.`;
}

export function isToolErrorCode(value: unknown): value is ToolErrorCode {
  return (TOOL_ERROR_CODES as readonly unknown[]).includes(value);
}
