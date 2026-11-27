/**
 * Wave F: test stand-ins for the one access rule's RPC (`public.site_access`). Fakes of the
 * secret-key client answer it from their own page and account rows: the owner's row when the user
 * owns the page, nothing otherwise (as the database does for a stranger).
 */
export interface FakePage {
  id: string;
  owner_id: string;
}
export interface FakeAccount {
  id: string;
  plan: string;
  suspended_at: string | null;
}

export function siteAccessAnswer(
  pages: readonly FakePage[],
  accounts: readonly FakeAccount[],
  args: unknown,
): { data: Record<string, unknown>[]; error: null } {
  const { p_site, p_user } = (args ?? {}) as { p_site?: string; p_user?: string };
  const page = pages.find((row) => row.id === p_site && row.owner_id === p_user);
  const account = accounts.find((row) => row.id === p_user);
  if (!page || !account) return { data: [], error: null };
  const active = account.suspended_at === null;
  return {
    data: [
      {
        site_id: page.id,
        owner_id: page.owner_id,
        role: "owner",
        is_owner: true,
        can_read: true,
        can_edit: active,
        can_publish: active,
        owner_plan: account.plan,
        state: active ? "active" : "suspended_self",
      },
    ],
    error: null,
  };
}
