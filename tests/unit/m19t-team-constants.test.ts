import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/lib/limits/table";
import { INVITES_PER_DAY, INVITE_TTL_DAYS, SHARED_SITES_PER_MEMBER } from "@/lib/team/constants";

/**
 * M19-05: the team numbers in TypeScript equal the ones the SQL enforces (pgTAP 225 and 228 prove the
 * SQL side). The per-site member cap is checked against plan_site_members by limits-parity.
 */
const sql = readFileSync("supabase/migrations/20261126220300_site_team_functions.sql", "utf8");
const tables = readFileSync("supabase/migrations/20261126220100_site_team_tables.sql", "utf8");
const rule = readFileSync("supabase/migrations/20261126220000_site_access_rule.sql", "utf8");

describe("M19-05 team constants mirror the SQL", () => {
  it("M19-05 20 invites a day, 50 shared sites, 7 days, Studio 10", () => {
    expect(sql).toContain(`interval '24 hours') >= ${INVITES_PER_DAY} then`);
    expect(sql).toContain(`m.user_id = p_user) >= ${SHARED_SITES_PER_MEMBER} then`);
    expect(sql).toContain(`now() + interval '${INVITE_TTL_DAYS} days'`);
    expect(tables).toContain(`created_at + interval '${INVITE_TTL_DAYS} days'`);
    expect(rule).toContain(`when 'studio' then ${PLAN_LIMITS.studio.siteMembers} else 0 end`);
  });
});
