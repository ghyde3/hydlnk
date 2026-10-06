import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOCK_ONLY_ON_LINKS_MESSAGE,
  redirectTargetIssue,
  type PublishDoc,
  type PublishError,
} from "@/lib/document";
import { normalizeRequestHost } from "@/lib/analytics/ingest/host";
import { clientEnv } from "@/lib/env/client";
import { REDIRECT_MODE_MESSAGE, toPlanId, PLAN_LIMITS } from "@/lib/limits";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The Publish rules of Wave K's link fields that the Zod schema cannot judge because they need the
 * raw draft, the account's plan or the page's hosts (M9-29, M9-31). `publishPageCore` runs this on
 * the final publish form, after the schema and before anything is written; every error names its
 * field, and a failed gate writes nothing.
 *
 *   lock      a lock on any block that is not a link is refused (`lock`): the draft schema strips an
 *             unknown key, so this reads the RAW draft. A hidden block is dropped as always.
 *   redirect  the plan must include redirect mode (`redirect`, M9-31: enforced here, on the server,
 *             not by the editor graying out a control), and the target must be a visible, unlocked
 *             link block of the published form whose host is not the page's own (`redirect.linkId`).
 *
 * Reads nothing when the page has no redirect: a page that never used one pays no query for it.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Visible blocks of the raw draft that carry a `lock` although they are not links. */
export function misplacedLockErrors(raw: unknown): PublishError[] {
  const blocks = isRecord(raw) && Array.isArray(raw.blocks) ? raw.blocks : [];
  const errors: PublishError[] = [];
  for (const block of blocks) {
    if (!isRecord(block) || block.visible === false || block.type === "link") continue;
    if (!("lock" in block) || block.lock === undefined) continue;
    errors.push({
      blockId: typeof block.id === "string" ? block.id : null,
      field: "lock",
      message: LOCK_ONLY_ON_LINKS_MESSAGE,
    });
  }
  return errors;
}

/** The hostnames the page answers on: its handle host and its verified custom domains. */
export async function ownHostsOf(
  admin: SupabaseClient<Database>,
  pageId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("pages")
    .select("handle, domains(hostname, status)")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Reading the page's hosts failed: ${error.message}`);
  if (!data) return [];
  const root = normalizeRequestHost(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  const hosts = (data.domains ?? [])
    .filter((domain) => domain.status === "verified")
    .map((domain) => domain.hostname.toLowerCase());
  if (root !== null) hosts.push(`${data.handle.toLowerCase()}.${root}`);
  return hosts;
}

export async function checkLinkRules(
  admin: SupabaseClient<Database>,
  input: { pageId: string; userId: string; form: PublishDoc; raw: unknown },
): Promise<PublishError[]> {
  const errors = misplacedLockErrors(input.raw);
  const redirect = input.form.redirect;
  if (!redirect) return errors;

  const account = await admin.from("accounts").select("plan").eq("id", input.userId).maybeSingle();
  if (account.error) throw new Error(`Reading the plan failed: ${account.error.message}`);
  // An unknown or missing plan reads as Free: the gate fails closed.
  if (!PLAN_LIMITS[toPlanId(account.data?.plan)].redirectMode) {
    errors.push({ blockId: null, field: "redirect", message: REDIRECT_MODE_MESSAGE });
    return errors;
  }

  const issue = redirectTargetIssue(
    input.form.blocks,
    redirect.linkId,
    await ownHostsOf(admin, input.pageId),
  );
  if (issue !== null) errors.push({ blockId: null, field: "redirect.linkId", message: issue });
  return errors;
}
