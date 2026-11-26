// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { blockedBodyLinks, markdownUrls } from "@/lib/content/blocklist";
import { mapDbError } from "@/lib/content/errors";

vi.mock("server-only", () => ({}));

/** A stand-in for the database that blocks one host the way blocked_links_in does (no host over 2048). */
function fakeAdmin(blockedHost: string) {
  const sent: string[] = [];
  return {
    sent,
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      const blocks = (args.p_draft as { blocks: { id: string; url: string }[] }).blocks;
      const rows = blocks
        .filter((b) => {
          sent.push(b.url);
          if (b.url.length > 2048) return false;
          try {
            return new URL(b.url).hostname.replace(/^www\./, "") === blockedHost;
          } catch {
            return false;
          }
        })
        .map((b) => ({
          block_id: b.id,
          item_id: null,
          field: "url",
          host: blockedHost,
          url: b.url,
        }));
      return { data: rows, error: null };
    },
  };
}

describe("blocked links in a post body", () => {
  it("a url over 2048 characters is refused, not passed to a check that skips it", async () => {
    const url = `https://zq-blocked.example/${"a".repeat(2100)}`;
    const result = await blockedBodyLinks(fakeAdmin("zq-blocked.example"), {
      body: `[click](${url})`,
    });
    expect(result).toMatchObject({ ok: false, error: "blocked_link" });
  });

  it("a numeric reference without a semicolon is decoded like a browser does", () => {
    expect(markdownUrls("[x](https://www.zq-blocked&#46example/p)")).toContain(
      "https://www.zq-blocked.example/p",
    );
    expect(markdownUrls("[x](https://zq-blocked.example&#x2fp)")).toContain(
      "https://zq-blocked.example/p",
    );
  });

  it("a plain link whose host hides in a semicolon-less reference is refused", async () => {
    const result = await blockedBodyLinks(fakeAdmin("zq-blocked.example"), {
      body: "[x](https://www.zq-blocked&#46example/p)",
    });
    expect(result).toMatchObject({ ok: false, error: "blocked_link" });
  });

  it("a host that still holds an ampersand after decoding is refused", async () => {
    const result = await blockedBodyLinks(fakeAdmin("zq-blocked.example"), {
      body: "[x](https://a&b.example/p)",
    });
    expect(result).toMatchObject({ ok: false, error: "blocked_link" });
  });

  it("a scheme hidden by a semicolon-less reference is decoded", () => {
    expect(markdownUrls('<a href="https&#58//zq-blocked.example/p">x</a>')).toContain(
      "https://zq-blocked.example/p",
    );
  });

  it("srcset candidates and the other url attributes are checked", () => {
    const urls = markdownUrls(
      [
        '<img srcset="https://one.example/a.png 1x, https://two.example/b.png 2x">',
        '<video poster="https://three.example/p.png"></video>',
        '<form action="https://four.example/go"></form>',
        '<button formaction="https://five.example/go">b</button>',
      ].join("\n\n"),
    );
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://one.example/a.png",
        "https://two.example/b.png",
        "https://three.example/p.png",
        "https://four.example/go",
        "https://five.example/go",
      ]),
    );
  });

  it("an ordinary short link still passes", async () => {
    expect(
      await blockedBodyLinks(fakeAdmin("zq-blocked.example"), {
        body: "[ok](https://fine.example/a)",
      }),
    ).toBeNull();
  });
});

describe("mapDbError", () => {
  it("maps text jsonb refuses to a typed invalid, not a 500", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      mapDbError({ code: "22P05", message: "unsupported Unicode escape sequence" }),
    ).toMatchObject({
      ok: false,
      error: "invalid",
    });
    expect(mapDbError({ code: "PGRST102", message: "Empty or invalid json" })).toMatchObject({
      ok: false,
      error: "invalid",
    });
    spy.mockRestore();
  });
});
