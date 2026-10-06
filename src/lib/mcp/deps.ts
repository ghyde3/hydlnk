import "server-only";
import { after } from "next/server";
import { isAccountSuspended } from "@/lib/admin/suspension";
import { clientEnv } from "@/lib/env/client";
import { rateLimit } from "@/lib/rate-limit";
import { protectedResourceMetadataUrl } from "@/lib/oauth/metadata";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { recordActivityRow } from "./activity";
import { loadOwnedPage, loadOwnedSubPage } from "./page-access";
import type { AdminClient, ToolDeps } from "./types";

/**
 * The real dependencies of a tool call. Nothing here is per user or per request: the admin client
 * is stateless, and everything a call needs about a person comes from the verified token.
 */

let admin: AdminClient | null = null;
function adminClient(): AdminClient {
  admin ??= createAdminSupabase();
  return admin;
}

/** Runs `work` after the response; where there is no request to attach it to, it just runs. */
function defer(work: () => Promise<unknown> | unknown): void {
  const run = async () => {
    try {
      await work();
    } catch {
      console.error("[mcp] deferred work failed");
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

export function createToolDeps(): ToolDeps {
  const client = adminClient();
  return {
    admin: client,
    limit: rateLimit,
    isSuspended: isAccountSuspended,
    loadPage: (userId, pageId, options) => loadOwnedPage(client, userId, pageId, options),
    loadSubPage: (userId, siteId, subPageId, options) =>
      loadOwnedSubPage(client, userId, siteId, subPageId, { docs: options.withDraft }),
    recordActivity: (row) => recordActivityRow(client, row),
    defer,
    now: () => new Date(),
    log: (line) => console.log(line),
    resourceMetadataUrl: protectedResourceMetadataUrl(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN),
  };
}
