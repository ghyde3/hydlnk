import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { siteInviteEmail, SITE_INVITE_SUBJECT } = await import("@/lib/team/invite-email");
const { hashInviteToken, isInviteToken, newInviteToken } = await import("@/lib/team/token");

/**
 * M19-08 (T13, T14): the invite email and the token. The email has a fixed subject and fixed words,
 * the role, the link and its expiry; no site name, no free text and no remote resource; a plain-text
 * part. A token is 256 random bits (43 base64url characters) and only its SHA-256 hex is stored.
 */
const URL = "http://app.localhost:3000/invite/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("M19-08 the invite email", () => {
  it("M19-08 fixed subject, the role, the link, 7 days; a plain-text part", async () => {
    const mail = await siteInviteEmail("noor@example.test", "publisher", URL);
    expect(mail.to).toBe("noor@example.test");
    expect(mail.subject).toBe(SITE_INVITE_SUBJECT);
    expect(mail.subject).toBe("You’re invited to work on a HYDLNK site");
    expect(mail.text).toContain("as a publisher");
    expect(mail.text).toContain(URL);
    expect(mail.text).toContain("7 days");
    expect(mail.text).not.toMatch(/<[a-z]/i);
    expect(mail.html).toContain(URL);
    expect((await siteInviteEmail("x@example.test", "editor", URL)).text).toContain("as an editor");
  });

  it("M19-08 no remote resource and nothing from a page: no image, font, stylesheet or site name", async () => {
    const mail = await siteInviteEmail("noor@example.test", "editor", URL);
    expect(mail.html).not.toMatch(/<img|<link|@import|url\(|<script|<iframe/i);
    const hrefs = [...mail.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([URL]);
    // The template takes no site name, handle or free text: its props are the role, the link, the days.
    const source = (await import("node:fs")).readFileSync("src/emails/site-invite.tsx", "utf8");
    expect(source).toMatch(/interface SiteInviteProps \{[\s\S]*roleLabel: string;[\s\S]*inviteUrl: string;[\s\S]*days: number;\s*\}/);
  });
});

describe("M19-08 invite tokens", () => {
  it("M19-08 256 random bits, base64url; distinct each time; the hash is 64 hex", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(isInviteToken(a)).toBe(true);
    expect(isInviteToken("short")).toBe(false);
    expect(isInviteToken(`${a}x`)).toBe(false);
    expect(hashInviteToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(a)).not.toContain(a);
  });
});
