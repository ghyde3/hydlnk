import { adminClient } from "../fixtures/auth";
import { insertPage, makeUser, rand, type TestUser } from "../fixtures/data";
import { requireLocalEnv } from "../fixtures/stripe-stub";
import { stubBase, vercelIds } from "../fixtures/vercel-stub";
import { createVercelClient } from "@/lib/domains/vercel-client";
import type { DomainDeps } from "@/lib/domains/deps";
import { sendDomainLiveEmail } from "@/lib/domains/email";

/**
 * Shared setup of the custom-domains server specs (tests/e2e/m4/domains-core-*.spec.ts): users with
 * published pages, `domains` rows written with the secret key (the server-only add path is what the
 * integration spec drives), and the real domain logic wired to the real database and the local
 * Vercel stub, so what is asserted is what production code does, not a copy of it.
 */

/** A hostname no other run uses. `.test` is a reserved TLD: nothing can ever resolve it. */
export const hostnameFor = (label: string): string => `zq-${label}-${rand(6)}.example.test`;

/** A page of `ownerId` with the demo page's content published under `name`. Returns its id. */
export async function publishedPage(
  ownerId: string,
  handle: string,
  name: string,
): Promise<string> {
  const admin = adminClient();
  const mara = await admin.from("pages").select("draft, published").eq("handle", "mara").single();
  if (mara.error) throw new Error(`seed page 'mara' missing: ${mara.error.message}`);
  const rename = (doc: unknown) => {
    const copy = JSON.parse(JSON.stringify(doc));
    copy.profile.name = name;
    return copy;
  };
  return insertPage(ownerId, handle, {
    draft: rename(mara.data.draft),
    published: rename(mara.data.published),
    published_at: new Date().toISOString(),
  });
}

export interface Site {
  user: TestUser;
  pageId: string;
  handle: string;
  name: string;
}

/** A user (plan `studio` unless said otherwise) with one published page. */
export async function makeSite(
  label: string,
  plan: "free" | "pro" | "studio" = "studio",
): Promise<Site> {
  const user = await makeUser(label, { plan });
  const handle = `zq-${label}-${rand(5)}`;
  const name = `Zq ${label} ${rand(4)}`;
  const pageId = await publishedPage(user.id, handle, name);
  return { user, pageId, handle, name };
}

export interface DomainRowInput {
  pageId: string;
  hostname: string;
  status?: "pending" | "verified" | "error";
  createdAt?: string;
}

/** Inserts a `domains` row with the secret key (the way the server does, past the plan limit trigger). */
export async function addDomainRow(input: DomainRowInput): Promise<string> {
  const status = input.status ?? "verified";
  const { data, error } = await adminClient()
    .from("domains")
    .insert({
      page_id: input.pageId,
      hostname: input.hostname,
      status,
      verified_at: status === "verified" ? new Date().toISOString() : null,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`addDomainRow(${input.hostname}) failed: ${error.message}`);
  return data.id as string;
}

export async function domainRowOf(id: string) {
  const { data, error } = await adminClient()
    .from("domains")
    .select("id, page_id, hostname, status, verified_at, last_checked_at, live_email_sent_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`domainRowOf failed: ${error.message}`);
  return data as {
    id: string;
    page_id: string;
    hostname: string;
    status: string;
    verified_at: string | null;
    last_checked_at: string | null;
    live_email_sent_at: string | null;
  } | null;
}

export async function domainRowsFor(hostname: string): Promise<number> {
  const { count, error } = await adminClient()
    .from("domains")
    .select("id", { count: "exact", head: true })
    .eq("hostname", hostname);
  if (error) throw new Error(`domainRowsFor failed: ${error.message}`);
  return count ?? 0;
}

/** Forgets a domain's last check, so the next check is not held back by the cooldown. */
export async function resetCooldown(id: string): Promise<void> {
  const { error } = await adminClient().from("domains").update({ last_checked_at: null }).eq("id", id);
  if (error) throw new Error(`resetCooldown failed: ${error.message}`);
}

/**
 * The domain logic wired to the real database and the local Vercel stub (the same base URL, project
 * and team the dev server uses), with the real email sender (Mailpit locally). `overrides` swaps a
 * dependency (a failing email, a database that errors on insert).
 */
export function realDeps(overrides: Partial<DomainDeps> = {}): DomainDeps & { logs: string[]; expired: string[] } {
  const { project, team } = vercelIds();
  const logs: string[] = [];
  const expired: string[] = [];
  return {
    admin: adminClient() as never,
    vercel: createVercelClient({
      token: requireLocalEnv("VERCEL_API_TOKEN"),
      projectId: project,
      teamId: team,
      baseUrl: stubBase(),
    }),
    expirePage: (pageId) => void expired.push(pageId),
    sendLiveEmail: async ({ to, hostname }) => {
      await sendDomainLiveEmail({ to, hostname }, {});
    },
    rootDomain: "localhost:3000",
    log: (message) => void logs.push(message),
    ...overrides,
    logs,
    expired,
  };
}
