import "server-only";
import { LOCK_SET_FAILED_MESSAGE } from "@/lib/document/lock";
import { rateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { hashLockCode } from "./lock-hash";

/**
 * Setting a lock's code (M9-30): what `hashLinkCode` (the Server Action, src/lib/links/actions.ts)
 * does once it knows who is asking. Signed-in users only, 20 calls a minute per user, the limiter
 * failing CLOSED (a limiter that cannot count must not hand out free scrypt work). The code is
 * validated first and never stored, logged, put in an error message or returned: the answer is the
 * salt and the hash, or one sentence.
 */

export const HASH_LIMIT = 20;
export const HASH_WINDOW_SECONDS = 60;

export type HashLinkCodeResult =
  { ok: true; salt: string; hash: string } | { ok: false; message: string };

export interface HashLinkCodeDeps {
  rateLimit?: (
    key: string,
    limit: number,
    windowSeconds: number,
    options: { failClosed: true },
  ) => Promise<RateLimitResult>;
  hash?: typeof hashLockCode;
}

export async function hashLinkCodeCore(
  input: { userId: string | null; code: unknown },
  deps: HashLinkCodeDeps = {},
): Promise<HashLinkCodeResult> {
  if (!input.userId) return { ok: false, message: "Sign in again, then try again." };
  const limit = await (deps.rateLimit ?? rateLimit)(
    `link-code:${input.userId}`,
    HASH_LIMIT,
    HASH_WINDOW_SECONDS,
    { failClosed: true },
  );
  if (!limit.allowed) {
    return {
      ok: false,
      message: limit.failed
        ? LOCK_SET_FAILED_MESSAGE
        : "Too many tries. Wait a minute and try again.",
    };
  }
  try {
    return await (deps.hash ?? hashLockCode)(input.code);
  } catch {
    // Never the code in a log: only that hashing could not run.
    console.error("[lock] hashing a code failed");
    return { ok: false, message: LOCK_SET_FAILED_MESSAGE };
  }
}
