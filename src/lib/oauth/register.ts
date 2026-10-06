import { randomBytes } from "node:crypto";
import { OAUTH_SCOPES, UNUSED_DCR_CAP } from "./constants";
import {
  HYDLNK_NAME_REFUSAL,
  UNNAMED_APP,
  namesHydlnkWithoutRight,
  sanitizeClientName,
} from "./client-name";
import { VENDOR_NAME_REFUSAL, namesVendorWithoutRight } from "./known-clients";
import { logOauthEvent, logOauthFailure } from "./log";
import { redirectHosts } from "./blocked-hosts";
import { validateRedirectUriList } from "./redirect-uri";
import type { BodyRead } from "./http";
import type { OauthStore } from "./store";

/**
 * Dynamic Client Registration (RFC 7591) for PUBLIC clients (M10-10). Claude and ChatGPT fall back
 * to this endpoint when a client-metadata document is not used, so it is open (no authentication) and
 * defended by what it refuses and what it costs an abuser:
 *
 *   - public clients only: no secret is ever issued, `token_endpoint_auth_method` is `none`;
 *   - redirect URIs by the one rule of M10-06, matched exactly later;
 *   - the name cleaned and refused when it poses as this product (M10-09);
 *   - a vendor's name (Claude, ChatGPT and so on) only for an app that returns to that vendor or to
 *     this computer, and no return address on this product's own hosts (Wave L review);
 *   - no return address on a host of an app an admin blocked (`oauth_blocked_hosts`, M13-10 review);
 *   - 20 registrations an hour per address, then 429. There is no overall bucket: one budget for
 *     every caller would let about fifteen addresses spend it and keep every real client's fallback
 *     registration at a 429 for the hour. Storage is bounded by the 20,000-row trim and the nightly
 *     purge;
 *   - an unused registration is deleted when 20,000 of them pile up, oldest first, and by the nightly
 *     job after a week;
 *   - registration proves nothing about the app: the consent screen says "not verified".
 *
 * Everything outside `redirect_uris`, `client_name`, `grant_types`, `response_types` and
 * `token_endpoint_auth_method` is accepted and ignored: never fetched, never stored.
 */

export const REGISTER_MAX_BODY_BYTES = 8 * 1024;
export const REGISTER_PER_IP_PER_HOUR = 20;

export type LimitFn = (
  key: string,
  limit: number,
  windowSeconds: number,
) => Promise<{ allowed: boolean; retryAfter: number }>;

export interface HttpResult {
  status: number;
  /** The JSON body; undefined means an empty body. */
  body: unknown;
  headers: Record<string, string>;
}

export interface RegisterDeps {
  store: Pick<OauthStore, "insertDcrClient" | "trimUnusedDcr" | "anyHostBlocked">;
  limit: LimitFn;
  now?: () => number;
  newClientId?: () => string;
  unusedCap?: number;
  /** `NEXT_PUBLIC_ROOT_DOMAIN`: return addresses on it are refused. */
  rootDomain?: string;
}

export interface RegisterInput {
  /** The rate-limit key of the caller (its address, or the shared "unknown" bucket). */
  clientKey: string;
  /** The media type of the request, lower case, no parameters. */
  mediaType: string;
  readBody: () => Promise<BodyRead>;
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

function failure(status: number, error: string, description: string, headers = {}): HttpResult {
  return {
    status,
    body: { error, error_description: description },
    headers: { ...NO_STORE, ...headers },
  };
}

/** `hlc_` plus 32 lowercase hex characters from the platform CSPRNG. */
export function newDcrClientId(random: (size: number) => Buffer = randomBytes): string {
  return `hlc_${random(16).toString("hex")}`;
}

const SUPPORTED_GRANTS = ["authorization_code", "refresh_token"] as const;

export async function registerClient(
  input: RegisterInput,
  deps: RegisterDeps,
): Promise<HttpResult> {
  // 1. the limit, before anything else is looked at. A limiter failure fails open (rateLimit logs it).
  const perAddress = await deps.limit(
    `oauth-register:${input.clientKey}`,
    REGISTER_PER_IP_PER_HOUR,
    3600,
  );
  if (!perAddress.allowed) {
    return failure(429, "temporarily_unavailable", "Too many registrations. Try again later.", {
      "Retry-After": String(Math.max(1, perAddress.retryAfter)),
    });
  }

  // 2. the request: JSON only, at most 8 KB.
  if (input.mediaType !== "application/json") {
    return failure(415, "invalid_request", "Send the registration as application/json.");
  }
  const body = await input.readBody();
  if (!body.ok) {
    return body.reason === "too_large"
      ? failure(413, "invalid_request", "That request is too large.")
      : failure(400, "invalid_client_metadata", "The registration couldn’t be read.");
  }

  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return failure(400, "invalid_client_metadata", "The registration isn’t valid JSON.");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return failure(400, "invalid_client_metadata", "The registration must be a JSON object.");
  }
  // Read only the members that matter, from a plain copy: a `__proto__` or `constructor` key does nothing.
  const read = (name: string): unknown =>
    Object.hasOwn(json as object, name) ? (json as Record<string, unknown>)[name] : undefined;

  // 3. validation.
  const redirects = validateRedirectUriList(
    read("redirect_uris"),
    deps.rootDomain ? { rootDomain: deps.rootDomain } : {},
  );
  if (!redirects.ok) {
    return failure(400, "invalid_redirect_uri", "Use https redirect URIs, or http on localhost.");
  }
  // A return address on a host an admin has blocked (M13-10 review): the app they blocked would
  // otherwise come back under a new id. Fails closed when the table cannot be read.
  const hosts = redirectHosts(redirects.uris);
  if (hosts.length > 0) {
    let blocked: boolean;
    try {
      blocked = await deps.store.anyHostBlocked(hosts);
    } catch (error) {
      logOauthFailure("register", error);
      return failure(500, "server_error", "We couldn’t register the app. Try again later.");
    }
    if (blocked) {
      return failure(400, "invalid_redirect_uri", "That return address can’t be used.");
    }
  }

  const method = read("token_endpoint_auth_method");
  if (method !== undefined && method !== "none") {
    return failure(400, "invalid_client_metadata", "Only public clients can register.");
  }

  const rawName = read("client_name");
  if (rawName !== undefined && typeof rawName !== "string") {
    return failure(400, "invalid_client_metadata", "The name must be text.");
  }
  const name = sanitizeClientName(rawName, UNNAMED_APP);
  if (namesHydlnkWithoutRight(name, redirects.uris)) {
    return failure(400, "invalid_client_metadata", HYDLNK_NAME_REFUSAL);
  }
  if (namesVendorWithoutRight(name, redirects.uris)) {
    return failure(400, "invalid_client_metadata", VENDOR_NAME_REFUSAL);
  }

  const grantTypes = read("grant_types");
  let grants: string[] = [...SUPPORTED_GRANTS];
  if (grantTypes !== undefined) {
    if (!Array.isArray(grantTypes) || grantTypes.some((entry) => typeof entry !== "string")) {
      return failure(400, "invalid_client_metadata", "grant_types must be a list of text values.");
    }
    grants = SUPPORTED_GRANTS.filter((grant) => (grantTypes as string[]).includes(grant));
    if (!grants.includes("authorization_code")) {
      return failure(
        400,
        "invalid_client_metadata",
        "grant_types must include authorization_code.",
      );
    }
  }

  const responseTypes = read("response_types");
  if (responseTypes !== undefined) {
    if (
      !Array.isArray(responseTypes) ||
      responseTypes.some((entry) => typeof entry !== "string") ||
      !(responseTypes as string[]).includes("code")
    ) {
      return failure(400, "invalid_client_metadata", "response_types must include code.");
    }
  }

  // 4. make room, then register.
  const clientId = (deps.newClientId ?? newDcrClientId)();
  try {
    await deps.store.trimUnusedDcr(deps.unusedCap ?? UNUSED_DCR_CAP);
    await deps.store.insertDcrClient({
      client_id: clientId,
      kind: "dcr",
      client_name: name,
      redirect_uris: redirects.uris,
    });
  } catch (error) {
    logOauthFailure("register", error);
    return failure(500, "server_error", "We couldn’t register the app. Try again later.");
  }
  logOauthEvent("client_registered", { redirects: redirects.uris.length });

  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor((deps.now ?? Date.now)() / 1000),
      redirect_uris: redirects.uris,
      client_name: name,
      grant_types: grants,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPES.join(" "),
    },
    headers: { ...NO_STORE },
  };
}
