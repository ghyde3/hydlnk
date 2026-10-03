import { expect, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { rand } from "../fixtures/data";

/**
 * Shared by the Domains screen specs (tests/e2e/m4/domains-ui*.spec.ts): rows seeded with the
 * secret key (the screen only reads them), a hostname per row that no other spec uses, and the
 * screenshot hook that writes tmp/screens/domains-<name>-<width>.png when HL_DOMAINS_SHOTS is set.
 *
 * The database refuses a row past the owner's plan limit even for the secret key (the M4-12
 * trigger), so a spec that seeds more than one domain signs in a Studio account.
 */

export const domainHost = (label: string): string => `zq-${label}-${rand(5)}.example.test`;

export interface SeedOptions {
  status?: "pending" | "verified" | "error";
  /** Hours to move created_at into the past (M5-18's 48 hours). */
  ageHours?: number;
  createdAt?: string;
}

export async function seedDomain(
  pageId: string,
  hostname: string,
  options: SeedOptions = {},
): Promise<string> {
  const status = options.status ?? "pending";
  const row: Record<string, unknown> = { page_id: pageId, hostname, status };
  if (status === "verified") row.verified_at = new Date().toISOString();
  if (options.createdAt) row.created_at = options.createdAt;
  else if (options.ageHours) {
    row.created_at = new Date(Date.now() - options.ageHours * 3_600_000).toISOString();
  }
  const { data, error } = await adminClient().from("domains").insert(row).select("id").single();
  if (error) throw new Error(`seeding ${hostname} failed: ${error.message}`);
  return data.id as string;
}

export async function domainRow(id: string) {
  const { data, error } = await adminClient()
    .from("domains")
    .select("id, hostname, page_id, status, verified_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function markVerified(id: string): Promise<void> {
  const { error } = await adminClient()
    .from("domains")
    .update({ status: "verified", verified_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`marking ${id} verified failed: ${error.message}`);
}

/** The card of one hostname. */
export const cardOf = (page: Page, hostname: string) =>
  page.locator(`[data-domain-card="${hostname}"]`);

export async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.HL_DOMAINS_SHOTS) return;
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `tmp/screens/domains-${name}-${width}.png`, fullPage: true });
}

/** The phone tab bar's current tab, or the sidebar's, whichever the viewport shows. */
export async function expectDomainsNavCurrent(page: Page): Promise<void> {
  const links = page.getByRole("link", { name: "Domains", exact: true });
  const current = links.and(page.locator('[aria-current="page"]'));
  await expect(current.first()).toBeVisible();
}
