/**
 * The constants of the MCP connector (Wave L, M10-20..M10-32). No imports and no secrets, so the
 * /connect page and the privacy policy can read the same numbers the server enforces.
 */

import {
  MCP_PATH,
  OAUTH_SCOPES,
  PROTECTED_RESOURCE_METADATA_PATH,
  SCOPE_PUBLISH,
  SCOPE_READ,
  SCOPE_WRITE,
  type OauthScope,
} from "@/lib/oauth/constants";

/** The three OAuth scopes the connector knows: the authorization server issues exactly these. */
export const MCP_SCOPES = {
  read: SCOPE_READ,
  write: SCOPE_WRITE,
  publish: SCOPE_PUBLISH,
} as const;
export type McpScope = OauthScope;
export const MCP_SCOPE_LIST: readonly McpScope[] = OAUTH_SCOPES;

/** Tool calls per person per minute and per hour, across every connected app (M10-22). */
export const MCP_USER_PER_MINUTE = 60;
export const MCP_USER_PER_HOUR = 600;
/** Tool calls per access token per minute. */
export const MCP_TOKEN_PER_MINUTE = 30;
/** Publishes per person per hour, across every token, on top of the general limits. */
export const MCP_PUBLISH_PER_HOUR = 10;

/** Requests that fail authentication, per client address per minute (M10-04). */
export const MCP_FAILED_AUTH_PER_MINUTE = 120;

/** How long the activity log keeps a row (M10-05, M10-32). The privacy policy and /connect read it. */
export const MCP_ACTIVITY_RETENTION_DAYS = 90;

/** A tool call is cut off after this long, and the route's `maxDuration` leaves room for it. */
export const MCP_TOOL_TIMEOUT_MS = 25_000;

/** The largest request body the endpoint reads (M10-02, M10-20). */
export const MCP_MAX_BODY_BYTES = 256 * 1024;

/** A result over this size shortens its long text fields (M10-22). */
export const MCP_RESULT_MAX_BYTES = 60 * 1024;
/** Where a long text field is cut when a result is too large. */
export const MCP_SHORTENED_TEXT_CHARS = 200;

/** The most pages `list_pages` returns (the Studio limit). */
export const MCP_LIST_PAGES_MAX = 15;

/** The one protected-resource path the endpoint lives at, on the app host. */
export const MCP_RESOURCE_PATH = MCP_PATH;
/** The RFC 9728 document for it (path-insertion form). */
export const MCP_RESOURCE_METADATA_PATH = PROTECTED_RESOURCE_METADATA_PATH;

/** Reported to clients as `serverInfo.version`. */
export const MCP_SERVER_VERSION = "1.0.0";
