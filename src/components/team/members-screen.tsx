"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Card } from "@/components/app/screen";
import type { TeamData } from "@/lib/team/core";
import { inviteMember, removeMember, revokeInvite, setMemberRole } from "@/lib/team/actions";
import { MEMBER_ROLES, ROLE_LABELS, type MemberRole } from "@/lib/team/constants";
import { TEAM_STUDIO_ONLY_MESSAGE } from "@/lib/team/messages";

/**
 * The members screen's client half (Wave F, M19-09). Every action is a Server Action that the
 * database decides (owner only, the plan, the caps); this draws the answers and refreshes the route.
 * HYDLNK UI tokens only; inputs at 16px; every control at least 44px.
 */

const ACTION_WORDS: Readonly<Record<string, string>> = {
  site_published: "published the site",
  design_published: "published the design",
  page_published: "published a page",
  post_published: "published a post",
  post_unpublished: "unpublished a post",
  entry_trashed: "moved something to the trash",
  entry_restored: "restored something from the trash",
  entry_deleted: "deleted a page",
  entry_purged: "deleted a post for good",
  page_created: "added a page",
  post_created: "added a post",
  revision_restored: "restored a revision",
  version_restored: "restored a version",
  term_renamed: "renamed a category or tag",
  term_deleted: "deleted a category or tag",
  schedule_set: "scheduled a change",
  schedule_canceled: "canceled a scheduled change",
  member_invited: "sent an invite",
  invite_revoked: "revoked an invite",
  member_joined: "joined",
  member_removed: "removed a member",
  member_left: "left",
  member_role_changed: "changed a member’s role",
};

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const BUTTON =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md px-3.5 text-sm font-semibold disabled:cursor-default disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-ink text-surface`;
const SECONDARY = `${BUTTON} border border-line bg-surface text-ink`;
const FIELD =
  "min-h-11 rounded-md border border-line bg-surface px-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass";

export function MembersScreen({
  siteId,
  cap,
  capOnStudio,
  team,
}: {
  siteId: string;
  /** Members plus invites the OWNER's plan allows (0: team access is not included). */
  cap: number;
  capOnStudio: number;
  team: TeamData;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; emailed: string } | null>(null);
  const emailId = useId();
  const roleId = useId();
  const paused = cap === 0;
  const used = team.members.length + team.invites.length;

  const run = (work: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const out = await work();
      if (!out.ok) setError(out.message ?? "Something went wrong. Try again.");
      router.refresh();
    });
  };

  const invite = (form: FormData) => {
    setLink(null);
    setError(null);
    startTransition(async () => {
      const out = await inviteMember(
        siteId,
        String(form.get("email") ?? ""),
        String(form.get("role") ?? ""),
      );
      if (!out.ok) {
        setError(out.message);
        return;
      }
      setLink({ url: out.inviteUrl, emailed: out.emailed });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="members-screen">
      {paused ? (
        <Card>
          <p className="text-[15px] leading-relaxed font-semibold text-ink">
            {TEAM_STUDIO_ONLY_MESSAGE}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-text-2">
            Invite editors and publishers to work on this site with you.
            {team.members.length > 0
              ? " The members below are paused until the site is on Studio again."
              : ""}
          </p>
          <Link href="/settings#plans" className={`${PRIMARY} mt-3 no-underline`}>
            See plans
          </Link>
        </Card>
      ) : (
        <Card>
          <h2 className="text-base font-bold">Invite someone</h2>
          <p className="mt-1 text-sm text-text-2" data-testid="members-meter">
            {used} of {cap} members and invites
          </p>
          <form action={invite} className="mt-3 flex flex-col gap-3 hl:flex-row hl:items-end">
            <label
              htmlFor={emailId}
              className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold"
            >
              Email
              <input
                id={emailId}
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="name@example.com"
                className={FIELD}
              />
            </label>
            <label htmlFor={roleId} className="flex flex-col gap-1 text-sm font-semibold">
              Role
              <select id={roleId} name="role" defaultValue="editor" className={FIELD}>
                {MEMBER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={pending || used >= cap} className={PRIMARY}>
              Send invite
            </button>
          </form>
          <p className="mt-2 text-xs leading-relaxed text-text-3">
            Editors change drafts. Publishers can also publish and schedule. Only you can change the
            site’s address, domains, billing and members, and see Analytics and Audience.
          </p>
          {link ? (
            <div className="mt-3 rounded-md border border-line p-3" data-testid="invite-link">
              <p className="text-sm font-semibold">
                {link.emailed === "sent"
                  ? "Invite sent. You can also share this link; it is shown only once."
                  : "We couldn’t email the invite. Share this link yourself; it is shown only once."}
              </p>
              <input
                readOnly
                aria-label="Invite link"
                value={link.url}
                onFocus={(event) => event.currentTarget.select()}
                className={`${FIELD} mt-2 w-full font-mono text-sm`}
              />
            </div>
          ) : null}
        </Card>
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-brass-soft px-3 py-2.5 text-sm text-brass-soft-text"
        >
          {error}
        </p>
      ) : null}

      <Card>
        <h2 className="text-base font-bold">Members</h2>
        {team.members.length === 0 ? (
          <p className="mt-1 text-sm text-text-2">Only you work on this site.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-line" data-testid="members-list">
            {team.members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-col gap-2 py-3 hl:flex-row hl:items-center"
              >
                <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                  {member.email}
                  {paused ? <span className="ml-2 text-xs text-text-3">Paused</span> : null}
                </span>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Role of ${member.email}`}
                    value={member.role}
                    disabled={pending || paused}
                    onChange={(event) =>
                      run(() =>
                        setMemberRole(siteId, member.userId, event.target.value as MemberRole),
                      )
                    }
                    className={FIELD}
                  >
                    {MEMBER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={pending}
                    className={SECONDARY}
                    onClick={() => {
                      if (window.confirm(`Remove ${member.email}? They lose access at once.`)) {
                        run(() => removeMember(siteId, member.userId));
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {team.invites.length > 0 ? (
        <Card>
          <h2 className="text-base font-bold">Pending invites</h2>
          <ul className="mt-2 flex flex-col divide-y divide-line" data-testid="invites-list">
            {team.invites.map((pendingInvite) => (
              <li
                key={pendingInvite.id}
                className="flex flex-col gap-2 py-3 hl:flex-row hl:items-center"
              >
                <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                  {pendingInvite.email}
                  <span className="block text-xs text-text-3">
                    {ROLE_LABELS[pendingInvite.role]} · Expires {dateOf(pendingInvite.expiresAt)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  className={SECONDARY}
                  onClick={() => run(() => revokeInvite(pendingInvite.id))}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-base font-bold">Recent activity</h2>
        {team.activity.length === 0 ? (
          <p className="mt-1 text-sm text-text-2">Nothing yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5" data-testid="activity-list">
            {team.activity.map((item, index) => (
              <li key={`${item.at}-${index}`} className="text-sm leading-snug text-text-2">
                <span className="text-ink [overflow-wrap:anywhere]">
                  {item.email ?? "A former member"}
                </span>{" "}
                {ACTION_WORDS[item.action] ?? "made a change"}
                {item.times > 1 ? ` (${item.times} times)` : null}
                <span className="text-text-3"> · {dateOf(item.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {paused ? null : (
        <p className="text-xs text-text-3">
          Studio includes up to {capOnStudio} members and invites per site.
        </p>
      )}
    </div>
  );
}
