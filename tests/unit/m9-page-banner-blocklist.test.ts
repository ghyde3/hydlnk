import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockedLinksInPublished, browserHostOf, judgeHost } from "@/lib/blocklist";
import { isHttpUrl, type PublishDoc } from "@/lib/document";
import { stackIsUp } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M9-23: the support banner's link in the shared M5-03 matching table (the spellings fixture),
 * replayed for the banner's address: the Publish check (TypeScript, the platform's URL parser) and
 * the save-time check (the database function) agree for every spelling, and both report block
 * 'banner' with the banner's own id.
 */

interface Case {
  url: string;
  expect: "blocked" | "allowed";
  host?: string;
  reason?: string;
  publish?: "invalid" | "blocked" | "allowed";
  in?: string;
}
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/unit/fixtures/blocklist-cases.json"), "utf8"),
) as { blockedDomains: string[]; cases: Case[] };
const linkCases = fixture.cases.filter((c) => c.in === undefined);

const BANNER_ID = "ban-spell-001";
const draftWithBanner = (url: string) => ({
  version: 1,
  rev: 1,
  profile: { name: "A", bio: "", photo: null },
  theme: { ref: null, overrides: {} },
  banner: { id: BANNER_ID, visible: true, text: "Hello", label: "Go", url },
  blocks: [],
});

describe("M9-23 the shared matching table for the banner address: the Publish check (TypeScript)", () => {
  it.each(linkCases)("$expect: $url", (c) => {
    const url = c.url.trim();
    if (c.publish === "invalid") {
      expect(isHttpUrl(url)).toBe(false);
      return;
    }
    if (!isHttpUrl(url)) return;
    const doc = {
      blocks: [],
      banner: { id: BANNER_ID, visible: true, text: "Hello", label: "Go", url },
    } as unknown as PublishDoc;
    const errors = blockedLinksInPublished(doc, fixture.blockedDomains);
    const verdict = c.publish ?? c.expect;
    if (verdict === "allowed") {
      expect(errors).toEqual([]);
      return;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ blockId: "banner", itemId: BANNER_ID, field: "url" });
    expect(judgeHost(browserHostOf(url)!, fixture.blockedDomains)).toBe(c.reason);
  });

  it("the table is not vacuous", () => {
    expect(linkCases.length).toBeGreaterThan(80);
  });
});

const { run } = await stackIsUp();

describe.skipIf(!run)("M9-23 the same table against the database function (local Supabase)", () => {
  let admin: SupabaseClient;
  // A domain of this run's own, so the shared `blocked.example` row other specs add and remove is untouched.
  const DOMAIN = `ban${Math.random().toString(36).slice(2, 8)}.example`;

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    const { error } = await admin
      .from("blocked_domains")
      .insert({ domain: DOMAIN, reason: "test" });
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    await admin.from("blocked_domains").delete().eq("domain", DOMAIN);
  });

  const rows = async (draft: unknown) => {
    const { data, error } = await admin.rpc("blocked_links_in", { p_draft: draft });
    expect(error).toBeNull();
    return data as {
      block_id: string;
      item_id: string | null;
      field: string;
      host: string;
      reason: string;
    }[];
  };

  const mapped = linkCases
    .filter((c) => c.url.includes("blocked.example"))
    .map((c) => {
      const url = c.url.replaceAll("blocked.example", DOMAIN);
      const host =
        c.host !== undefined && c.host.length >= 500
          ? browserHostOf(url.trim())!.slice(-512)
          : c.host?.replaceAll("blocked.example", DOMAIN);
      return { ...c, url, host };
    });

  it.each(mapped)("$expect: $url", async (c) => {
    const found = await rows(draftWithBanner(c.url));
    expect(found.length === 0 ? "allowed" : "blocked").toBe(c.expect);
    if (c.expect === "blocked") {
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        block_id: "banner",
        item_id: BANNER_ID,
        field: "url",
        host: c.host,
        reason: c.reason,
      });
    }
  });

  it("covers most of the table", () => {
    expect(mapped.length).toBeGreaterThan(40);
  });

  it("a banner and a link block are refused together, each by its own id", async () => {
    const found = await rows({
      blocks: [{ id: "b-1", type: "link", visible: true, label: "L", url: `https://${DOMAIN}/a` }],
      banner: { id: BANNER_ID, url: `https://${DOMAIN}/b` },
    });
    expect(found.map((row) => [row.block_id, row.item_id]).sort()).toEqual([
      ["b-1", null],
      ["banner", BANNER_ID],
    ]);
  });

  it("a banner address that is not text, or a banner that is not an object, is skipped", async () => {
    expect(await rows({ blocks: [], banner: { id: BANNER_ID, url: 5 } })).toEqual([]);
    expect(await rows({ blocks: [], banner: "x" })).toEqual([]);
    expect(await rows({ blocks: [], banner: [] })).toEqual([]);
  });
});
