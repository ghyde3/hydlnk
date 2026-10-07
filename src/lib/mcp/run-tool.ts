import type { z } from "zod";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/admin/suspension";
import {
  MCP_PUBLISH_PER_HOUR,
  MCP_TOKEN_PER_MINUTE,
  MCP_TOOL_TIMEOUT_MS,
  MCP_USER_PER_HOUR,
  MCP_USER_PER_MINUTE,
} from "./constants";
import {
  MESSAGES,
  ToolFailure,
  type ToolIssue,
  insufficientScopeMessage,
  rateLimitedMessage,
  type ToolErrorCode,
} from "./errors";
import {
  boundIssues,
  failureResult,
  serverFailure,
  successResult,
  type ToolFailureInfo,
  type ToolResult,
} from "./result";
import type { AnyToolDefinition, ToolCall, ToolDeps, ToolIdentity } from "./types";

/**
 * The one door every tool call goes through (M10-22). The order is the contract, and a Vitest with
 * spies proves it:
 *
 *   1. the token's scopes include the tool's scope;
 *   2. the rate limits (per person, per token, and the publish limit);
 *   3. the account is not suspended (read fresh, closed on a failed read);
 *   4. the input parses with the tool's schema;
 *   5. the page is loaded and checked for ownership (and the sub-page it names, under that page);
 *   6. the handler runs (cut off after 25 seconds);
 *   7. one activity row is written, after the response (a rate_limited refusal at most once a minute
 *      per token);
 *   8. the result is shaped.
 *
 * Nothing thrown by a handler reaches the SDK: the SDK would put the message into the answer, and a
 * message may hold a path or a token. Everything unexpected becomes `server_error` and a log line of
 * the tool name and the code.
 */

class TimedOut extends Error {}

function logLine(tool: string, ok: boolean, code: string | null): string {
  return ok
    ? `[mcp] tool=${tool} ok=true`
    : `[mcp] tool=${tool} ok=false code=${code ?? "unknown"}`;
}

/** The zod issue path as the AI sees it: `fields.url`, `blocks[2].label`. */
function pathText(path: readonly PropertyKey[]): string {
  let text = "";
  for (const part of path) {
    if (typeof part === "number") text += `[${part}]`;
    else text += text === "" ? String(part) : `.${String(part)}`;
  }
  return text;
}

/** The value at `path` inside `input`, or undefined. */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = input;
  for (const part of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<PropertyKey, unknown>)[part];
  }
  return node;
}

/** At most 80 characters of a value, so an issue never echoes a long input back. */
function shortValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const cut = Array.from(text ?? "");
  return cut.length > 80 ? `${cut.slice(0, 80).join("")}…` : cut.join("");
}

/** A zod error as `invalid_input`: at most 10 issues, plain wording, no raw zod text. */
export function invalidInputFailure(
  error: z.ZodError,
  input?: unknown,
): ToolFailureInfo & { code: "invalid_input" } {
  const issues = error.issues.map((issue) => {
    let message = issue.message;
    if (issue.code === "unrecognized_keys") {
      const keys = issue.keys.map((key) => `“${shortValue(key)}”`).join(", ");
      message = `Unknown ${issue.keys.length === 1 ? "field" : "fields"} ${keys}. Check the tool’s description for the names it takes.`;
    } else if (issue.code === "invalid_type") {
      const where = pathText(issue.path) || "The input";
      if (!/^Invalid input/.test(issue.message)) {
        // The schema carries its own words for this field ('Choose on or off.'): use them.
        message = issue.message;
      } else if (valueAt(input, issue.path) === undefined) {
        message = `${where} is required.`;
      } else {
        message = `${where} has the wrong kind of value. Expected ${String((issue as { expected?: unknown }).expected ?? "another type")}.`;
      }
    }
    return { path: pathText(issue.path), message };
  });
  const bounded = boundIssues(issues);
  return {
    code: "invalid_input",
    message: invalidInputMessage(bounded, "That input isn’t valid."),
    issues: bounded,
  };
}

/**
 * The sentence of an `invalid_input`. One issue reads as its own words; several name where each one
 * is, because many clients show the AI only this text and not the list.
 */
export function invalidInputMessage(
  issues: readonly ToolIssue[] | undefined,
  fallback: string,
): string {
  if (!issues || issues.length === 0) return fallback;
  if (issues.length === 1) return issues[0]!.message;
  const shown = issues
    .slice(0, 3)
    .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
    .join(" ");
  return issues.length > 3 ? `${shown} And ${issues.length - 3} more.` : shown;
}

export async function runTool(
  tool: AnyToolDefinition,
  identity: ToolIdentity,
  rawInput: unknown,
  deps: ToolDeps,
): Promise<ToolResult> {
  const fail = (failure: ToolFailureInfo): ToolResult =>
    failureResult(failure, { resourceMetadataUrl: deps.resourceMetadataUrl });
  let pageId: string | null = null;
  let outcome: { ok: true } | { ok: false; code: ToolErrorCode } = { ok: true };
  let result: ToolResult;

  try {
    result = await run();
  } catch (error) {
    // Anything that escapes below is ours and unexpected: say nothing of it.
    result = fail(serverFailure());
    outcome = { ok: false, code: "server_error" };
    void error;
  }

  if (!outcome.ok) deps.log(logLine(tool.name, false, outcome.code));

  // Step 7: the activity row, after the response. A failed insert is logged by code and never
  // changes the result. A rate_limited refusal leaves a row once a minute per token, not once per
  // call: a client that loops on a refused call must not be able to grow the table without bound.
  try {
    deps.defer(async () => {
      try {
        if (!outcome.ok && outcome.code === "rate_limited" && !(await mayLogRefusal(identity))) {
          return;
        }
        await deps.recordActivity({
          userId: identity.userId,
          clientId: identity.clientId,
          grantId: identity.grantId,
          tokenId: identity.tokenId,
          tool: tool.name,
          pageId,
          ok: outcome.ok,
          errorCode: outcome.ok ? null : outcome.code,
        });
      } catch {
        deps.log(`[mcp] activity insert failed tool=${tool.name}`);
      }
    });
  } catch {
    deps.log(`[mcp] activity not scheduled tool=${tool.name}`);
  }
  return result;

  /** The once-a-minute allowance for logging a rate_limited refusal. A limiter that fails allows it. */
  async function mayLogRefusal(who: ToolIdentity): Promise<boolean> {
    try {
      return (await deps.limit(`mcp-rl-log:${who.tokenId}`, 1, 60)).allowed;
    } catch {
      return true;
    }
  }

  async function run(): Promise<ToolResult> {
    const refuse = (failure: ToolFailureInfo): ToolResult => {
      outcome = { ok: false, code: failure.code };
      return fail(failure);
    };

    // 1. Scope.
    if (!identity.scopes.includes(tool.scope)) {
      return refuse({
        code: "insufficient_scope",
        message: insufficientScopeMessage(tool.scope),
        requiredScope: tool.scope,
      });
    }

    // 2. Rate limits. A limiter that fails lets the call through (the limiter logs it itself).
    const limits: Array<[string, number, number]> = [
      [`mcp:${identity.userId}:min`, MCP_USER_PER_MINUTE, 60],
      [`mcp:${identity.userId}:hour`, MCP_USER_PER_HOUR, 3600],
      [`mcp-token:${identity.tokenId}`, MCP_TOKEN_PER_MINUTE, 60],
    ];
    if (tool.name === "publish_page") {
      limits.push([`mcp-publish:${identity.userId}`, MCP_PUBLISH_PER_HOUR, 3600]);
    }
    for (const [key, limit, windowSeconds] of limits) {
      let verdict: { allowed: boolean; retryAfter: number };
      try {
        verdict = await deps.limit(key, limit, windowSeconds);
      } catch {
        deps.log("[mcp] the rate limiter failed; allowing the call");
        continue;
      }
      if (!verdict.allowed) {
        const seconds = Math.max(1, Math.ceil(verdict.retryAfter));
        return refuse({
          code: "rate_limited",
          message: rateLimitedMessage(seconds),
          retryAfterSeconds: seconds,
        });
      }
    }

    // 3. Suspension, read fresh. A failed read refuses the call: closed.
    try {
      if (await deps.isSuspended(identity.userId)) {
        return refuse({ code: "account_suspended", message: ACCOUNT_SUSPENDED_MESSAGE });
      }
    } catch {
      return refuse(serverFailure());
    }

    // 4. Input.
    const parsed = tool.input.safeParse(rawInput ?? {});
    if (!parsed.success) return refuse(invalidInputFailure(parsed.error, rawInput));
    const args = parsed.data as Record<string, unknown>;

    // 5. The page.
    let page: ToolCall["page"] = null;
    let resolvedSubPageId: string | undefined;
    if (tool.page === "one") {
      const requested = typeof args.pageId === "string" ? args.pageId : undefined;
      let loaded;
      try {
        loaded = await deps.loadPage(identity.userId, requested, {
          withDraft: tool.needsDraft === true,
        });
      } catch {
        return refuse(serverFailure());
      }
      if (!loaded.ok) return refuse(loaded.failure);
      page = loaded.page;
      pageId = page.id;
      resolvedSubPageId = loaded.subPageId;
    }

    // 5a. A page id sent as `pageId` (M13-14) means that page for a tool that takes `subPageId`
    // and its site for every other tool. A `subPageId` naming another page contradicts it.
    const takesSubPage = "shape" in tool.input && "subPageId" in (tool.input.shape as object);
    if (page && resolvedSubPageId !== undefined && takesSubPage) {
      const named = args.subPageId;
      if (typeof named === "string" && named.toLowerCase() !== resolvedSubPageId) {
        return refuse({
          code: "invalid_input",
          message: MESSAGES.pageIdContradiction,
          issues: [{ path: "subPageId", message: MESSAGES.pageIdContradiction }],
        });
      }
      args.subPageId = resolvedSubPageId;
    }

    // 5b. The sub-page a tool names with `subPageId` (M12-05), looked up under the site just loaded:
    // a page of another site or account, a random id and a malformed id are one `not_found`.
    // "home" is Home, which is the page itself.
    let subPage: ToolCall["subPage"] = null;
    if (page && typeof args.subPageId === "string" && args.subPageId.toLowerCase() !== "home") {
      let loaded;
      try {
        loaded = await deps.loadSubPage(identity.userId, page.id, args.subPageId, {
          withDraft: tool.needsDraft === true,
        });
      } catch {
        return refuse(serverFailure());
      }
      if (!loaded.ok) return refuse(loaded.failure);
      subPage = loaded.subPage;
    }

    // 6. The handler, cut off after the timeout.
    const call: ToolCall = {
      ...identity,
      admin: deps.admin,
      page,
      subPage,
      deps,
      defer: deps.defer,
      now: deps.now,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = tool.handler(args, call);
      work.catch(() => undefined);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimedOut()), deps.timeoutMs ?? MCP_TOOL_TIMEOUT_MS);
      });
      const success = await Promise.race([work, timeout]);
      return successResult(success);
    } catch (error) {
      if (error instanceof TimedOut) {
        return refuse(serverFailure(MESSAGES.tookTooLong));
      }
      if (error instanceof ToolFailure) {
        const message =
          error.code === "invalid_input"
            ? invalidInputMessage(error.extras.issues, error.message)
            : error.message;
        return refuse({ code: error.code, ...error.extras, message });
      }
      return refuse(serverFailure());
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
