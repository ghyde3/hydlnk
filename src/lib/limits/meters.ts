import { formatUploadUsage } from "./format";
import { OVER_LIMIT_NOTE } from "./messages";
import { PLAN_LIMITS, type PlanId } from "./table";

/**
 * The numbers behind the usage meters on Settings & billing (M4-32, M4-33), as plain data so the
 * rules (Not included, no limit, over limit) are testable without rendering anything.
 */

/** What `public.account_usage(uid)` returns, camel-cased. */
export interface AccountUsage {
  pages: number;
  domains: number;
  savedThemes: number;
  uploadBytes: number;
}

export type MeterKey = "pages" | "domains" | "uploads" | "themes";

export interface Meter {
  key: MeterKey;
  label: string;
  /** The mono text at the right of the label: "2 / 3", "Not included", "18 / 100 MB", "5 · no limit". */
  text: string;
  /** Fill width as a percent, 0 to 100 (min(100%, used / limit)). */
  percent: number;
  /** A dashed, empty track instead of a filled one: no limit, or not included on this plan. */
  dashed: boolean;
  /** Used is more than the plan allows (after a downgrade). The fill stays at 100%. */
  over: boolean;
  /** The helper line under the meter; set only when `over`. */
  note: string | null;
}

function counted(key: MeterKey, label: string, used: number, limit: number): Meter {
  const over = used > limit;
  return {
    key,
    label,
    text: `${used} / ${limit}`,
    percent: limit > 0 ? Math.min(100, (used / limit) * 100) : 100,
    dashed: false,
    over,
    note: over ? OVER_LIMIT_NOTE : null,
  };
}

export function buildMeters(plan: PlanId, usage: AccountUsage): Meter[] {
  const limits = PLAN_LIMITS[plan];

  const pages = counted("pages", "Sites", usage.pages, limits.pages);

  // A plan with no custom domains shows "Not included", not "0 / 0". A kept domain past a downgrade
  // is still shown as what it is: used against a limit of 0, over.
  const domains: Meter =
    limits.customDomains === 0 && usage.domains === 0
      ? {
          key: "domains",
          label: "Custom domains",
          text: "Not included",
          percent: 0,
          dashed: true,
          over: false,
          note: null,
        }
      : counted("domains", "Custom domains", usage.domains, limits.customDomains);

  const uploadsOver = usage.uploadBytes > limits.uploadBytes;
  const uploads: Meter = {
    key: "uploads",
    label: "Uploads",
    text: formatUploadUsage(usage.uploadBytes, limits.uploadBytes),
    percent: Math.min(100, (usage.uploadBytes / limits.uploadBytes) * 100),
    dashed: false,
    over: uploadsOver,
    note: uploadsOver ? OVER_LIMIT_NOTE : null,
  };

  const themes: Meter =
    limits.savedThemes === null
      ? {
          key: "themes",
          label: "Saved themes",
          text: `${usage.savedThemes} · no limit`,
          percent: 0,
          dashed: true,
          over: false,
          note: null,
        }
      : counted("themes", "Saved themes", usage.savedThemes, limits.savedThemes);

  return [pages, domains, uploads, themes];
}
