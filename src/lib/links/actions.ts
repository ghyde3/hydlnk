"use server";

import { getSessionUser } from "@/lib/auth/session";
import { hashLinkCodeCore, type HashLinkCodeResult } from "./hash-code";

/**
 * `hashLinkCode(code)`: the Server Action behind the editor's 'Set code' button (M9-30). It is the
 * one place a plaintext lock code travels, from the browser to here in a single request, and it
 * answers `{salt, hash}`; the editor writes those into the draft and forgets the code. See
 * ./hash-code.ts for the rules.
 */
export async function hashLinkCode(code: string): Promise<HashLinkCodeResult> {
  const user = await getSessionUser();
  return hashLinkCodeCore({ userId: user?.id ?? null, code });
}
