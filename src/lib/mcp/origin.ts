/**
 * Which browser origins may call `/mcp` (M10-02). The Streamable HTTP transport asks a server to
 * check `Origin` so a web page cannot reach it through DNS rebinding. A request with no `Origin`
 * (every server-side client) goes on to the bearer check; one with an allowed `Origin` goes on too;
 * any other is refused before a token is looked at.
 *
 * To let another browser-based client connect, add its origin here.
 */
export const MCP_ALLOWED_ORIGINS: readonly string[] = [
  "https://claude.ai",
  "https://claude.com",
  "https://chatgpt.com",
];

/** `http://localhost` and `http://127.0.0.1`, with or without a port: local developer tools. */
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

/**
 * Is `origin` one the endpoint serves? `appOrigin` is the configured app origin
 * (`https://app.hydlnk.com`), never one taken from the request.
 */
export function isAllowedMcpOrigin(origin: string, appOrigin: string): boolean {
  if (origin === appOrigin) return true;
  if (MCP_ALLOWED_ORIGINS.includes(origin)) return true;
  return LOOPBACK_ORIGIN.test(origin);
}

/** The headers a browser may send to `/mcp`. */
export const MCP_ALLOWED_HEADERS =
  "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID, Mcp-Method, Mcp-Name";

/** The response headers a browser client may read. */
export const MCP_EXPOSED_HEADERS = "WWW-Authenticate, Mcp-Session-Id, Retry-After";
