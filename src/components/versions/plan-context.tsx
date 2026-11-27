"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PlanId } from "@/lib/limits";

const PlanContext = createContext<PlanId | null>(null);

/**
 * The CURRENT SITE's plan, which is its owner's (read once by the screens layout from
 * `context.sitePlan`), so a client component deep in a screen can show what the site's plan includes:
 * the "Pro" chip on History (M6-50), scheduling on a block and a post, the toolbar's Pro items. On a
 * shared site that is the owner's plan, never the member's own (R4, Wave F): a Free member of a
 * Studio site sees Studio features. Account and billing UI reads `context.plan` instead. It only
 * shapes the UI; the actions and the database decide what the plan may do.
 */
export function PlanProvider({ plan, children }: { plan: PlanId; children: ReactNode }) {
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}

/** The current site's plan, or null outside the signed-in screens. */
export function useSitePlan(): PlanId | null {
  return useContext(PlanContext);
}
