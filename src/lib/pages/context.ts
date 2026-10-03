import "server-only";
import { cache } from "react";
import { requireAppUser, type AppPage } from "@/lib/auth/gate";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentPage } from "./current";
import { PLAN_INFO, toPlan, type Plan } from "./plans";

export interface AppContext {
  user: { id: string; email: string };
  pages: AppPage[];
  current: AppPage;
  plan: Plan;
  pageLimit: number;
  /** `accounts.suspended_at` is set (M5-09): the banner shows and writes are disabled. */
  suspended: boolean;
}

/**
 * Everything the app chrome and the page-scoped screens need, loaded once per request (the layout
 * and the screen both call it): the gated user, their pages, the current page and the plan.
 * The plan is read with the user's own session under RLS (accounts: owner reads own row).
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const { user, pages } = await requireAppUser();
  const supabase = await createServerSupabase();
  const [current, account] = await Promise.all([
    getCurrentPage(user, pages),
    supabase.from("accounts").select("plan, suspended_at").eq("id", user.id).maybeSingle(),
  ]);
  if (account.error) throw new Error(`Loading the account failed: ${account.error.message}`);
  const plan = toPlan(account.data?.plan);
  return {
    user,
    pages,
    current,
    plan,
    pageLimit: PLAN_INFO[plan].maxPages,
    suspended: account.data?.suspended_at != null,
  };
});
