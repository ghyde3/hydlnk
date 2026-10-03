"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PlanId } from "@/lib/limits";

const PlanContext = createContext<PlanId | null>(null);

/**
 * The signed-in account's plan (read once by the screens layout), so a client component deep in a
 * screen can show what the plan includes: the editor header's "Pro" chip on History (M6-50). It only
 * shapes the UI; the version actions and the database decide what the plan may read or restore.
 */
export function PlanProvider({ plan, children }: { plan: PlanId; children: ReactNode }) {
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}

/** The plan, or null outside the signed-in screens. */
export function useAccountPlan(): PlanId | null {
  return useContext(PlanContext);
}
