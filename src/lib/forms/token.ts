import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The confirm page's token (M17-06): a stateless, signed proof that this client was shown the form
 * at a given time. `v1.{issuedAtMs}.{hex}`, the hex being HMAC-SHA256 under the visitor-hash secret
 * over a domain-separated message that binds the site, the block and the client:
 *
 *   "form-token\n" pageId "\n" blockId "\n" client "\n" issuedAtMs
 *
 * It is never stored. Its age gates the second step (at least 2 seconds, at most an hour) and its
 * signature is spent once through the rate limiter (`form-token:{signature}`, submit.ts), so a
 * replayed token shows the confirm page again.
 */

export const TOKEN_MAX_LENGTH = 128;

export interface TokenBinding {
  pageId: string;
  blockId: string;
  /** `rateLimitClientKey(headers)`: the client network the page was shown to. */
  client: string;
  now: Date;
  secret: string;
}

function mac(binding: Omit<TokenBinding, "now">, issuedAtMs: number): string {
  return createHmac("sha256", binding.secret)
    .update(
      `form-token\n${binding.pageId.toLowerCase()}\n${binding.blockId}\n${binding.client}\n${issuedAtMs}`,
    )
    .digest("hex");
}

export function issueFormToken(binding: TokenBinding): string {
  const issuedAtMs = binding.now.getTime();
  return `v1.${issuedAtMs}.${mac(binding, issuedAtMs)}`;
}

const SHAPE = /^v1\.(\d{13})\.([0-9a-f]{64})$/;

/**
 * The token's age and signature when it is well formed and was signed for exactly this site, block
 * and client; `{ ok: false }` for anything else (forged, another block or client, over-long, from the
 * future). The caller decides whether the age is acceptable.
 */
export function readFormToken(
  token: string,
  binding: TokenBinding,
): { ok: true; ageMs: number; signature: string } | { ok: false } {
  if (token.length > TOKEN_MAX_LENGTH) return { ok: false };
  const match = SHAPE.exec(token);
  if (!match) return { ok: false };
  const issuedAtMs = Number(match[1]);
  const given = Buffer.from(match[2]!, "hex");
  const expected = Buffer.from(mac(binding, issuedAtMs), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false };
  const ageMs = binding.now.getTime() - issuedAtMs;
  if (ageMs < 0) return { ok: false };
  return { ok: true, ageMs, signature: match[2]! };
}
