import type { PublishError } from "@/lib/document";
import { BLOCKED_FIELD_MESSAGE } from "./messages";

/**
 * The Publish half of the link blocklist (M5-03). The database is the one implementation of the
 * rule: `public.blocked_links_in(draft)` is what the `pages` trigger runs on every draft write, and
 * this calls the same function through the secret key, so Publish and autosave can never disagree.
 *
 * `checkBlocklist` is meant to run in the publish gate right after the draft has been read, on the
 * stored draft (never on anything the caller sent), before anything is written:
 *
 *   const blocked = await checkBlocklist(admin, page.data.draft);
 *   if (blocked.errors.length > 0) return refuse("blocked_link", blocked.errors);
 *
 * Each error carries `host`, so the Server Action's answer holds what the editor needs for "Can’t
 * publish. 1 link points to a blocked site: blocked.example. Remove or change it."
 *
 * It throws when the database cannot answer, so the gate fails closed.
 */

/** Why a host is refused. */
export type BlockedReason = "blocked_domain" | "ip_literal" | "single_label" | "unverifiable";

export interface BlockedLink {
  /** The block that holds the link (null when the draft's block has no id). */
  blockId: string | null;
  /** The social icon or grid cell, when the link is inside one. */
  itemId: string | null;
  field: string;
  host: string;
  reason: BlockedReason;
}

/** The part of a Supabase client the check needs, so a test can stand in for it. */
export interface BlocklistRpc {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

/**
 * A publish error for one blocked link: the shape the editor already shows (block, item, field,
 * message) plus the host the link points to, for the Publish banner.
 */
export type BlockedPublishError = PublishError & { host: string };

export interface BlocklistCheck {
  links: BlockedLink[];
  /** The distinct hosts, sorted: for the Publish banner. */
  hosts: string[];
  /** One error per blocked link. */
  errors: BlockedPublishError[];
}

interface Row {
  block_id: string | null;
  item_id: string | null;
  field: string;
  host: string;
  reason: string;
}

const isRow = (value: unknown): value is Row =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Row).host === "string" &&
  typeof (value as Row).field === "string";

export async function findBlockedLinks(
  admin: BlocklistRpc,
  draft: unknown,
): Promise<BlockedLink[]> {
  const { data, error } = await admin.rpc("blocked_links_in", { p_draft: draft });
  if (error) throw new Error(`Checking the link blocklist failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("Checking the link blocklist returned no list.");
  // A row this code cannot read is an error, never "clean": the gate must fail closed.
  if (!data.every(isRow))
    throw new Error("Checking the link blocklist returned an unreadable row.");
  return data.map((row) => ({
    blockId: row.block_id ?? null,
    itemId: row.item_id ?? null,
    field: row.field,
    host: row.host,
    reason: row.reason as BlockedReason,
  }));
}

export function toPublishErrors(links: readonly BlockedLink[]): BlockedPublishError[] {
  return links.map((link) => ({
    blockId: link.blockId,
    ...(link.itemId ? { itemId: link.itemId } : {}),
    field: link.field,
    message: BLOCKED_FIELD_MESSAGE,
    host: link.host,
  }));
}

/**
 * The distinct hosts named by the blocklist errors of a failed Publish (empty for any other error),
 * sorted: the editor reads them to write the banner (`blockedPublishMessage`).
 */
export function blockedHostsOf(errors: readonly object[]): string[] {
  const hosts = errors.flatMap((error) => {
    const host = (error as { host?: unknown }).host;
    return typeof host === "string" ? [host] : [];
  });
  return [...new Set(hosts)].sort();
}

export async function checkBlocklist(admin: BlocklistRpc, draft: unknown): Promise<BlocklistCheck> {
  const links = await findBlockedLinks(admin, draft);
  return {
    links,
    hosts: [...new Set(links.map((link) => link.host))].sort(),
    errors: toPublishErrors(links),
  };
}
