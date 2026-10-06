/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { randomBytes } from "node:crypto";
import { generateToken, sha256Hex } from "@/lib/oauth/tokens";
import { adminClient } from "./auth";
import { url } from "../helpers";

/**
 * A small client for the MCP endpoint, written against the wire protocol and nothing else (Wave L,
 * M10-33). No SDK client is installed on purpose (docs/PLAN.md: no new library without approval), so
 * this speaks JSON-RPC over `fetch`, sends `Accept: application/json, text/event-stream` and reads a
 * JSON body or an event stream, whichever the server answers with.
 *
 *   const token = await mintToken(userId);                 // a grant and tokens, made with the secret key
 *   const mcp = new McpClient(token.token);
 *   await mcp.initialize();
 *   const result = await mcp.callTool("list_pages", {});
 *
 * `mintToken` stands in for the OAuth dance in the specs that are not about the dance: it inserts a
 * client, a grant and an access token with the same secret generator and hash the authorization server
 * uses, so the endpoint cannot tell the difference.
 */

export const ALL_SCOPES = ["hydlnk.read", "hydlnk.write", "hydlnk.publish"] as const;
export const READ_ONLY_SCOPES = ["hydlnk.read"] as const;
export const READ_WRITE_SCOPES = ["hydlnk.read", "hydlnk.write"] as const;

export const MCP_URL = (): string => url("app", "/mcp");

export interface MintedToken {
  /** The bearer value. Never log it. */
  token: string;
  tokenId: string;
  grantId: string;
  clientId: string;
  userId: string;
  scopes: string[];
}

const mintedClients: string[] = [];

export async function mintToken(
  userId: string,
  scopes: readonly string[] = ALL_SCOPES,
  options: {
    /** The `resource` stored on the token row (defaults to the endpoint's own URL). */
    resource?: string;
    /** Seconds until it expires (negative: already expired). Default 3600. */
    expiresInSeconds?: number;
    clientName?: string;
  } = {},
): Promise<MintedToken> {
  const admin = adminClient();
  const clientId = `hlc_${randomBytes(16).toString("hex")}`;
  const client = await admin.from("oauth_clients").insert({
    client_id: clientId,
    kind: "dcr",
    client_name: options.clientName ?? "Test connector",
    redirect_uris: ["http://127.0.0.1:12000/callback"],
  });
  if (client.error) throw new Error(`minting a client failed: ${client.error.message}`);
  mintedClients.push(clientId);

  const grant = await admin
    .from("oauth_grants")
    .insert({ user_id: userId, client_id: clientId, scopes: [...scopes] })
    .select("id")
    .single();
  if (grant.error) throw new Error(`minting a grant failed: ${grant.error.message}`);

  const token = generateToken("access");
  const now = Date.now();
  const lifetime = options.expiresInSeconds ?? 3600;
  // An expired token still has to satisfy the lifetime check (expires_at <= created_at + 3660 s):
  // back-date `created_at` instead of stretching the expiry.
  const createdAt = new Date(lifetime < 0 ? now + lifetime * 1000 - 60_000 : now).toISOString();
  const row = await admin
    .from("oauth_tokens")
    .insert({
      grant_id: grant.data.id,
      user_id: userId,
      kind: "access",
      token_hash: sha256Hex(token),
      scopes: [...scopes],
      resource: options.resource ?? MCP_URL(),
      expires_at: new Date(now + lifetime * 1000).toISOString(),
      created_at: createdAt,
    })
    .select("id")
    .single();
  if (row.error) throw new Error(`minting a token failed: ${row.error.message}`);

  return {
    token,
    tokenId: row.data.id as string,
    grantId: grant.data.id as string,
    clientId,
    userId,
    scopes: [...scopes],
  };
}

/** Removes the clients `mintToken` made (their grants and tokens go with them). Users clean up on their own. */
export async function cleanupMintedClients(): Promise<void> {
  const ids = mintedClients.splice(0);
  if (ids.length === 0) return;
  await adminClient().from("oauth_clients").delete().in("client_id", ids);
}

// ---------------------------------------------------------------------------------------------
// The wire client
// ---------------------------------------------------------------------------------------------

export interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

export interface RpcResponse {
  status: number;
  headers: Headers;
  /** The JSON-RPC message answering the request, when there is one. */
  message: RpcMessage | null;
  /** The raw body text, for the bodies that are not JSON-RPC (a 401's JSON, a 413). */
  text: string;
}

/** The text of a `tools/call` result, and its structured content. */
export interface ToolOutcome {
  isError: boolean;
  text: string;
  /** The compact JSON of the second text item, when the result is a success. */
  json: Record<string, unknown> | null;
  structured: Record<string, unknown>;
  meta: Record<string, unknown> | undefined;
  raw: Record<string, unknown>;
}

const ERA_2026 = "2026-07-28";

function parseBody(text: string, contentType: string): RpcMessage | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (contentType.includes("text/event-stream")) {
    for (const event of trimmed.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        const message = JSON.parse(data) as RpcMessage;
        if ("result" in message || "error" in message) return message;
      } catch {
        continue;
      }
    }
    return null;
  }
  try {
    return JSON.parse(trimmed) as RpcMessage;
  } catch {
    return null;
  }
}

export class McpClient {
  private nextId = 1;
  protocolVersion = "2025-06-18";

  constructor(
    public token: string | null,
    private readonly options: { url?: string; era?: "2025" | "2026" } = {},
  ) {}

  get url(): string {
    return this.options.url ?? MCP_URL();
  }

  /** One request with whatever headers a test wants; the bearer header is added unless `authorization` is given. */
  async post(body: unknown, headers: Record<string, string> = {}): Promise<RpcResponse> {
    const send: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    };
    if (
      this.token !== null &&
      !Object.keys(send).some((key) => key.toLowerCase() === "authorization")
    ) {
      send.authorization = `Bearer ${this.token}`;
    }
    const response = await fetch(this.url, {
      method: "POST",
      headers: send,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      message: parseBody(text, response.headers.get("content-type") ?? ""),
    };
  }

  /** A JSON-RPC request in the era this client speaks. */
  async rpc(method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
    const id = this.nextId++;
    if (this.options.era === "2026") {
      const meta = {
        "io.modelcontextprotocol/protocolVersion": ERA_2026,
        "io.modelcontextprotocol/clientInfo": { name: "hydlnk-e2e", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      };
      const headers: Record<string, string> = {
        "mcp-protocol-version": ERA_2026,
        "mcp-method": method,
      };
      if (method === "tools/call" && typeof params.name === "string")
        headers["mcp-name"] = params.name;
      return this.post({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }, headers);
    }
    const headers: Record<string, string> = {};
    if (method !== "initialize") headers["mcp-protocol-version"] = this.protocolVersion;
    return this.post({ jsonrpc: "2.0", id, method, params }, headers);
  }

  async initialize(protocolVersion = "2025-06-18"): Promise<RpcResponse> {
    this.protocolVersion = protocolVersion;
    const response = await this.rpc("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "hydlnk-e2e", version: "1.0.0" },
    });
    return response;
  }

  /** `notifications/initialized`: answered 202 with no body. */
  async initialized(): Promise<RpcResponse> {
    return this.post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { "mcp-protocol-version": this.protocolVersion },
    );
  }

  async listTools(): Promise<Array<Record<string, any>>> {
    const response = await this.rpc("tools/list");
    const tools = response.message?.result?.tools;
    if (!Array.isArray(tools))
      throw new Error(`tools/list answered ${response.status}: ${response.text.slice(0, 200)}`);
    return tools as Array<Record<string, any>>;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
    const response = await this.rpc("tools/call", { name, arguments: args });
    const result = response.message?.result;
    if (!result) {
      throw new Error(
        `tools/call ${name} answered ${response.status}: ${response.text.slice(0, 300)}`,
      );
    }
    const content = (result.content as Array<{ type: string; text: string }>) ?? [];
    let json: Record<string, unknown> | null = null;
    if (content[1]?.text) {
      try {
        json = JSON.parse(content[1].text) as Record<string, unknown>;
      } catch {
        json = null;
      }
    }
    return {
      isError: result.isError === true,
      text: content[0]?.text ?? "",
      json,
      structured: (result.structuredContent as Record<string, unknown>) ?? {},
      meta: result._meta as Record<string, unknown> | undefined,
      raw: result,
    };
  }

  /** The error of a failed call, `{ code, message, ... }`. */
  async callFailure(name: string, args: Record<string, unknown> = {}) {
    const outcome = await this.callTool(name, args);
    if (!outcome.isError) throw new Error(`${name} was expected to fail but succeeded`);
    return outcome.structured.error as {
      code: string;
      message: string;
      retryAfterSeconds?: number;
      issues?: Array<{ path: string; message: string }>;
      requiredScope?: string;
      details?: Record<string, unknown>;
    };
  }

  /** A call that must succeed, returning its `structuredContent` without `ok`. */
  async call<T = Record<string, any>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const outcome = await this.callTool(name, args);
    if (outcome.isError) {
      throw new Error(`${name} failed: ${JSON.stringify(outcome.structured.error)}`);
    }
    const { ok: _ok, ...rest } = outcome.structured;
    void _ok;
    return rest as T;
  }
}

// ---------------------------------------------------------------------------------------------
// Discovery and the loopback listener of the OAuth dance (M10-33)
// ---------------------------------------------------------------------------------------------

export interface Discovery {
  /** The MCP URL exactly as the protected resource metadata names it. */
  resource: string;
  issuer: string;
  metadata: Record<string, unknown>;
  protectedResource: Record<string, unknown>;
  challenge: string;
}

/**
 * What a real client does first: an anonymous `POST /mcp`, the 401 and its `resource_metadata`, the
 * protected resource document, the authorization server document, and the checks Claude and ChatGPT
 * make on them (the issuer equals the URL's origin, S256 is offered, a client id may be a metadata
 * document, the issuer parameter is returned). Throws with a plain message when one fails.
 */
export async function discover(
  origin: string = url("app", "").replace(/\/$/, ""),
): Promise<Discovery> {
  const anonymous = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  if (anonymous.status !== 401)
    throw new Error(`an anonymous POST /mcp answered ${anonymous.status}, not 401`);
  const challenge = anonymous.headers.get("www-authenticate") ?? "";
  const match = /resource_metadata="([^"]+)"/.exec(challenge);
  if (!match) throw new Error(`the 401 names no resource_metadata: ${challenge}`);
  const protectedResource = (await (await fetch(match[1]!)).json()) as Record<string, unknown>;
  const servers = protectedResource.authorization_servers as string[] | undefined;
  if (!servers?.[0])
    throw new Error("the protected resource metadata names no authorization server");
  const issuer = servers[0];
  const metadata = (await (
    await fetch(`${issuer}/.well-known/oauth-authorization-server`)
  ).json()) as Record<string, unknown>;
  if (metadata.issuer !== new URL(issuer).origin)
    throw new Error("issuer is not the origin it was fetched from");
  if (!(metadata.code_challenge_methods_supported as string[]).includes("S256"))
    throw new Error("S256 is not offered");
  if (metadata.client_id_metadata_document_supported !== true)
    throw new Error("client id metadata documents are not advertised");
  if (metadata.authorization_response_iss_parameter_supported !== true)
    throw new Error("the iss parameter is not advertised");
  return {
    resource: String(protectedResource.resource),
    issuer,
    metadata,
    protectedResource,
    challenge,
  };
}

export interface Loopback {
  /** `http://127.0.0.1:{free port}/callback`: the redirect address of a native client. */
  redirectUri: string;
  /** The next request the browser makes to the listener (code, state and iss are in its query). */
  next(timeoutMs?: number): Promise<URL>;
  close(): Promise<void>;
}

/** A loopback listener like a desktop app's: it answers the browser with a page and keeps the URL it was sent to. */
export async function startLoopback(): Promise<Loopback> {
  const { createServer } = await import("node:http");
  const arrived: URL[] = [];
  const waiting: Array<(value: URL) => void> = [];
  const server = createServer((request, response) => {
    const seen = new URL(request.url ?? "/", "http://127.0.0.1");
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>the app</title><p>You can close this window.</p>");
    const resolve = waiting.shift();
    if (resolve) resolve(seen);
    else arrived.push(seen);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    next: (timeoutMs = 15_000) =>
      new Promise<URL>((resolve, reject) => {
        const ready = arrived.shift();
        if (ready) return resolve(ready);
        const timer = setTimeout(
          () => reject(new Error("the loopback listener got no request")),
          timeoutMs,
        );
        waiting.push((seen) => {
          clearTimeout(timer);
          resolve(seen);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
