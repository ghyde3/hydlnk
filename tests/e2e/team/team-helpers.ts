import { createHash, randomBytes } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { makeUser, signIn, signedInUser, type SignedInUser, type TestUser } from "../fixtures/data";
import { url } from "../helpers";

/**
 * Fixtures for the team-access specs (Wave F, M19). The owner is a Studio account with a published
 * site; members join the way production joins them (create_site_invite, accept_site_invite with a
 * hashed token), so the specs exercise the screens, not the setup.
 */

export async function studioOwner(context: BrowserContext, label: string): Promise<SignedInUser> {
  const owner = await signedInUser(context, { label, plan: "studio" });
  return owner;
}

/** A confirmed account with no site of its own, joined to `siteId` as `role`. */
export async function memberOf(
  owner: SignedInUser,
  role: "editor" | "publisher",
  label: string,
): Promise<TestUser> {
  const member = await makeUser(label);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const admin = adminClient();
  const made = await admin.rpc("create_site_invite", {
    p_site: owner.pageId,
    p_actor: owner.userId,
    p_email: member.email,
    p_token_hash: hash,
    p_role: role,
  });
  if (made.error) throw new Error(`create_site_invite: ${made.error.message}`);
  const joined = await admin.rpc("accept_site_invite", { p_token_hash: hash, p_user: member.id });
  if (joined.error) throw new Error(`accept_site_invite: ${joined.error.message}`);
  return member;
}

export async function signInMember(context: BrowserContext, member: TestUser): Promise<void> {
  await signIn(context, member.email);
}

export async function removeMember(owner: SignedInUser, member: TestUser): Promise<void> {
  const { error } = await adminClient().rpc("remove_site_member", {
    p_site: owner.pageId,
    p_actor: owner.userId,
    p_user: member.id,
  });
  if (error) throw new Error(`remove_site_member: ${error.message}`);
}

/** Opens a screen on the app host. */
export async function openApp(page: Page, path: string): Promise<void> {
  await page.goto(url("app", path));
}

/** Every visible control of the region is at least 44px in both dimensions (the HYDLNK floor). */
export async function expectControlsAtLeast44(page: Page, selector: string): Promise<void> {
  const small = await page.locator(`${selector} :is(button, input, select, a)`).evaluateAll((nodes) =>
    nodes
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => {
        const box = node.getBoundingClientRect();
        return { tag: node.tagName, text: node.textContent?.trim().slice(0, 30), w: box.width, h: box.height };
      })
      .filter((box) => box.w < 44 || box.h < 44),
  );
  expect(small).toEqual([]);
}
