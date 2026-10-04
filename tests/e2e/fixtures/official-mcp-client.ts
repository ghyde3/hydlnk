/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each step checks */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_URL, type ToolOutcome } from "./mcp-client";

/**
 * The official MCP client (`@modelcontextprotocol/client`, a dev dependency, never imported from
 * `src/`) behind the small surface the flows use: the Streamable HTTP client transport with the
 * bearer token as its auth provider. The hand-rolled `McpClient` stays for everything that needs raw
 * control of headers and status codes (the wire-level specs).
 */
export interface ToolSession {
  initialize(): Promise<{ status: number }>;
  initialized(): Promise<{ status: number }>;
  listTools(): Promise<Array<Record<string, any>>>;
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolOutcome>;
}

export class OfficialMcpClient implements ToolSession {
  private readonly client = new Client({ name: "hydlnk-e2e-official", version: "1.0.0" });
  private connected = false;

  constructor(
    private readonly token: string,
    private readonly url: string = MCP_URL(),
  ) {}

  /** `connect` runs initialize and sends notifications/initialized. */
  async initialize(): Promise<{ status: number }> {
    if (!this.connected) {
      const token = this.token;
      await this.client.connect(
        new StreamableHTTPClientTransport(new URL(this.url), {
          authProvider: { token: async () => token },
        }),
      );
      this.connected = true;
    }
    return { status: 200 };
  }

  async initialized(): Promise<{ status: number }> {
    return { status: 202 };
  }

  async listTools(): Promise<Array<Record<string, any>>> {
    return (await this.client.listTools()).tools as Array<Record<string, any>>;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
    const result = (await this.client.callTool({ name, arguments: args })) as Record<string, any>;
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

  async close(): Promise<void> {
    await this.client.close();
  }
}
