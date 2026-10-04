import { codePointLength } from "./limits";

/**
 * The link lock (M9-29, M9-30): a link block may ask visitors for an age check or a code before the
 * redirect goes anywhere. The lock is decided at `/r/...`, on the server: the target URL is never in
 * the page's HTML.
 *
 * This leaf module holds what the schema, the editor, the renderer and the redirect share and nothing
 * secret: the shapes, the patterns, the wording and the code's normal form. The hashing itself needs
 * Node's crypto and lives in `src/lib/links/lock-hash.ts` (server only). The plaintext code is never
 * part of a document: a lock stores a random salt and an scrypt hash.
 */

export const LOCK_KINDS = ["age", "code"] as const;
export type LockKind = (typeof LOCK_KINDS)[number];

/** 16 random bytes, base64url without padding. */
export const LOCK_SALT_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** 32 bytes of scrypt output, base64url without padding. */
export const LOCK_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const LOCK_CODE_MIN = 4;
export const LOCK_CODE_MAX = 32;

export const LOCK_CODE_MESSAGE = "Use 4 to 32 characters with no spaces.";
/** What Publish says about a code lock with no usable hash (and about a shape it does not know). */
export const LOCK_SET_CODE_MESSAGE = "Set a code for this lock.";
export const LOCK_KIND_MESSAGE = "Choose an age check or a code.";
export const LOCK_ONLY_ON_LINKS_MESSAGE = "A lock only works on a link block.";
export const LOCK_SET_FAILED_MESSAGE = "Couldn’t set the code. Try again.";

/** The lock of a draft: lenient, so a half-set lock (a code lock with no hash yet) autosaves. */
export interface DraftLock {
  kind: LockKind;
  salt?: string | undefined;
  hash?: string | undefined;
}

/** The lock of the published form: an age check, or a code with its salt and hash. */
export type PublishedLock = { kind: "age" } | { kind: "code"; salt: string; hash: string };

// Control characters (Cc), format characters such as the bidi overrides, isolates and zero-width
// marks (Cf), and the line and paragraph separators: none may be part of a code.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const WHITESPACE = /\s/u;

/**
 * The code in its one normal form: Unicode NFKC, trimmed, lower-cased. The same function runs when a
 * code is hashed and when a visitor's try is checked, so the comparison ignores case, width and
 * surrounding space ('Spring2026' and 'spring2026 ' are the same code).
 */
export function normalizeLockCode(code: string): string {
  return code.normalize("NFKC").trim().toLowerCase();
}

/**
 * Whether a code may be set: after normalizing, 4 to 32 code points with no whitespace, control or
 * bidi characters. Null when it is fine, else the editor's sentence.
 */
export function lockCodeError(code: unknown): string | null {
  if (typeof code !== "string") return LOCK_CODE_MESSAGE;
  const normal = normalizeLockCode(code);
  const length = codePointLength(normal);
  if (length < LOCK_CODE_MIN || length > LOCK_CODE_MAX) return LOCK_CODE_MESSAGE;
  if (WHITESPACE.test(normal) || HIDDEN.test(normal)) return LOCK_CODE_MESSAGE;
  return null;
}

/** The shape check of a stored code lock: both parts present and exactly the right length. */
export function isLockShape(value: unknown): value is PublishedLock {
  if (typeof value !== "object" || value === null) return false;
  const lock = value as { kind?: unknown; salt?: unknown; hash?: unknown };
  if (lock.kind === "age") return true;
  return (
    lock.kind === "code" &&
    typeof lock.salt === "string" &&
    LOCK_SALT_PATTERN.test(lock.salt) &&
    typeof lock.hash === "string" &&
    LOCK_HASH_PATTERN.test(lock.hash)
  );
}

/**
 * The published form of a draft's lock (M9-29): the age check alone, or the code lock with its salt
 * and hash, and `undefined` (no `lock` key at all) for anything else, so a page with no lock
 * publishes the same bytes as before. A code lock with a missing or malformed hash is not written:
 * the Publish gate refuses it first ('Set a code for this lock.').
 */
export function publishLock(lock: unknown): PublishedLock | undefined {
  if (typeof lock !== "object" || lock === null) return undefined;
  const value = lock as { kind?: unknown; salt?: unknown; hash?: unknown };
  if (value.kind === "age") return { kind: "age" };
  if (isLockShape(value) && value.kind === "code") {
    return { kind: "code", salt: value.salt, hash: value.hash };
  }
  return undefined;
}

/** The marker the public page draws: `data-locked` is `age` or `code`, from this lookup only. */
export function lockMarker(lock: unknown): LockKind | null {
  if (typeof lock !== "object" || lock === null) return null;
  const kind = (lock as { kind?: unknown }).kind;
  return kind === "age" || kind === "code" ? kind : null;
}

/** The words a screen reader gets after the label of a locked link. */
export const LOCK_HIDDEN_TEXT: Readonly<Record<LockKind, string>> = {
  age: " (sensitive content)",
  code: " (locked)",
};

/**
 * A lock without its secrets, for the one payload that leaves the owner's own session: the private
 * share link (M6-10). The marker keeps its kind (so the link still draws the right lock); the salt
 * and hash are emptied, never copied.
 */
export function redactLock(lock: DraftLock | PublishedLock | undefined): PublishedLock | undefined {
  if (!lock) return undefined;
  return lock.kind === "age" ? { kind: "age" } : { kind: "code", salt: "", hash: "" };
}
