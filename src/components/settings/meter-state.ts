import type { Meter, PlanId } from "@/lib/limits";

/**
 * How full a usage meter is (M5-19), as plain data so the rule is testable without rendering:
 *
 *   below 90%          "ok": the fill stays brass and nothing is said
 *   90% up to 100%     "almost": "Almost full", the fill turns --hl-bad
 *   100% or more       "full": the full sentence, the fill is --hl-bad
 *
 * A meter with no limit or a plan that does not include it (dashed) has no level, and a meter that
 * is already past its limit keeps the over-limit note it has had since M4-33 (the sentence for that
 * is more exact), so its level is "full" for the colour but no second line is added.
 */
export type MeterLevel = "ok" | "almost" | "full";

export const ALMOST_FULL_PERCENT = 90;
export const ALMOST_FULL_TEXT = "Almost full";

/**
 * The line under a full meter, by what the meter counts. Uploads use the sentence from the
 * acceptance step word for word ("Remove an image or upgrade"); the others name their own thing, and
 * Studio (nothing above it to upgrade to) leaves the upgrade out.
 */
export function fullText(key: Meter["key"], plan: PlanId): string {
  const canUpgrade = plan !== "studio";
  switch (key) {
    case "uploads":
      return canUpgrade ? "Full. Remove an image or upgrade." : "Full. Remove an image.";
    case "pages":
      return canUpgrade ? "Full. Upgrade for more pages." : "Full.";
    case "domains":
      return canUpgrade ? "Full. Upgrade for more domains." : "Full.";
    case "themes":
      return canUpgrade ? "Full. Delete a theme or upgrade." : "Full. Delete a theme.";
  }
}

export function meterLevel(meter: Pick<Meter, "dashed" | "percent" | "over">): MeterLevel {
  if (meter.dashed) return "ok";
  if (meter.over || meter.percent >= 100) return "full";
  return meter.percent >= ALMOST_FULL_PERCENT ? "almost" : "ok";
}

/** The sentence a meter shows for its level, or null (ok, dashed, or already carrying the over-limit note). */
export function meterStateText(meter: Meter, plan: PlanId): string | null {
  if (meter.over) return null;
  switch (meterLevel(meter)) {
    case "almost":
      return ALMOST_FULL_TEXT;
    case "full":
      return fullText(meter.key, plan);
    case "ok":
      return null;
  }
}
