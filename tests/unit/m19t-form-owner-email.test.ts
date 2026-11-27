import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * R6 (M19-10, M17-07): the form block's "Email me each message" names the address the emails really
 * go to, the site OWNER's (notify.ts sends to the owner). On a shared site that is the owner's
 * sign-in address, never the member's own; on an own site it is the user's.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/server", () => ({ siteAccessFor: vi.fn() }));
vi.mock("@/lib/auth/gate", () => ({ requireAppUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));
vi.mock("./current", () => ({ getCurrentPage: vi.fn() }));

const { siteOwnerAddress } = await import("@/lib/pages/context");

describe("R6 the form's notification address is the site owner's", () => {
  it("a member on a shared site sees the owner's address", () => {
    expect(siteOwnerAddress({ ownerEmail: "owner@example.com", user: { id: "m", email: "member@example.com" } })).toBe(
      "owner@example.com",
    );
  });

  it("the owner on their own site sees their own", () => {
    expect(siteOwnerAddress({ ownerEmail: null, user: { id: "o", email: "owner@example.com" } })).toBe("owner@example.com");
  });

  it("the workspace hands the form editor that address", () => {
    const layout = readFileSync("src/app/(editor)/app/(screens)/(workspace)/layout.tsx", "utf8");
    expect(layout).toContain("ownerEmail={siteOwnerAddress(context)}");
    expect(layout).not.toMatch(/Email=\{user\.email\}/);
    expect(readFileSync("src/components/blocks/forms/form-form.tsx", "utf8")).toContain("workspace?.ownerEmail");
  });
});
