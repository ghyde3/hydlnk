import { MCP_RESULT_MAX_BYTES, MCP_SHORTENED_TEXT_CHARS } from "./constants";
import { MESSAGES, type ToolErrorCode, type ToolFailureExtras, type ToolIssue } from "./errors";

/**
 * How a tool call is answered (M10-22). Success is one short sentence, then the same data as compact
 * JSON, and the data again as `structuredContent` with `ok: true`. A failure is an error result with
 * one sentence and `structuredContent.error` holding the code. Nothing here knows a tool.
 */

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: TextContent[];
  structuredContent: Record<string, unknown>;
  isError?: true;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolSuccess {
  /** One short sentence for the person: 'Added a link block at position 3.' */
  sentence: string;
  /** The data of the result, without `ok`. */
  data: Record<string, unknown>;
}

export interface ToolFailureInfo extends ToolFailureExtras {
  code: ToolErrorCode;
  message: string;
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** `value` with every string longer than `max` cut to `max` characters (and an ellipsis). */
export function shortenStrings(value: unknown, max: number): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (node.length <= max) return node;
      changed = true;
      return `${Array.from(node).slice(0, max).join("")}…`;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    }
    return node;
  };
  return { value: walk(value), changed };
}

export function successResult(
  success: ToolSuccess,
  maxBytes: number = MCP_RESULT_MAX_BYTES,
): ToolResult {
  let data = success.data;
  let sentence = success.sentence;
  if (byteLength(JSON.stringify(data)) > maxBytes) {
    const shortened = shortenStrings(data, MCP_SHORTENED_TEXT_CHARS);
    data = { ...(shortened.value as Record<string, unknown>), truncated: true };
    sentence = `${sentence} Long text was shortened. Ask for one block at a time with blockId to read it in full.`;
  }
  return {
    content: [
      { type: "text", text: sentence },
      { type: "text", text: JSON.stringify(data) },
    ],
    structuredContent: { ok: true, ...data },
  };
}

export interface FailureOptions {
  /** The RFC 9728 metadata URL, for the step-up challenge a missing scope carries (M10-22). */
  resourceMetadataUrl?: string;
}

export function failureResult(failure: ToolFailureInfo, options: FailureOptions = {}): ToolResult {
  const error: Record<string, unknown> = { code: failure.code, message: failure.message };
  if (failure.retryAfterSeconds !== undefined) error.retryAfterSeconds = failure.retryAfterSeconds;
  if (failure.issues && failure.issues.length > 0) error.issues = failure.issues;
  if (failure.requiredScope) error.requiredScope = failure.requiredScope;
  if (failure.details) error.details = failure.details;
  const result: ToolResult = {
    isError: true,
    content: [{ type: "text", text: failure.message }],
    structuredContent: { ok: false, error },
  };
  if (
    failure.code === "insufficient_scope" &&
    failure.requiredScope &&
    options.resourceMetadataUrl
  ) {
    // The form ChatGPT reads to start a step-up sign-in (developers.openai.com/apps-sdk/build/auth).
    result._meta = {
      "mcp/www_authenticate": [
        `Bearer error="insufficient_scope", scope="${failure.requiredScope}", resource_metadata="${options.resourceMetadataUrl}", error_description="${failure.message.replace(/"/g, "'")}"`,
      ],
    };
  }
  return result;
}

/** The generic failure for anything unexpected: no message, stack or path of the real error. */
export function serverFailure(message: string = MESSAGES.serverError): ToolFailureInfo {
  return { code: "server_error", message };
}

/** Keeps at most `limit` issues, each message cut to 200 characters and each path to 120. */
export function boundIssues(issues: ToolIssue[], limit = 10): ToolIssue[] {
  return issues.slice(0, limit).map((issue) => ({
    path: issue.path.slice(0, 120),
    message: issue.message.slice(0, 200),
  }));
}
