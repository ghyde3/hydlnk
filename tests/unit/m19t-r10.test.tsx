// @vitest-environment node
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R10 (M19-09, M19-10, C18):
 *   1. Settings' "Members" link is the owner's: a member (on a shared current site) gets none.
 *   2. requireEntryAccess and requireTermAccess compare the URL's site id with the entry's
 *      case-insensitively (ids are stored lower case; a URL may carry upper case).
 *   3. A member's Share tab names the site's custom domain: the access helper (need read) decides and
 *      the page's own rule (getPrimaryDomain) answers; no access, no domain.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("@/components/settings/delete-page-dialog", () => ({ DeletePageDialog: () => null }));
const access = vi.fn();
vi.mock("@/lib/access/server", () => ({ siteAccessFor: access }));
const primary = vi.fn(async (_id: string) => "links.example.com");
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: primary }));

const { PagesCard } = await import("@/components/settings/pages-card");
const { requireEntryAccess, requireTermAccess } = await import("@/lib/access");
const { loadSharedPrimaryDomain } = await import("@/lib/team/shared-domain");

const SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENTRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  access.mockReset();
  primary.mockClear();
});

describe("R10 the Members link", () => {
  const page = { id: SITE, handle: "zq", name: "Site", published: true };
  it("shows for the owner of the current site", () => {
    expect(renderToStaticMarkup(createElement(PagesCard, { pages: [page], showMembers: true }))).toContain('href="/members"');
  });
  it("hides for a member", () => {
    expect(renderToStaticMarkup(createElement(PagesCard, { pages: [page], showMembers: false }))).not.toContain("/members");
  });
  it("the Settings screen passes the current site's isOwner", () => {
    expect(readFileSync("src/app/(editor)/app/(screens)/settings/page.tsx", "utf8")).toContain(
      "showMembers={current.access.isOwner}",
    );
  });
});

describe("R10 site ids from a URL compare case-insensitively", () => {
  const row = {
    site_id: SITE,
    owner_id: ACTOR,
    role: "owner",
    is_owner: true,
    can_read: true,
    can_edit: true,
    can_publish: true,
    owner_plan: "studio",
    state: "active",
  };
  const admin = (table: string) =>
    ({
      from: (name: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: name === table ? { id: ENTRY, site_id: SITE } : null, error: null }),
          }),
        }),
      }),
      rpc: async () => ({ data: [row], error: null }),
    }) as never;

  it("an entry named under its site's id in upper case is found", async () => {
    const out = await requireEntryAccess(admin("content_entries"), {
      actorId: ACTOR,
      entryId: ENTRY,
      siteId: SITE.toUpperCase(),
      need: "edit",
      source: "editor",
    });
    expect(out.ok).toBe(true);
  });

  it("a term named under its site's id in upper case is found", async () => {
    const out = await requireTermAccess(admin("content_terms"), {
      actorId: ACTOR,
      termId: ENTRY,
      siteId: SITE.toUpperCase(),
      need: "edit",
      source: "editor",
    });
    expect(out.ok).toBe(true);
  });

  it("another site's id is still not_found", async () => {
    const out = await requireEntryAccess(admin("content_entries"), {
      actorId: ACTOR,
      entryId: ENTRY,
      siteId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      need: "edit",
      source: "editor",
    });
    expect(out).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("R10 a member's Share tab names the site's custom domain", () => {
  it("with read access the page's primary domain is returned", async () => {
    access.mockResolvedValue({ ok: true, access: { siteId: SITE } });
    expect(await loadSharedPrimaryDomain(ACTOR, SITE)).toBe("links.example.com");
    expect(access).toHaveBeenCalledWith({ actorId: ACTOR, siteId: SITE, need: "read", source: "editor" });
    expect(primary).toHaveBeenCalledWith(SITE);
  });

  it("without access there is no domain and nothing is read", async () => {
    access.mockResolvedValue({ ok: false, reason: "not_found" });
    expect(await loadSharedPrimaryDomain(ACTOR, SITE)).toBeNull();
    expect(primary).not.toHaveBeenCalled();
  });

  it("the workspace reads it for a member and keeps the owner's own session read", () => {
    const layout = readFileSync("src/app/(editor)/app/(screens)/(workspace)/layout.tsx", "utf8");
    expect(layout).toContain("access.isOwner ? loadPrimaryDomain(current.id) : loadSharedPrimaryDomain(user.id, current.id)");
  });
});
