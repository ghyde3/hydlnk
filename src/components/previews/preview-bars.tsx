import Link from "next/link";
import { StatusChip } from "@/components/editor/status-chip";
import type { PublishStatus } from "@/lib/editor/status";

const BAR = "flex flex-wrap items-center gap-x-4 gap-y-2 bg-ink px-4 py-2 text-on-ink hl:px-8";
const MONO = "font-mono text-xs";

/**
 * The slim bar on top of a shared draft (M6-10): it says what the page is and when the link stops
 * working. `role="status"`, one line from 760px, wrapping on a phone. It sits outside the page's own
 * root element, so HYDLNK tokens and the tenant's tokens never mix.
 */
export function ShareBar({ expires }: { expires: string }) {
  return (
    <div role="status" data-share-bar="" className={BAR}>
      <span className={MONO}>Draft preview. Not published yet.</span>
      <span className={`${MONO} text-on-ink-muted`}>This link expires {expires}.</span>
    </div>
  );
}

/**
 * The bar on top of the owner's draft preview (M6-11): the mono label, the same status chip as the
 * editor header (M2-27) and a "Back to editor" link, at least 44px tall.
 */
export function DraftPreviewBar({ status }: { status: PublishStatus }) {
  return (
    <div data-preview-bar="" className={BAR}>
      <span className={`${MONO} tracking-[0.06em] uppercase`}>Draft preview</span>
      <StatusChip status={status} />
      <Link
        href="/editor"
        className="inline-flex min-h-11 items-center rounded-md border border-ink-line px-3 text-[13px] font-semibold text-on-ink no-underline hl:ml-auto"
      >
        Back to editor
      </Link>
    </div>
  );
}
