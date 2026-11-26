import "server-only";
import { isEmailAddress } from "@/lib/document";
import { serverEmailEnv } from "@/lib/domains/email-env";
import { sendMessage, type OutgoingMessage } from "@/lib/domains/email";
import { clientEnv } from "@/lib/env/client";
import { toPlanId, type PlanId } from "@/lib/limits";
import { rateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/routing/urls";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { AUDIENCE_PATH } from "./contract";
import { limitEmailContent, messageEmailContent } from "./email-content";

/**
 * The owner emails of the forms wave, sent after the visitor's answer (submit.ts, step 15):
 *
 *   message  a contact form with "Email me each message" on: the message to the ACCOUNT'S OWN sign-in
 *            address (read with the secret key; a block can name no other recipient), with the
 *            visitor's address as Reply-To and nowhere else in a header. At most 30 an hour per
 *            account (`form-notify:{ownerId}`); past that the message is stored and no email goes.
 *   limit    the first refusal of a month (`over_limit_first`, which the database answers once per
 *            account and month): one email with the plan's numbers and no visitor text.
 *
 * Both never throw: a failure logs a constant line (no address, no content) and never reaches the
 * visitor. SMTP when SMTP_HOST is set, Mailpit locally, skipped on a deployment without SMTP.
 */

export const NOTIFY_LIMIT = 30;
export const NOTIFY_WINDOW_SECONDS = 3600;

export interface MessageNotice {
  ownerId: string;
  handle: string;
  formTitle: string;
  name: string;
  email: string;
  message: string;
}

export interface NotifyDeps {
  /** The account's sign-in address and plan, or null when the account is gone. */
  owner: (ownerId: string) => Promise<{ email: string; plan: PlanId } | null>;
  rateLimit: (key: string, limit: number, windowSeconds: number) => Promise<RateLimitResult>;
  send: (message: OutgoingMessage) => Promise<"sent" | "skipped">;
  rootDomain: string;
  log: (line: string) => void;
}

async function readOwner(ownerId: string): Promise<{ email: string; plan: PlanId } | null> {
  const admin = createAdminSupabase();
  const [user, account] = await Promise.all([
    admin.auth.admin.getUserById(ownerId),
    admin.from("accounts").select("plan").eq("id", ownerId).maybeSingle(),
  ]);
  if (user.error) throw new Error(`reading the owner failed (${user.error.code ?? "unknown"})`);
  if (account.error)
    throw new Error(`reading the plan failed (${account.error.code ?? "unknown"})`);
  const email = user.data.user?.email;
  return email ? { email, plan: toPlanId(account.data?.plan) } : null;
}

export function notifyDeps(): NotifyDeps {
  return {
    owner: readOwner,
    rateLimit: (key, limit, windowSeconds) => rateLimit(key, limit, windowSeconds),
    send: (message) => sendMessage(message, serverEmailEnv()),
    rootDomain: clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
    log: (line) => console.error(line),
  };
}

const audienceUrl = (rootDomain: string) => `${appOrigin(rootDomain)}${AUDIENCE_PATH}`;

export async function notifyOwnerOfMessage(
  input: MessageNotice,
  deps: NotifyDeps = notifyDeps(),
): Promise<"sent" | "skipped" | "limited"> {
  try {
    const limit = await deps.rateLimit(
      `form-notify:${input.ownerId}`,
      NOTIFY_LIMIT,
      NOTIFY_WINDOW_SECONDS,
    );
    if (!limit.allowed) return "limited";
    const owner = await deps.owner(input.ownerId);
    if (!owner || !isEmailAddress(owner.email)) return "skipped";
    const content = await messageEmailContent({
      formTitle: input.formTitle,
      pageAddress: `${input.handle}.${deps.rootDomain}`,
      name: input.name,
      email: input.email,
      message: input.message,
      audienceUrl: audienceUrl(deps.rootDomain),
    });
    return await deps.send({
      to: owner.email,
      ...content,
      ...(isEmailAddress(input.email) ? { replyTo: input.email } : {}),
    });
  } catch (error) {
    deps.log(`[forms] the message email failed: ${errorName(error)}`);
    return "skipped";
  }
}

export async function notifyOwnerOfLimit(
  input: { ownerId: string },
  deps: NotifyDeps = notifyDeps(),
): Promise<"sent" | "skipped"> {
  try {
    const owner = await deps.owner(input.ownerId);
    if (!owner || !isEmailAddress(owner.email)) return "skipped";
    const content = await limitEmailContent(owner.plan, audienceUrl(deps.rootDomain));
    return await deps.send({ to: owner.email, ...content });
  } catch (error) {
    deps.log(`[forms] the limit email failed: ${errorName(error)}`);
    return "skipped";
  }
}

/** The error's class name only: a transport's message can quote an address. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}
