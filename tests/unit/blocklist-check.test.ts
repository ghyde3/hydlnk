import { describe, expect, it, vi } from "vitest";
import {
  blockedHostsOf,
  checkBlocklist,
  findBlockedLinks,
  toPublishErrors,
  type BlocklistRpc,
} from "@/lib/blocklist";

/** M5-03: the Publish-side wrapper around the database check, with a stand-in client. */
const client = (result: { data: unknown; error: { message: string } | null }) => {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { rpc, admin: { rpc } as unknown as BlocklistRpc };
};

describe("M5-03 checkBlocklist", () => {
  it("calls the database function with the stored draft and nothing else", async () => {
    const { rpc, admin } = client({ data: [], error: null });
    const draft = { blocks: [] };
    await checkBlocklist(admin, draft);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("blocked_links_in", { p_draft: draft });
  });

  it("an empty answer means nothing is blocked", async () => {
    const { admin } = client({ data: [], error: null });
    expect(await checkBlocklist(admin, {})).toEqual({ links: [], hosts: [], errors: [] });
  });

  it("maps each blocked link to a publish error on its block (and item)", async () => {
    const { admin } = client({
      data: [
        {
          block_id: "b-1",
          item_id: null,
          field: "url",
          host: "blocked.example",
          reason: "blocked_domain",
        },
        {
          block_id: "b-2",
          item_id: "c-2",
          field: "url",
          host: "localhost",
          reason: "single_label",
        },
        {
          block_id: "b-3",
          item_id: null,
          field: "url",
          host: "blocked.example",
          reason: "blocked_domain",
        },
      ],
      error: null,
    });
    const check = await checkBlocklist(admin, {});
    expect(check.hosts).toEqual(["blocked.example", "localhost"]);
    expect(check.links).toHaveLength(3);
    expect(check.errors).toEqual([
      {
        blockId: "b-1",
        field: "url",
        message: "That site is blocked. Use a different link.",
        host: "blocked.example",
      },
      {
        blockId: "b-2",
        itemId: "c-2",
        field: "url",
        message: "That site is blocked. Use a different link.",
        host: "localhost",
      },
      {
        blockId: "b-3",
        field: "url",
        message: "That site is blocked. Use a different link.",
        host: "blocked.example",
      },
    ]);
  });

  it("throws when the database cannot answer, so the gate fails closed", async () => {
    const { admin } = client({ data: null, error: { message: "connection refused" } });
    await expect(checkBlocklist(admin, {})).rejects.toThrow(/connection refused/);
  });

  it("throws on an answer that is not a list", async () => {
    const { admin } = client({ data: { not: "a list" }, error: null });
    await expect(findBlockedLinks(admin, {})).rejects.toThrow(/no list/);
  });

  it("fails closed on a row it cannot read instead of treating it as clean", async () => {
    const { admin } = client({ data: [null, 7, { host: 1 }], error: null });
    await expect(findBlockedLinks(admin, {})).rejects.toThrow(/unreadable/);
  });

  it("toPublishErrors on no links is empty", () => {
    expect(toPublishErrors([])).toEqual([]);
  });

  it("blockedHostsOf reads the distinct sorted hosts back out of a failed Publish's errors", () => {
    expect(
      blockedHostsOf([
        { host: "b.example" },
        { host: "a.example" },
        { host: "b.example" },
        {},
        { host: 5 },
      ]),
    ).toEqual(["a.example", "b.example"]);
    expect(blockedHostsOf([])).toEqual([]);
  });
});
