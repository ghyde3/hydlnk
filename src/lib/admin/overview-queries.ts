import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { summarizeHealth, type CronJobRow, type HealthSummary } from "./health";
import { mapDomainHelp, type DomainHelp, type DomainHelpRow } from "./domains-help";
import {
  mapOverviewNumbers,
  mapSignups,
  SIGNUPS_DAYS,
  type OverviewNumbers,
  type SignupDay,
} from "./numbers";

/** Reads for the Overview, Health and Domains screens (M13-03, -04, -06): service-role functions only. */

export async function readOverviewNumbers(): Promise<OverviewNumbers> {
  const { data, error } = await createAdminSupabase().rpc("admin_overview_numbers");
  if (error) throw new Error(`Reading the overview numbers failed: ${error.message}`);
  return mapOverviewNumbers((data?.[0] ?? null) as Record<string, number | null> | null);
}

export async function readSignups(days = SIGNUPS_DAYS): Promise<SignupDay[]> {
  const { data, error } = await createAdminSupabase().rpc("admin_signups_per_day", {
    p_days: days,
  });
  if (error) throw new Error(`Reading the signups failed: ${error.message}`);
  return mapSignups(data);
}

export async function readHealth(now: Date = new Date()): Promise<HealthSummary> {
  const { data, error } = await createAdminSupabase().rpc("admin_cron_health");
  if (error) throw new Error(`Reading the cron health failed: ${error.message}`);
  return summarizeHealth((data ?? []) as CronJobRow[], now);
}

export async function readDomainsNeedingHelp(limit = 100): Promise<DomainHelp[]> {
  const { data, error } = await createAdminSupabase().rpc("admin_domains_needing_help", {
    p_limit: limit,
  });
  if (error) throw new Error(`Reading the domains failed: ${error.message}`);
  return mapDomainHelp(data as DomainHelpRow[] | null);
}
