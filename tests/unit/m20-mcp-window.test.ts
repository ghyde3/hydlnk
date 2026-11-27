import { describe, expect, it, vi } from "vitest";
import type { Block } from "@/lib/document";

vi.mock("server-only", () => ({}));

const { blockView, patchBlock } = await import("@/lib/mcp/doc-view");
const { parseBlockFields } = await import("@/lib/mcp/block-fields");

/**
 * Wave E, plan 3.7: the MCP tools do not schedule (a later wave). What they do with a block's window
 * today, stated by test: `get_page` shows it as stored; `add_block` and `update_block` cannot set it
 * (`schedule` is not a field of any block type: refused as an unknown field); `update_block` keeps the
 * window a block already has. The plan gate is the database's (HL017) at publish, whatever a client sends.
 */

const scheduled: Block = {
  id: "lnk-mcp-0001",
  type: "link",
  visible: true,
  label: "Tickets",
  url: "https://tickets.example/",
  schedule: { from: "2026-12-03T09:00:00Z", until: "2026-12-24T18:00:00Z" },
} as Block;

describe("M20-02 the MCP tools and a block's window", () => {
  it("M20-02 get_page shows the window as stored, and nothing for a block without one", () => {
    expect(blockView(scheduled)).toMatchObject({ schedule: scheduled.schedule });
    const { schedule: _s, ...plain } = scheduled;
    void _s;
    expect(blockView(plain as Block)).not.toHaveProperty("schedule");
  });

  it("M20-02 add_block and update_block cannot set a window: it is an unknown field", () => {
    for (const mode of ["add", "update"] as const) {
      const out = parseBlockFields("link", { label: "x", schedule: { from: "2026-12-03T09:00:00Z" } }, mode);
      expect(out.ok, mode).toBe(false);
      if (!out.ok) expect(out.issues[0]!.path).toBe("fields.schedule");
    }
  });

  it("M20-02 update_block keeps the window the block already has", () => {
    const fields = parseBlockFields("link", { label: "Tickets now" }, "update");
    expect(fields.ok).toBe(true);
    if (!fields.ok) return;
    const { block } = patchBlock(scheduled, fields.fields, new Map() as never);
    expect(block.schedule).toEqual(scheduled.schedule);
    expect((block as { label: string }).label).toBe("Tickets now");
  });
});
