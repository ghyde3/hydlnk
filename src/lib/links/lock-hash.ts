import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import {
  LOCK_HASH_PATTERN,
  LOCK_SALT_PATTERN,
  lockCodeError,
  normalizeLockCode,
} from "@/lib/document/lock";

/**
 * The hashing behind a link's code lock (M9-29). Server only: this module imports Node's crypto and
 * is reached from the `hashLinkCode` Server Action (to set a code) and from the click redirect (to
 * check one).
 *
 * scrypt with N 16384, r 8, p 1 and a random 16 byte salt gives a 32 byte hash; both are stored as
 * base64url without padding (22 and 43 characters). The code is normalized first (NFKC, trimmed,
 * lower-cased) in both directions, so 'Spring2026' and 'spring2026 ' are the same code. The plaintext
 * is never stored, logged or put in an error: nothing in here throws with the code in its message.
 */

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };

function derive(code: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(normalizeLockCode(code), salt, KEY_BYTES, SCRYPT, (error, key) => {
      if (error) reject(new Error("The code could not be hashed."));
      else resolve(key);
    });
  });
}

/** The salt and hash of a code, or an error sentence when the code is not allowed (nothing is hashed then). */
export async function hashLockCode(
  code: unknown,
  salt: Buffer = randomBytes(SALT_BYTES),
): Promise<{ ok: true; salt: string; hash: string } | { ok: false; message: string }> {
  const problem = lockCodeError(code);
  if (problem !== null) return { ok: false, message: problem };
  const key = await derive(code as string, salt);
  return { ok: true, salt: salt.toString("base64url"), hash: key.toString("base64url") };
}

/**
 * Whether `code` is the code behind this salt and hash. A code that could never have been set (too
 * long or short, with a space) is refused without running scrypt, so a 1 KB body cannot cost a
 * hash; a malformed salt or hash never matches. The comparison is constant time on equal-length buffers.
 */
export async function verifyLockCode(
  code: unknown,
  lock: { salt: string; hash: string },
): Promise<boolean> {
  if (lockCodeError(code) !== null) return false;
  if (!LOCK_SALT_PATTERN.test(lock.salt) || !LOCK_HASH_PATTERN.test(lock.hash)) return false;
  const salt = Buffer.from(lock.salt, "base64url");
  const expected = Buffer.from(lock.hash, "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await derive(code as string, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
