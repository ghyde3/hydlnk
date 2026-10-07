import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The expiry sweep of gifts (M13-07), run by `POST /api/cron/end-expired-gifts`. `end_expired_gifts()`
 * clears every gift whose end has passed and writes the system `end_gift` audit rows in the same
 * statement (so the change and its row cannot part); this then expires the cached public pages of each
 * account it ended, which the database cannot do (the "Free" badge follows the plan). One account's
 * failed expiry never stops the others; the count of failures is returned so the route can answer 500
 * (the gifts are already ended, so a failure is logged, not retried: the pages' normal expiry is the
 * backstop).
 */
export async function sweepExpiredGifts(deps: {
  db: SupabaseClient;
  invalidateAccount: (accountId: string) => Promise<number>;
}): Promise<{ ended: number; failed: number }> {
  const { data, error } = await deps.db.rpc("end_expired_gifts");
  if (error) throw new Error(`Ending expired gifts failed: ${error.message}`);
  const ids = ((data ?? []) as { account_id: string }[]).map((row) => row.account_id);
  let failed = 0;
  for (const id of ids) {
    try {
      await deps.invalidateAccount(id);
    } catch {
      failed += 1;
    }
  }
  return { ended: ids.length, failed };
}
