import { MAX_BEARER_LENGTH } from "./constants";
import { parseForm, type BodyRead } from "./http";
import { logOauthFailure } from "./log";
import type { HttpResult, LimitFn } from "./register";
import { sha256Hex } from "./tokens";
import { basicNamesClient } from "./token";
import type { OauthStore } from "./store";

/**
 * Token revocation, RFC 7009 (M10-17). A well-formed request is always answered `200` with an empty
 * body, whether the token was unknown, expired, already revoked or another app's, so the endpoint is
 * no oracle. When the token is a live one of THAT client, the whole grant ends: every access and
 * refresh token of it, whichever of the two was sent (a client that disconnects does not want a
 * revoked access token to be refreshable back).
 */

export const REVOKE_MAX_BODY_BYTES = 16 * 1024;
export const REVOKE_PER_IP_PER_MINUTE = 60;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export interface RevokeDeps {
  store: Pick<OauthStore, "revokeByToken">;
  limit: LimitFn;
}

export interface RevokeInput {
  clientKey: string;
  mediaType: string;
  authorization: string | null;
  readBody: () => Promise<BodyRead>;
}

function failure(status: number, error: string, description: string, headers = {}): HttpResult {
  return {
    status,
    body: { error, error_description: description },
    headers: { ...NO_STORE, ...headers },
  };
}

export async function handleRevokeRequest(
  input: RevokeInput,
  deps: RevokeDeps,
): Promise<HttpResult> {
  const verdict = await deps.limit(`oauth-revoke:${input.clientKey}`, REVOKE_PER_IP_PER_MINUTE, 60);
  if (!verdict.allowed) {
    return failure(429, "temporarily_unavailable", "Too many requests. Try again in a minute.", {
      "Retry-After": String(Math.max(1, verdict.retryAfter)),
    });
  }
  if (input.mediaType !== "application/x-www-form-urlencoded") {
    return failure(
      415,
      "invalid_request",
      "Send the request as application/x-www-form-urlencoded.",
    );
  }
  const body = await input.readBody();
  if (!body.ok) {
    return body.reason === "too_large"
      ? failure(413, "invalid_request", "That request is too large.")
      : failure(400, "invalid_request", "The request couldn’t be read.");
  }
  const form = parseForm(body.text);
  if (!form.ok) return failure(400, "invalid_request", "A parameter was sent more than once.");

  const token = form.values.get("token");
  const clientId = form.values.get("client_id");
  if (token === undefined) return failure(400, "invalid_request", "token is required.");
  if (clientId === undefined) return failure(400, "invalid_request", "client_id is required.");
  if (input.authorization !== null && /^basic\b/i.test(input.authorization.trim())) {
    if (!basicNamesClient(input.authorization, clientId)) {
      return failure(401, "invalid_client", "The app isn’t recognized.", {
        "WWW-Authenticate": 'Basic realm="HYDLNK"',
      });
    }
  }

  // A value that cannot be one of our tokens ends nothing, and costs no database read.
  if (token.length <= MAX_BEARER_LENGTH && /^[\x21-\x7e]+$/.test(token)) {
    try {
      await deps.store.revokeByToken(sha256Hex(token), clientId);
    } catch (error) {
      logOauthFailure("revoke", error);
      return failure(500, "server_error", "We couldn’t finish that request. Try again.");
    }
  }
  return { status: 200, body: undefined, headers: { ...NO_STORE } };
}
