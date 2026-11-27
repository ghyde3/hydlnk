import { ROLE_LABELS, type SiteRole } from "@/lib/team/constants";
import { PUBLISH_FORBIDDEN_MESSAGE } from "@/lib/team/messages";

/**
 * The line above every screen while the current site is shared with the user (Wave F, M19-10): whose
 * site it is and the user's role; an editor is told who publishes.
 */
export function SharedSiteBanner({
  ownerEmail,
  role,
}: {
  ownerEmail: string | null;
  role: SiteRole;
}) {
  return (
    <div
      data-testid="shared-site-banner"
      className="border-b border-line bg-brass-soft px-4 py-2.5 text-sm leading-snug text-brass-soft-text hl:px-8"
    >
      <span>
        Shared with you
        {ownerEmail ? (
          <>
            {" "}
            by <span className="font-semibold text-ink [overflow-wrap:anywhere]">{ownerEmail}</span>
          </>
        ) : null}
        . You’re {role === "editor" ? "an" : "a"} {ROLE_LABELS[role].toLowerCase()}.
      </span>
      {role === "editor" ? <span> {PUBLISH_FORBIDDEN_MESSAGE}</span> : null}
    </div>
  );
}
