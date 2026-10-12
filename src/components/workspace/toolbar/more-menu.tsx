"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { Icon } from "@/components/app/icon";
import { useAccountPlan } from "@/components/versions/plan-context";
import { UnpublishDialog } from "../unpublish-dialog";
import { useOptionalWorkspace } from "../workspace-context";
import { PLAN_LIMITS } from "@/lib/limits";
import { HISTORY_ROUTE } from "@/lib/versions/messages";
import { isPlainClick } from "./plain-click";
import { MENU_ITEM_CLASS, ToolbarMenu, ToolbarMenuItem, useMenuApi } from "./toolbar-menu";

/**
 * The toolbar's "⋯" menu (M7-05, `aria-label="More actions"`): "QR code" (to the Share tab's card,
 * `/share#qr`, focus on its first button) and "Version history" (`/editor/history`). A plain click on
 * History first writes the pending edits, so the screen it opens never reads a draft that is a step
 * behind what was just typed (M6-50); a modified click is left to the browser. An account whose
 * plan keeps no versions sees a brass-soft "Pro" chip beside the words, because that is where
 * History starts. "Unpublish" (M14-02) is there only while the site is published: it opens a
 * confirmation that names the address and says the draft stays. Opening the menu changes nothing
 * and sends nothing.
 */
export function MoreMenu({
  flush,
  onOpenShare,
}: {
  flush: () => Promise<boolean>;
  /** Goes to the Share tab's card and focuses its first control. */
  onOpenShare: (target: "qr") => void;
}) {
  const workspace = useOptionalWorkspace();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ToolbarMenu
        label="More actions"
        buttonLabel="More actions"
        buttonContent={<Icon icon={Ellipsis} size={18} />}
        buttonClassName="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface text-ink"
      >
        <MoreItems
          flush={flush}
          onOpenShare={onOpenShare}
          onUnpublish={() => setConfirming(true)}
        />
      </ToolbarMenu>
      {workspace ? (
        <UnpublishDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          onCloseFocus={() =>
            document.querySelector<HTMLElement>('button[aria-label="More actions"]')?.focus()
          }
        />
      ) : null}
    </>
  );
}

function MoreItems({
  flush,
  onOpenShare,
  onUnpublish,
}: {
  flush: () => Promise<boolean>;
  onOpenShare: (target: "qr") => void;
  onUnpublish: () => void;
}) {
  const router = useRouter();
  // Rendered alone (the toolbar's unit tests), there is no workspace and nothing to unpublish.
  const hasPublished = useOptionalWorkspace()?.hasPublished ?? false;
  const plan = useAccountPlan();
  const { close } = useMenuApi();
  const needsPro = plan !== null && PLAN_LIMITS[plan].versionsKept === 0;

  async function openHistory(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    close(false);
    try {
      await flush();
    } catch {
      // The screen reads the last saved draft.
    }
    router.push(HISTORY_ROUTE);
  }

  return (
    <>
      <ToolbarMenuItem asChild>
        <Link
          href="/share#qr"
          data-menu-item="qr"
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            close(false);
            onOpenShare("qr");
          }}
          className={MENU_ITEM_CLASS}
        >
          QR code
        </Link>
      </ToolbarMenuItem>
      <ToolbarMenuItem asChild>
        <a
          href={HISTORY_ROUTE}
          data-menu-item="history"
          data-history-link=""
          onClick={(event) => void openHistory(event)}
          className={MENU_ITEM_CLASS}
        >
          Version history
          {needsPro ? (
            <span
              data-history-pro-chip=""
              className="inline-block rounded-sm bg-brass-soft px-1.5 py-[2px] font-mono text-[11px] font-normal text-brass-soft-text"
            >
              Pro
            </span>
          ) : null}
        </a>
      </ToolbarMenuItem>
      {hasPublished ? (
        <ToolbarMenuItem
          data-menu-item="unpublish"
          onSelect={() => {
            close(false);
            onUnpublish();
          }}
          className={MENU_ITEM_CLASS}
        >
          Unpublish
        </ToolbarMenuItem>
      ) : null}
    </>
  );
}
