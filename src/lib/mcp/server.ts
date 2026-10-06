import "server-only";
import type { McpServer, AuthInfo, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MESSAGES } from "./errors";
import { failureResult, serverFailure, type ToolResult } from "./result";
import { runTool } from "./run-tool";
import { TOOLS } from "./tools";
import type { AnyToolDefinition, ToolDeps, ToolIdentity } from "./types";

/**
 * Registers the twelve tools on an `McpServer` (one is built per request, the way mcp-handler
 * serves statelessly). The SDK is given a schema that ADVERTISES the real input (the JSON Schema of
 * the tool's zod schema, `additionalProperties: false`) but validates nothing: the SDK turns a
 * validation failure into a raw error text, and `runTool` owns the order of checks and the words of
 * an `invalid_input`.
 */

function advertise(schema: z.ZodType): StandardSchemaWithJSON {
  const json = (io: "input" | "output") => () =>
    z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }) as Record<
      string,
      unknown
    >;
  return {
    "~standard": {
      version: 1,
      vendor: "hydlnk",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: json("input"), output: json("output") },
    },
  } as unknown as StandardSchemaWithJSON;
}

/** Who is calling, from the verified token's `AuthInfo` and from nowhere else. */
export function identityOf(auth: AuthInfo | undefined): ToolIdentity | null {
  const extra = auth?.extra as
    { userId?: unknown; grantId?: unknown; tokenId?: unknown } | undefined;
  if (!auth || typeof extra?.userId !== "string" || typeof extra.tokenId !== "string") return null;
  return {
    userId: extra.userId,
    clientId: auth.clientId,
    grantId: typeof extra.grantId === "string" ? extra.grantId : null,
    tokenId: extra.tokenId,
    scopes: auth.scopes,
  };
}

export function registerTools(
  server: McpServer,
  getDeps: () => ToolDeps,
  tools: readonly AnyToolDefinition[] = TOOLS,
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: advertise(tool.input),
        annotations: { ...tool.annotations },
        // What ChatGPT reads to start its sign-in for a tool, naming exactly the tool's scope.
        _meta: { securitySchemes: [{ type: "oauth2", scopes: [tool.scope] }] },
      },
      async (args: unknown, ctx): Promise<ToolResult> => {
        const identity = identityOf(ctx.http?.authInfo);
        if (!identity) return failureResult(serverFailure(MESSAGES.serverError));
        return runTool(tool, identity, args, getDeps());
      },
    );
  }
}
