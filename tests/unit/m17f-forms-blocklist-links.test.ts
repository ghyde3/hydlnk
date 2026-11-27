import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));
const findBlockedLinks = vi.fn();
vi.mock("@/lib/blocklist/check", () => ({ findBlockedLinks }));

const { asUrl, hasBlockedLink } = await import("@/lib/forms/store");
const { linksIn } = await import("@/lib/forms/contract");

/**
 * Forms attack pass, finding 4: the blocklist check of a contact message reads the same links the
 * field checks count (`linksIn`), glued to a word or not, and every kind of them reaches the
 * blocklist as an https URL of its own host.
 */
describe("forms attack pass finding 4: the blocklist sees every link", () => {
  it("asUrl gives each kind of link its host", () => {
    expect(asUrl("https://evil.example/x")).toBe("https://evil.example/x");
    expect(asUrl("HTTP://evil.example")).toBe("HTTP://evil.example");
    expect(asUrl("ftp://evil.example/f")).toBe("https://evil.example/f");
    expect(asUrl("mailto:boss@evil.example?subject=x")).toBe("https://evil.example");
    expect(asUrl("www.evil.example")).toBe("https://www.evil.example");
    expect(asUrl("evil.example/login")).toBe("https://evil.example/login");
    for (const link of ["ftp://evil.example/f", "mailto:a@evil.example", "evil.example/login"]) {
      expect(new URL(asUrl(link)).hostname).toBe("evil.example");
    }
  });

  it("glued links reach the blocklist, one stand-in block each", async () => {
    findBlockedLinks.mockResolvedValue([{ reason: "blocked_domain" }]);
    const message =
      "x_https://evil.example/a xhttps://evil.example 1www.evil.example mailto:a@evil.example";
    expect(await hasBlockedLink(linksIn(message))).toBe(true);
    const doc = findBlockedLinks.mock.calls[0]![1] as { blocks: { url: string }[] };
    expect(doc.blocks.map((block) => new URL(block.url).hostname)).toEqual([
      "evil.example",
      "evil.example",
      "www.evil.example",
      "evil.example",
    ]);
  });
});
