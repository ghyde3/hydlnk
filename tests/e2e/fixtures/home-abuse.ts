import { isDeepStrictEqual } from "node:util";
import { expect } from "@playwright/test";
import { adminClient, userClient } from "./auth";

/**
 * Hostile block writes on a moved site (after the content cutover). The blocks of Home live in its '/'
 * entry: clients have no write grant on content_entries, and the HL013 guard refuses a client write of
 * `pages.draft` blocks (the frozen copy). So an abuse test does two things:
 *  - `expectClientBlockWriteRefused`: the owner's publishable-key write of pages.draft blocks is refused;
 *  - `writeHomeDraft`: the hostile document is written with the secret key straight into Home's entry,
 *    as an attacker with database access would. The entry's own triggers (blocklist, link marks) still run.
 * Then the test goes on to prove the downstream refusal (the editor, Publish, the renderer).
 */

export async function homeEntryOf(pageId: string) {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("id, rev, draft, published")
    .eq("site_id", pageId)
    .eq("draft->>path", "/")
    .is("deleted_at", null)
    .limit(1);
  if (error) throw new Error(`home entry lookup failed: ${error.message}`);
  if (!data[0]) throw new Error(`site ${pageId} has no Home entry`);
  return data[0] as {
    id: string;
    rev: number | string;
    draft: Record<string, unknown>;
    published: unknown;
  };
}

/** The frozen pages.draft of a site, as the owner would read it. */
async function pagesDraft(pageId: string): Promise<Record<string, unknown>> {
  const { data, error } = await adminClient()
    .from("pages")
    .select("draft")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return data.draft as Record<string, unknown>;
}

/**
 * The owner's publishable-key write of pages.draft blocks is refused with HL013 (the frozen copy),
 * and neither pages.draft nor Home's entry changes.
 */
export async function expectClientBlockWriteRefused(
  token: string,
  pageId: string,
  blocks: unknown[],
): Promise<void> {
  const frozen = await pagesDraft(pageId);
  const entryBefore = await homeEntryOf(pageId);
  // A write that changes nothing is not an attack (a draft the site already holds goes through): the
  // attempt always differs from the frozen copy by one block.
  const attempt = isDeepStrictEqual(frozen.blocks ?? null, blocks)
    ? [...blocks, { id: "dvd-abuse-0001", type: "divider", visible: true }]
    : blocks;
  const { data, error } = await userClient(token)
    .from("pages")
    .update({ draft: { ...frozen, blocks: attempt } })
    .eq("id", pageId)
    .select("id");
  expect(error?.code, "a client write of pages.draft blocks is refused (HL013)").toBe("HL013");
  expect(data ?? []).toHaveLength(0);
  expect(await pagesDraft(pageId)).toEqual(frozen);
  const entryAfter = await homeEntryOf(pageId);
  expect(entryAfter.draft).toEqual(entryBefore.draft);
  expect(Number(entryAfter.rev)).toBe(Number(entryBefore.rev));
}

/**
 * Writes `blocks` (and any other draft fields in `extra`) into Home's entry draft with the secret
 * key, rev + 1. Returns the database error, if any, so a test can assert the entry's triggers.
 */
export async function writeHomeDraft(
  pageId: string,
  blocks: unknown[],
  extra: Record<string, unknown> = {},
) {
  const home = await homeEntryOf(pageId);
  return adminClient()
    .from("content_entries")
    .update({ draft: { ...home.draft, ...extra, blocks } as never, rev: Number(home.rev) + 1 })
    .eq("id", home.id)
    .select("id");
}

/** The two halves for a test that only needs the hostile draft to exist: refused for the client, written for the attacker. */
export async function abuseHomeBlocks(
  token: string,
  pageId: string,
  blocks: unknown[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  await expectClientBlockWriteRefused(token, pageId, blocks);
  const { data, error } = await writeHomeDraft(pageId, blocks, extra);
  expect(error, "the database takes the hostile draft into Home's entry").toBeNull();
  expect(data).toHaveLength(1);
}
