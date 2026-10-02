import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockedLinksInPublished, browserHostOf, judgeHost } from "@/lib/blocklist";
import { isHttpUrl, type PublishDoc } from "@/lib/document";
import { stackIsUp } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M5-03: the matching table (tests/unit/fixtures/blocklist-cases.json), run through the one
 * implementation (public.blocked_links_in in the database) with the secret key, plus a differential
 * check of the host reading against the browser's own URL parser. The pgTAP file repeats the
 * headline cases by hand.
 */
interface Case {
  url: string;
  expect: "blocked" | "allowed";
  host?: string;
  reason?: string;
  /** Set where the Publish check answers differently from the database (see the fixture's comment). */
  publish?: "allowed" | "invalid";
  in?: "link" | "card" | "embed" | "image" | "grid-cell" | "social-icon";
}
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/unit/fixtures/blocklist-cases.json"), "utf8"),
) as { blockedDomains: string[]; cases: Case[] };

function draftFor(url: string, where: Case["in"] = "link"): unknown {
  const block = (() => {
    switch (where) {
      case "card":
        return {
          id: "b-1",
          type: "card",
          visible: true,
          title: "T",
          caption: "",
          url,
          image: null,
        };
      case "embed":
        return { id: "b-1", type: "embed", visible: true, caption: "", url };
      case "image":
        return { id: "b-1", type: "image", visible: true, image: null, alt: "a", url };
      case "grid-cell":
        return {
          id: "b-1",
          type: "grid",
          visible: true,
          cells: [
            { id: "c-1", title: "A", subtitle: "", url: "https://ok.example" },
            { id: "c-2", title: "B", subtitle: "", url },
          ],
        };
      case "social-icon":
        return {
          id: "b-1",
          type: "social",
          visible: true,
          icons: [{ id: "i-1", platform: "github", url }],
        };
      default:
        return { id: "b-1", type: "link", visible: true, label: "L", url };
    }
  })();
  return {
    version: 1,
    rev: 1,
    profile: { name: "A", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: [block],
  };
}

/** A published form holding just this URL where `where` says, for the Publish check. */
function publishedFor(url: string, where: Case["in"] = "link"): PublishDoc {
  const draft = draftFor(url, where) as { blocks: unknown[] };
  return { blocks: draft.blocks } as unknown as PublishDoc;
}

describe("M5-03 the Publish check (the authority): the same table, read with the platform's URL parser", () => {
  // What Publish stores is the schema's `trim()` of the draft's URL, and only a URL that passes
  // `isHttpUrl` gets that far. The check then reads that URL exactly as a browser would.
  it.each(fixture.cases)("$expect: $url ($in)", (c) => {
    const url = c.url.trim();
    const publishable = isHttpUrl(url);
    if (c.publish === "invalid") {
      expect(publishable, "the schema must refuse this URL before the check ever sees it").toBe(
        false,
      );
      return;
    }
    if (!publishable) {
      // Not a URL Publish can accept (the draft-only spellings: "https:host", "https:\\host", no scheme):
      // nothing to judge, and nothing that could be served.
      return;
    }
    const verdict = c.publish ?? c.expect;
    const errors = blockedLinksInPublished(publishedFor(url, c.in), fixture.blockedDomains);
    if (verdict === "allowed") {
      expect(errors, url).toEqual([]);
      return;
    }
    expect(errors, url).toHaveLength(1);
    expect(errors[0]).toMatchObject({ blockId: "b-1", field: "url", message: expect.any(String) });
    // The reason the browser's host gets from the built-in and listed rules is the fixture's.
    expect(judgeHost(browserHostOf(url)!, fixture.blockedDomains), url).toBe(c.reason);
    if (c.in === "grid-cell") expect(errors[0]!.itemId).toBe("c-2");
    if (c.in === "social-icon") expect(errors[0]!.itemId).toBe("i-1");
  });

  it("the table is not vacuous: most of it is publishable and judged, including every whitespace and ignored-code-point case that can publish", () => {
    const judged = fixture.cases.filter((c) => c.publish !== "invalid" && isHttpUrl(c.url.trim()));
    expect(judged.length).toBeGreaterThan(70);
    const spaced = judged.filter((c) => /^[\s\u00a0\ufeff]|[\s\u00a0\ufeff]$/.test(c.url));
    expect(spaced.length).toBeGreaterThan(20);
    const ignored = judged.filter((c) =>
      /[\u00ad\u034f\u180b-\u180f\u200b\u2060\u2064\ufe00-\ufe0f]|\u{e0100}|\u{e01ef}/u.test(c.url),
    );
    expect(ignored.length).toBeGreaterThan(8);
  });

  it("a host the database cannot read is judged on what the browser resolves: Publish, not the trigger, has the last word", () => {
    // U+1BCA0 is ignored by IDNA and not in the database's list: Postgres keeps a non-ASCII host and
    // calls it unverifiable; the browser's parser resolves it to the blocked host.
    const url = "https://blo\u{1bca0}cked.example/";
    const errors = blockedLinksInPublished(publishedFor(url), ["blocked.example"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.host).toBe("blocked.example");
  });

  it("a URL the parser cannot read is refused rather than served unchecked", () => {
    const errors = blockedLinksInPublished(publishedFor("https://"), []);
    expect(errors).toEqual([
      expect.objectContaining({ blockId: "b-1", field: "url", host: "invalid address" }),
    ]);
  });

  it("hidden blocks are not part of the published form, so only what is served is judged", () => {
    expect(
      blockedLinksInPublished({ blocks: [] } as unknown as PublishDoc, ["blocked.example"]),
    ).toEqual([]);
  });
});

const { run } = await stackIsUp();

describe.skipIf(!run)("M5-03 matching table (database function)", () => {
  let admin: SupabaseClient;
  const added: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    for (const domain of fixture.blockedDomains) {
      const existing = await admin.from("blocked_domains").select("domain").eq("domain", domain);
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data.length === 0) {
        const { error } = await admin.from("blocked_domains").insert({ domain, reason: "test" });
        if (error) throw new Error(error.message);
        added.push(domain);
      }
    }
  });

  afterAll(async () => {
    for (const domain of added) await admin.from("blocked_domains").delete().eq("domain", domain);
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

  it.each(fixture.cases)("$expect: $url ($in)", async (c) => {
    const found = await rows(draftFor(c.url, c.in));
    if (c.expect === "allowed") {
      expect(found).toEqual([]);
      return;
    }
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      host: c.host,
      reason: c.reason,
      block_id: "b-1",
      field: "url",
    });
    if (c.in === "grid-cell") expect(found[0]!.item_id).toBe("c-2");
    if (c.in === "social-icon") expect(found[0]!.item_id).toBe("i-1");
  });

  it("reads the host the way the browser's URL parser does", async () => {
    // A deterministic mix of schemes, credentials, case, percent-escapes, dots, ports and paths.
    const hosts = [
      "Example.COM",
      "ex%61mple.com",
      "example.com.",
      "a.b.example.org",
      "EXAMPLE.com.:8080",
      "ｅｘａｍｐｌｅ。ｃｏｍ",
    ];
    const prefixes = [
      "https://",
      "http://",
      "HTTPS://",
      "https:/",
      "https:///",
      "https:\\\\",
      "http:\\/",
    ];
    const users = ["", "u@", "u:p@", "x@y@", "@"];
    const tails = ["", "/", "/p?q=1#f", "?q", "#f", ":443", ":0/x"];
    const urls: string[] = [];
    for (const prefix of prefixes)
      for (const user of users)
        for (const host of hosts)
          urls.push(`${prefix}${user}${host}${tails[urls.length % tails.length]}`);
    let compared = 0;
    for (const url of urls) {
      let expected: string;
      try {
        expected = new URL(url).hostname.replace(/\.+$/, "");
      } catch {
        continue;
      }
      if (expected === "") continue;
      const { data, error } = await admin.rpc("blocklist_url_host", { p_url: url });
      expect(error).toBeNull();
      expect({ url, host: data }).toEqual({ url, host: expected });
      compared += 1;
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("classifies IP literals the way the browser does (any notation)", async () => {
    const ips = [
      "127.0.0.1",
      "0x7f.0.0.1",
      "0177.0.0.1",
      "2130706433",
      "127.1",
      "1.2.3.4.",
      "[::1]",
      "[::ffff:7f00:1]",
    ];
    for (const ip of ips) {
      const url = `http://${ip}/x`;
      const hostname = new URL(url).hostname;
      expect(/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[")).toBe(true);
      const found = await rows(draftFor(url));
      expect(found, url).toHaveLength(1);
      expect(found[0]!.reason).toBe("ip_literal");
    }
  });
});
