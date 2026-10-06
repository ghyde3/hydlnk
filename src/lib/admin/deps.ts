import "server-only";
import { createDomainDeps } from "@/lib/domains/deps-server";
import { clientEnv } from "@/lib/env/client";
import { invalidateAccountPages, invalidateHandle } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { readAdminUserIds, isLocalRootDomain } from "./env";
import { LOCAL_ADMIN_CLAIM } from "./principal";
import type { AdminDeps } from "./types";

/**
 * The real dependencies of the admin actions: the secret-key client, the page-cache invalidation of
 * Milestone 2 (`invalidateAccountPages` and `invalidateHandle`) and the "admins cannot be suspended"
 * rule. Built per call by `executeAdminAction`, and only for a verified admin.
 */
export function createAdminDeps(): AdminDeps {
  const db = createAdminSupabase();
  return {
    db,
    invalidateAccount: (accountId) => invalidateAccountPages(accountId),
    invalidateHandles: (handles) => {
      for (const handle of handles) invalidateHandle(handle);
    },
    async isProtectedAccount(accountId) {
      if (readAdminUserIds().has(accountId.toLowerCase())) return true;
      if (!isLocalRootDomain(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) return false;
      // The local test admin (principal.ts) is protected like a listed one.
      const { data } = await db.auth.admin.getUserById(accountId);
      return data.user?.app_metadata?.[LOCAL_ADMIN_CLAIM] === true;
    },
    now: () => new Date(),
    domainDeps: () => ({ ...createDomainDeps(), admin: db }),
  };
}
