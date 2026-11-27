import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { MembersScreen } from "@/components/team/members-screen";
import { PLAN_LIMITS } from "@/lib/limits";
import { getAppContext } from "@/lib/pages/context";
import { handleAddress } from "@/lib/pages/plans";
import { loadTeam } from "@/lib/team/queries";

export const metadata: Metadata = { title: "Members" };

/**
 * Members (Wave F, M19-09): who may work on the current site, for its owner only (a member's
 * request is the app's 404, and the team functions refuse anyone but the owner anyway). The invite
 * form, the members with their role and Remove, the pending invites with their expiry and Revoke,
 * the last 50 things members did, and the 10-member meter. On Free and Pro team access is not
 * included: the screen says so; members kept from a downgrade stay listed, marked paused.
 */
export default async function MembersPage() {
  const { user, current, plan } = await getAppContext();
  if (!current.access.isOwner) notFound();
  const team = await loadTeam(user.id, current.id);
  if (!team) notFound();
  return (
    <>
      <ScreenHeader breadcrumb={`${handleAddress(current.handle)} / members`} title="Members" />
      <ScreenBody>
        <MembersScreen
          key={current.id}
          siteId={current.id}
          cap={PLAN_LIMITS[plan].siteMembers}
          capOnStudio={PLAN_LIMITS.studio.siteMembers}
          team={team}
        />
      </ScreenBody>
    </>
  );
}
