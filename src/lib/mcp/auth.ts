import type { AuthInfo } from "@modelcontextprotocol/server";

/**
 * Bearer verification for `/mcp` (M10-04). The OAuth module owns what a token IS (hashing, lookup,
 * expiry, revocation); this adapter owns what the endpoint ACCEPTS before asking it: one header, one
 * scheme, one short token, and no way for a credential to arrive any other way.
 *
 * `verifyToken` never throws and never returns a value for a bad credential. mcp-handler logs a
 * thrown error with its error object, which must never carry a token, so every failure here is a
 * plain `undefined`.
 */

/** What the OAuth module's `verifyAccessToken` answers for a good access token. */
export interface VerifiedToken {
  userId: string;
  clientId: string;
  scopes: string[];
  /** The token row's id, never the token. */
  tokenId: string;
  grantId?: string | null;
  /** Seconds since the epoch, when the module reports it. */
  expiresAt?: number;
}

export type VerifyAccessToken = (token: string) => Promise<VerifiedToken | null>;

/** A token the OAuth module hands out is URL-safe base64 plus an underscore prefix, far under 256. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const BEARER_HEADER = /^bearer ([^ ]+)$/i;

export type BearerHeader = { kind: "none" } | { kind: "bad" } | { kind: "token"; token: string };

/**
 * The credential in an `Authorization` header. No header is `none`. The scheme is case-insensitive
 * (RFC 7235) and followed by exactly one space and one token of at most 256 URL-safe characters;
 * everything else (`Bearer` alone, two spaces, `Basic x`, two tokens, a long or non-ASCII value) is
 * `bad`, and a bad value is refused before anything is hashed.
 */
export function parseBearerHeader(header: string | null): BearerHeader {
  if (header === null) return { kind: "none" };
  const match = BEARER_HEADER.exec(header);
  if (!match || !TOKEN_PATTERN.test(match[1]!)) return { kind: "bad" };
  return { kind: "token", token: match[1]! };
}

export interface VerifyTokenOptions {
  verify: VerifyAccessToken;
  log?: (line: string) => void;
  /** Called with the request when the token store could not answer (not when a token is bad). */
  onUnavailable?: (req: Request) => void;
}

export function createVerifyToken(options: VerifyTokenOptions) {
  return async function verifyToken(req: Request, _bearer?: string): Promise<AuthInfo | undefined> {
    void _bearer;
    const parsed = parseBearerHeader(req.headers.get("authorization"));
    if (parsed.kind !== "token") return undefined;
    let verified: VerifiedToken | null;
    try {
      verified = await options.verify(parsed.token);
    } catch {
      // The store could not answer. The caller says 503 instead of 401, so a client does not start
      // a new sign-in because of an outage. The error is not logged: it names an operation, not a token.
      options.log?.("[mcp] verifying a token failed");
      options.onUnavailable?.(req);
      return undefined;
    }
    if (!verified) return undefined;
    return {
      // The row id stands where the library expects a token: the secret is never carried on.
      token: verified.tokenId,
      clientId: verified.clientId,
      scopes: [...verified.scopes],
      ...(verified.expiresAt !== undefined ? { expiresAt: verified.expiresAt } : {}),
      extra: {
        userId: verified.userId,
        grantId: verified.grantId ?? null,
        tokenId: verified.tokenId,
      },
    };
  };
}
