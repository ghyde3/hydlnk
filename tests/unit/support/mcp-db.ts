/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ActivityRow, ToolDeps, ToolIdentity } from "@/lib/mcp/types";
import { loadEnvLocal } from "../publish-support";
import { identity } from "./mcp-fakes";

/**
 * The tools against the real local database (Wave L). `runTool` gets real dependencies for the page
 * lookup, the suspension read and the activity insert, an allow-all limiter (a test that wants a
 * limit passes its own), and a `defer` that collects the work `after()` would run, so a test can
 * flush it and read the activity rows.
 */

export function adminForTests(): SupabaseClient {
  loadEnvLocal();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface Outcome {
  isError: boolean;
  text: string;
  /** The second text item, parsed (a success only). */
  json: Record<string, any> | null;
  structured: Record<string, any>;
  error: {
    code: string;
    message: string;
    issues?: Array<{ path: string; message: string }>;
    retryAfterSeconds?: number;
    requiredScope?: string;
    details?: Record<string, any>;
  } | null;
  meta: Record<string, any> | undefined;
  raw: any;
}

export async function makeRuntime(admin: SupabaseClient, over: Partial<ToolDeps> = {}) {
  const { runTool } = await import("@/lib/mcp/run-tool");
  const { toolByName } = await import("@/lib/mcp/tools");
  const { loadOwnedPage } = await import("@/lib/mcp/page-access");
  const { recordActivityRow } = await import("@/lib/mcp/activity");
  const deferred: Array<() => unknown> = [];
  const logs: string[] = [];
  const activity: ActivityRow[] = [];
  const deps: ToolDeps = {
    admin: admin as never,
    limit: async () => ({ allowed: true, retryAfter: 0 }),
    isSuspended: async (userId) => {
      const { data, error } = await admin
        .from("accounts")
        .select("suspended_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error("read failed");
      return !data || data.suspended_at !== null;
    },
    loadPage: (userId, pageId, options) => loadOwnedPage(admin as never, userId, pageId, options),
    recordActivity: async (row) => {
      activity.push(row);
      await recordActivityRow(admin, row);
    },
    defer: (work) => {
      deferred.push(work);
    },
    now: () => new Date(),
    log: (line) => {
      logs.push(line);
    },
    resourceMetadataUrl: "http://app.localhost:3000/.well-known/oauth-protected-resource/mcp",
    ...over,
  };

  async function call(
    name: string,
    input: unknown,
    who: Partial<ToolIdentity> & { userId: string },
  ): Promise<Outcome> {
    const tool = toolByName(name);
    if (!tool) throw new Error(`no tool ${name}`);
    // No grant row exists for a fake token: the activity row's grant_id stays null.
    const result = (await runTool(tool, identity({ grantId: null, ...who }), input, deps)) as any;
    const content = result.content as Array<{ text: string }>;
    let json: Record<string, any> | null = null;
    if (!result.isError && content[1]) json = JSON.parse(content[1].text);
    return {
      isError: result.isError === true,
      text: content[0]?.text ?? "",
      json,
      structured: result.structuredContent,
      error: result.isError ? result.structuredContent.error : null,
      meta: result._meta,
      raw: result,
    };
  }

  /** Runs what `after()` would run once the response is out: the activity rows and the media cleanup. */
  async function flush() {
    for (const work of deferred.splice(0)) await work();
  }

  return { call, deps, logs, activity, flush, deferred };
}
