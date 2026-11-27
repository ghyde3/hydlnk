import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PLAN_LIMITS } from "@/lib/limits/table";
import { INVITES_PER_DAY, INVITE_TTL_DAYS, SHARED_SITES_PER_MEMBER } from "@/lib/team/constants";

/**
 * M19-05: the team numbers in TypeScript equal the ones the SQL enforces (pgTAP 225 and 228 prove the
 * SQL side). The per-site member cap is checked against plan_site_members by limits-parity.
 */
vi.mock("server-only", () => ({}));

const sql = readFileSync("supabase/migrations/20261126220300_site_team_functions.sql", "utf8");
const tables = readFileSync("supabase/migrations/20261126220100_site_team_tables.sql", "utf8");
const rule = readFileSync("supabase/migrations/20261126220000_site_access_rule.sql", "utf8");
// accept_site_invite's current definition (S1 replaced it).
const fixes = readFileSync("supabase/migrations/20261126220400_team_review_fixes.sql", "utf8");

describe("M19-05 team constants mirror the SQL", () => {
  it("M19-05 20 invites a day, 50 shared sites, 7 days, Studio 10", () => {
    expect(sql).toContain(`interval '24 hours') >= ${INVITES_PER_DAY} then`);
    expect(sql).toContain(`m.user_id = p_user) >= ${SHARED_SITES_PER_MEMBER} then`);
    expect(sql).toContain(`now() + interval '${INVITE_TTL_DAYS} days'`);
    expect(tables).toContain(`created_at + interval '${INVITE_TTL_DAYS} days'`);
    expect(rule).toContain(`when 'studio' then ${PLAN_LIMITS.studio.siteMembers} else 0 end`);
    expect(fixes).toContain(`m.user_id = p_user) >= ${SHARED_SITES_PER_MEMBER} then`);
  });

  it("R13: the refusal sentences read the constants, never a copy of the numbers", async () => {
    const { TEAM_MESSAGES } = await import("@/lib/team/core");
    expect(TEAM_MESSAGES.team_limit).toContain(`${PLAN_LIMITS.studio.siteMembers} members`);
    expect(TEAM_MESSAGES.invite_limit).toContain(`${INVITES_PER_DAY} invites`);
    expect(TEAM_MESSAGES.shared_site_limit).toContain(`${SHARED_SITES_PER_MEMBER} sites`);
    const source = readFileSync("src/lib/team/core.ts", "utf8");
    const block = source.slice(source.indexOf("export const TEAM_MESSAGES"), source.indexOf("export type TeamFailure"));
    expect(block).not.toMatch(/\b\d+\b/);
  });
});
