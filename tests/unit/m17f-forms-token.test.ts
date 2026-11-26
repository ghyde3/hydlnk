import { describe, expect, it, vi } from "vitest";
import { TOKEN_MAX_LENGTH, issueFormToken, readFormToken } from "@/lib/forms/token";

vi.mock("server-only", () => ({}));

/** M17-06 step 5: the confirm page's token. Bound to the site, the block and the client; signed; read in constant time. */

const NOW = new Date("2026-11-26T12:00:00.000Z");
const binding = {
  pageId: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
  blockId: "formSign01",
  client: "203.0.113.7",
  now: NOW,
  secret: "test-secret",
};
const later = (ms: number) => ({ ...binding, now: new Date(NOW.getTime() + ms) });

describe("M17-06 the form token", () => {
  it("reads back its own age and signature", () => {
    const token = issueFormToken(binding);
    expect(token).toMatch(/^v1\.\d{13}\.[0-9a-f]{64}$/);
    const read = readFormToken(token, later(2500));
    expect(read).toEqual({ ok: true, ageMs: 2500, signature: token.split(".")[2] });
  });

  it("a page id in another letter case is the same page", () => {
    const token = issueFormToken(binding);
    expect(readFormToken(token, { ...later(10), pageId: binding.pageId.toUpperCase() }).ok).toBe(
      true,
    );
  });

  it.each([
    ["another block", { blockId: "formSign02" }],
    ["another site", { pageId: "00000000-0000-4000-8000-000000000001" }],
    ["another client", { client: "198.51.100.9" }],
    ["another secret", { secret: "other" }],
  ])("is refused for %s", (_name, change) => {
    const token = issueFormToken(binding);
    expect(readFormToken(token, { ...later(3000), ...change })).toEqual({ ok: false });
  });

  it("refuses a forged signature, a changed time, a token from the future and junk", () => {
    const token = issueFormToken(binding);
    const [, at, sig] = token.split(".");
    const flipped = `${sig!.slice(0, -1)}${sig!.endsWith("0") ? "1" : "0"}`;
    expect(readFormToken(`v1.${at}.${flipped}`, later(3000)).ok).toBe(false);
    expect(readFormToken(`v1.${Number(at) - 60_000}.${sig}`, later(3000)).ok).toBe(false);
    expect(readFormToken(token, later(-1)).ok).toBe(false);
    for (const junk of ["", "v1", "v2.1.2", `v1.${at}.${"z".repeat(64)}`, `v1.${at}.${sig}.x`]) {
      expect(readFormToken(junk, later(3000)).ok, junk).toBe(false);
    }
  });

  it("refuses an over-long token before parsing it", () => {
    const token = issueFormToken(binding);
    expect(readFormToken(token + "a".repeat(TOKEN_MAX_LENGTH), later(3000))).toEqual({ ok: false });
  });

  it("an expired token still reads, with its age: the route decides (2 s to 1 h)", () => {
    const token = issueFormToken(binding);
    expect(readFormToken(token, later(3_600_001))).toMatchObject({ ok: true, ageMs: 3_600_001 });
  });
});
