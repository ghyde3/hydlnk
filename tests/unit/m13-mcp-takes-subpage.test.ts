import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
// The tools import the domain and billing code, which read the server environment at import.
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));

// The tools read the public environment at import; this test only inspects their schemas.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localhost:3000");

const { TOOLS } = await import("@/lib/mcp/tools");

/** The rule src/lib/mcp/run-tool.ts uses to decide that a page id sent as `pageId` means that page. */
const detected = (input: unknown) =>
  typeof input === "object" &&
  input !== null &&
  "shape" in input &&
  "subPageId" in ((input as { shape: object }).shape ?? {});

/** What the client sees: the tool's advertised input schema names `subPageId`. */
const advertised = (input: z.ZodType) => {
  const schema = z.toJSONSchema(input, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, unknown>;
  };
  return "subPageId" in (schema.properties ?? {});
};

describe("M13-14 run-tool knows every tool that takes subPageId", () => {
  it("detects exactly the tools whose advertised input names subPageId", () => {
    // A tool whose schema hides `shape` (a union, a transform, a pipe) would otherwise act on Home when
    // handed a page id as `pageId`: this fails first, so the detection is changed on purpose.
    for (const tool of TOOLS) {
      expect(detected(tool.input), tool.name).toBe(advertised(tool.input as z.ZodType));
    }
  });

  it("covers the page tools", () => {
    const takes = TOOLS.filter((tool) => detected(tool.input)).map((tool) => tool.name);
    for (const name of ["get_page", "add_block", "update_block", "move_block", "remove_block"]) {
      expect(takes, name).toContain(name);
    }
  });
});
