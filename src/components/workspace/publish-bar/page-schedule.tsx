"use client";

import { useState } from "react";
import { PublishAlert } from "@/components/editor/publish-alert";
import { ScheduleControls } from "@/components/schedule/schedule-controls";
import type { PublishError } from "@/lib/document";
import {
  cancelScheduledChange,
  refusalMessage,
  scheduleChange,
  type Answer,
} from "@/lib/posts/client";
import { NO_SCHEDULE, type ScheduleAction } from "@/lib/schedule/types";
import { HOME_PAGE_ID } from "@/lib/site-pages/pages";
import { useWorkspace } from "../workspace-context";
import { ROW_BUTTON } from "./publish-bar-view";
import type { PublishRow } from "./rows";

/**
 * One page's schedule (Wave E, M20-07, M20-09, M20-10), inside the publish bar, as its revisions are:
 * where it stands, Schedule (the page's stored draft, checked now as Publish page would, goes live at
 * that time), an optional scheduled unpublish (never for Home), and Cancel. The workspace stores what
 * is typed first and sends the rev this tab holds (`schedulePage`). Refusals stay here as sentences;
 * a draft Publish page would refuse says "Fix these to schedule." in the dialog and lists every gate
 * error here with the alert Publish shows (`PublishAlert`), as the post editor does.
 */
export function PageSchedule({
  row,
  onBack,
  onChanged,
}: {
  row: PublishRow;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const { pageId, plan, schedulePage, pageRev, publishDisabledReason, state, site } = useWorkspace();
  // Re-render after a change, so the rev this tab holds is read again.
  const [, setRevTick] = useState(0);
  // The gate's errors of the last refused Schedule: the issues list Publish shows.
  const [issues, setIssues] = useState<PublishError[]>([]);
  const isHome = row.key === HOME_PAGE_ID;
  const blocks = isHome ? state.draft.blocks : (site.snapshotForms().get(row.key)?.blocks ?? []);

  async function send(
    request: (entryId: string, rev: number) => Promise<Answer<object>>,
  ): Promise<string | null> {
    setIssues([]);
    const out = await schedulePage<Answer<object>>(row.key, request);
    if (!out.ok) return out.message;
    const answer = out.value;
    if (answer.kind !== "ok") {
      if (answer.kind === "invalid" && answer.errors && answer.errors.length > 0) {
        setIssues(answer.errors);
        return "Fix these to schedule.";
      }
      return refusalMessage(answer);
    }
    await onChanged();
    setRevTick((n) => n + 1);
    return null;
  }

  const onSchedule = (action: ScheduleAction, runAt: string) =>
    send((entryId, rev) => scheduleChange(pageId, entryId, { rev, action, runAt }));
  const onCancel = (action: ScheduleAction) =>
    send((entryId, rev) => cancelScheduledChange(pageId, entryId, { rev, action }));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`page-schedule-${row.key}`}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button type="button" onClick={onBack} className={ROW_BUTTON}>
          Back
        </button>
        <div className="min-w-0">
          <p title={row.title} className="m-0 truncate text-sm font-semibold text-ink">
            {row.title}
          </p>
          <p className="m-0 text-xs text-text-2">Schedule</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3">
        <ScheduleControls
          summary={row.schedule ?? NO_SCHEDULE}
          currentRev={pageRev(row.key) ?? 0}
          allowUnpublish={!isHome}
          plan={plan}
          disabled={publishDisabledReason !== null}
          onSchedule={onSchedule}
          onCancel={onCancel}
        />
        <PublishAlert errors={issues} blocks={blocks} onDismiss={() => setIssues([])} />
      </div>
    </div>
  );
}
