import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyDraft } from "@/lib/document";
import { makeOwner, type TestOwner } from "./publish-support";

/**
 * Shared setup for the team-access wave's tests against the local stack (Wave F): a Studio owner with
 * a site S (and a second site S2), and members joined the way production joins them, through
 * create_site_invite and accept_site_invite with a hashed token.
 */

export interface TeamFixture {
  owner: TestOwner;
  /** The owner's second site (no member). */
  s2: string;
  editor: TestOwner;
  publisher: TestOwner;
  stranger: TestOwner;
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Invites `member` to `siteId` as `role` and accepts it as them. */
export async function join(
  admin: SupabaseClient,
  owner: TestOwner,
  siteId: string,
  member: TestOwner,
  role: "editor" | "publisher",
): Promise<void> {
  const hash = tokenHash(randomBytes(32).toString("base64url"));
  const invite = await admin.rpc("create_site_invite", {
    p_site: siteId,
    p_actor: owner.userId,
    p_email: member.email,
    p_token_hash: hash,
    p_role: role,
  });
  if (invite.error) throw new Error(`create_site_invite: ${invite.error.message}`);
  const accepted = await admin.rpc("accept_site_invite", { p_token_hash: hash, p_user: member.userId });
  if (accepted.error) throw new Error(`accept_site_invite: ${accepted.error.message}`);
}

export async function teamFixture(admin: SupabaseClient, label: string): Promise<TeamFixture> {
  const owner = await makeOwner(admin, `${label}o`, undefined, "studio");
  const second = await admin
    .from("pages")
    .insert({ owner_id: owner.userId, handle: `${owner.handle}-2`, draft: emptyDraft(`${owner.handle}-2`) as never })
    .select("id")
    .single();
  if (second.error) throw new Error(`second site: ${second.error.message}`);
  const [editor, publisher, stranger] = await Promise.all([
    makeOwner(admin, `${label}e`),
    makeOwner(admin, `${label}p`),
    makeOwner(admin, `${label}x`),
  ]);
  await join(admin, owner, owner.pageId, editor, "editor");
  await join(admin, owner, owner.pageId, publisher, "publisher");
  return { owner, s2: second.data.id as string, editor, publisher, stranger };
}

export const fixtureUsers = (f: TeamFixture): TestOwner[] => [f.owner, f.editor, f.publisher, f.stranger];
