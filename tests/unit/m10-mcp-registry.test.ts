/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
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

const { TOOLS } = await import("@/lib/mcp/tools");
const { registerTools } = await import("@/lib/mcp/server");
const { BLOCK_FIELD_KEYS, parseBlockFields } = await import("@/lib/mcp/block-fields");
const { MCP_INSTRUCTIONS } = await import("@/lib/mcp/instructions");
const { BLOCK_TYPES } = await import("@/lib/document");
import { makeDeps } from "./support/mcp-fakes";

/**
 * M10-21 and M12-05: fourteen tools, in one order, each with a title, the four annotations, its scope, a strict
 * input and a description written for the AI. This pins the table, the schemas (a snapshot, so a
 * change is visible in review) and the words.
 */

const TABLE = [
  [
    "list_pages",
    "List your pages",
    "hydlnk.read",
    { ro: true, destructive: false, idempotent: true },
  ],
  ["get_page", "Get a page", "hydlnk.read", { ro: true, destructive: false, idempotent: true }],
  [
    "get_analytics",
    "Get page analytics",
    "hydlnk.read",
    { ro: true, destructive: false, idempotent: true },
  ],
  [
    "get_domains",
    "List custom domains",
    "hydlnk.read",
    { ro: true, destructive: false, idempotent: true },
  ],
  [
    "update_profile",
    "Update the profile",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: true },
  ],
  [
    "add_block",
    "Add a block",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: false },
  ],
  [
    "update_block",
    "Update a block",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: true },
  ],
  [
    "move_block",
    "Move a block",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: true },
  ],
  [
    "remove_block",
    "Remove a block",
    "hydlnk.write",
    { ro: false, destructive: true, idempotent: true },
  ],
  [
    "create_page",
    "Add a page to a site",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: false },
  ],
  [
    "update_page_settings",
    "Change a page's settings",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: true },
  ],
  [
    "set_theme",
    "Change the theme",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: true },
  ],
  [
    "create_preview_link",
    "Create a preview link",
    "hydlnk.write",
    { ro: false, destructive: false, idempotent: false },
  ],
  [
    "publish_page",
    "Publish a page",
    "hydlnk.publish",
    { ro: false, destructive: true, idempotent: true },
  ],
] as const;

const HYPE =
  /amazing|powerful|seamless|revolutionary|game-?chang|supercharge|unlock|effortless|stunning|ultimate|best-in-class|cutting-edge|10x/i;

describe("the tool registry", () => {
  it("lists exactly the fourteen tools in this order with the pinned titles, scopes and annotations", () => {
    expect(
      TOOLS.map((tool) => [
        tool.name,
        tool.title,
        tool.scope,
        {
          ro: tool.annotations.readOnlyHint,
          destructive: tool.annotations.destructiveHint,
          idempotent: tool.annotations.idempotentHint,
        },
      ]),
    ).toEqual(TABLE.map((row) => [...row]));
  });

  it("sets openWorldHint to false on all fourteen, and readOnlyHint only on the first four", () => {
    for (const tool of TOOLS) expect(tool.annotations.openWorldHint).toBe(false);
    expect(TOOLS.map((tool) => tool.annotations.readOnlyHint)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("names are snake_case, at most 64 characters and unique", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z_]{0,63}$/);
  });

  it("a description is at most 800 characters of plain English: no hype word, no em dash, no exclamation mark", () => {
    for (const tool of TOOLS) {
      // add_block names the fields of every block type (the three newest are listed in `fields`).
      const max = tool.name === "add_block" ? 850 : 800;
      expect(
        tool.description.length,
        `${tool.name} is ${tool.description.length} characters`,
      ).toBeLessThanOrEqual(max);
      expect(tool.description).not.toMatch(HYPE);
      expect(tool.description).not.toContain("—");
      expect(tool.description).not.toContain("!");
    }
    for (const text of [MCP_INSTRUCTIONS]) {
      expect(text).not.toMatch(HYPE);
      expect(text).not.toContain("—");
      expect(text).not.toContain("!");
    }
  });

  it("every write tool says it changes the draft only, and publish_page says what it does", () => {
    for (const tool of TOOLS.filter(
      (item) => item.scope === "hydlnk.write" && item.name !== "create_preview_link",
    )) {
      expect(tool.description).toContain(
        "Changes the draft only. Nothing is live until publish_page.",
      );
    }
    const publish = TOOLS.find((tool) => tool.name === "publish_page")!;
    expect(publish.description).toContain(
      "Makes the saved draft live on the public page at once, replacing what visitors see. Only call it when the person has asked to publish.",
    );
    expect(TOOLS.find((tool) => tool.name === "remove_block")!.description).toContain(
      "cannot be undone from here",
    );
    expect(TOOLS.find((tool) => tool.name === "get_page")!.description).toContain(
      "the only way to learn block ids and image ids",
    );
  });

  it("the instructions are plain, at most 1,200 characters and name the flow", () => {
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(1200);
    for (const word of ["list_pages", "get_page", "publish_page", "ifRev", "conflict", "imageId"]) {
      expect(MCP_INSTRUCTIONS).toContain(word);
    }
    expect(MCP_INSTRUCTIONS).not.toMatch(/sb_|hl_at_|@|https?:/);
  });
});

describe("the inputs", () => {
  const schemas = Object.fromEntries(
    TOOLS.map((tool) => [
      tool.name,
      z.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input", unrepresentable: "any" }),
    ]),
  );

  it("every input is a strict object: an unknown key fails by name", () => {
    for (const tool of TOOLS) {
      const json = schemas[tool.name] as { type: string; additionalProperties: unknown };
      expect(json.type).toBe("object");
      expect(json.additionalProperties).toBe(false);
      const refused = tool.input.safeParse({ somethingElse: 1 });
      expect(refused.success).toBe(false);
    }
  });

  it("every property has a description sentence, pageId has a uuid format, and writes take ifRev", () => {
    for (const tool of TOOLS) {
      const json = schemas[tool.name] as {
        properties?: Record<string, { description?: string; format?: string }>;
      };
      for (const [key, property] of Object.entries(json.properties ?? {})) {
        expect(property.description, `${tool.name}.${key}`).toBeTruthy();
      }
      if (json.properties?.pageId) expect(json.properties.pageId.format).toBe("uuid");
      if (
        tool.scope === "hydlnk.write" &&
        tool.name !== "create_preview_link" &&
        tool.name !== "create_page" &&
        tool.name !== "set_theme"
      ) {
        expect(json.properties?.ifRev, `${tool.name} takes ifRev`).toBeTruthy();
      }
    }
  });

  it("no input can name a user, and no tool declares an output schema", () => {
    for (const tool of TOOLS) {
      const keys = Object.keys((schemas[tool.name] as { properties?: object }).properties ?? {});
      for (const key of keys) expect(key).not.toMatch(/user|owner|account|email|token|client/i);
    }
  });

  it("a snapshot of all fourteen schemas is kept in the repository", async () => {
    const pinned = JSON.stringify(
      TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        scope: tool.scope,
        annotations: tool.annotations,
        inputSchema: schemas[tool.name],
      })),
      null,
      2,
    );
    await expect(`${pinned}\n`).toMatchFileSnapshot("./__snapshots__/mcp-tools.json");
  });
});

describe("registration with the SDK", () => {
  it("registers each tool with its annotations, a pass-through schema that advertises the real input, and the ChatGPT security scheme", () => {
    const registered: Array<{ name: string; config: Record<string, any> }> = [];
    const server = {
      registerTool: (name: string, config: Record<string, any>) => {
        registered.push({ name, config });
        return {};
      },
    };
    registerTools(server as never, () => makeDeps().deps);
    expect(registered.map((item) => item.name)).toEqual(TOOLS.map((tool) => tool.name));
    for (const { name, config } of registered) {
      const tool = TOOLS.find((item) => item.name === name)!;
      expect(config.annotations).toEqual(tool.annotations);
      expect(config._meta).toEqual({ securitySchemes: [{ type: "oauth2", scopes: [tool.scope] }] });
      expect(config.outputSchema).toBeUndefined();
      // The SDK validates nothing: a bad value reaches runTool, which words the refusal.
      const standard = config.inputSchema["~standard"];
      expect(standard.validate({ surprise: true })).toEqual({ value: { surprise: true } });
      const json = standard.jsonSchema.input({ target: "draft-2020-12" });
      expect(json.additionalProperties).toBe(false);
    }
  });
});

describe("add_block's description matches the field schemas", () => {
  const add = TOOLS.find((tool) => tool.name === "add_block")!;
  const section = add.description
    .split("Fields by type (limits are characters): ")[1]!
    .split(" All types also take overrides.")[0]!;
  const segments = Object.fromEntries(
    section.split("; ").map((part) => [part.split(":")[0]!.trim(), part]),
  );

  // page_link, items and hours (M12-05) are listed in the `fields` property, so the description stays
  // inside its limit; the description points there.
  const IN_FIELDS = ["page_link", "items", "hours"] as const;
  const IN_DESCRIPTION = BLOCK_TYPES.filter(
    (type) => !(IN_FIELDS as readonly string[]).includes(type),
  );
  const fieldsText = (
    z.toJSONSchema(add.input, { io: "input" }) as unknown as {
      properties: { fields: { description: string } };
    }
  ).properties.fields.description;

  it("names every block type once", () => {
    expect(Object.keys(segments).sort()).toEqual([...IN_DESCRIPTION].sort());
    expect(add.description).toContain("page_link, items and hours see fields");
    for (const type of IN_FIELDS) {
      for (const key of BLOCK_FIELD_KEYS[type].filter((item) => item !== "overrides")) {
        expect(fieldsText, `${type}.${key}`).toContain(key);
      }
    }
  });

  it("lists, for each type, the field names the input takes, and the input takes nothing else", () => {
    for (const type of BLOCK_TYPES) {
      const keys = BLOCK_FIELD_KEYS[type].filter((key) => key !== "overrides");
      for (const key of keys) {
        if (!(IN_FIELDS as readonly string[]).includes(type)) {
          expect(segments[type], `${type} mentions ${key}`).toContain(key);
        }
      }
      const sample: Record<string, unknown> = {};
      for (const key of BLOCK_FIELD_KEYS[type])
        sample[key] = key === "overrides" ? {} : sampleValue(type, key);
      expect(
        parseBlockFields(type, sample, "add").ok,
        `${type} takes ${Object.keys(sample).join(", ")}`,
      ).toBe(true);
      expect(parseBlockFields(type, { ...sample, nope: 1 }, "add").ok).toBe(false);
    }
  });

  it("the type enum is every block type", () => {
    const json = z.toJSONSchema(add.input, { io: "input" }) as unknown as {
      properties: { type: { enum: string[] } };
    };
    expect(json.properties.type.enum).toEqual([...BLOCK_TYPES]);
  });
});

function sampleValue(type: string, key: string): unknown {
  if (type === "items" && key === "items") return [{ name: "A", price: "$1" }];
  if (type === "hours" && key === "days") {
    const day = { closed: true };
    return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  }
  if (key === "icons") return [{ platform: "github", url: "https://github.com/x" }];
  if (key === "links") return [{ store: "amazon", url: "https://example.com" }];
  if (key === "cells") return [{ title: "A" }, { title: "B" }];
  if (key === "items") return [{ question: "Q?", answer: "A." }];
  if (key === "icon") return "github";
  return "x";
}
