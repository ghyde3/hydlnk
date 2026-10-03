import Link from "next/link";
import { HISTORY_TITLE } from "@/lib/versions/messages";

/**
 * The header of the version history screen (M6-50): the mono breadcrumb "<handle>.hydlnk.com /
 * history", the h1 and a "Back to editor" link (13px/600 underlined, 44px tall, like the editor's
 * "View live page"). Like every screen header it is the direct child of <main>, and its <p> is the
 * breadcrumb.
 */
export function HistoryHeader({ breadcrumb }: { breadcrumb: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-surface px-4 py-3.5 hl:px-8">
      <div className="min-w-0">
        <p className="font-mono text-xs text-text-2">{breadcrumb}</p>
        <h1 className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">
          {HISTORY_TITLE}
        </h1>
      </div>
      <Link
        href="/editor"
        className="inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline underline-offset-2"
      >
        Back to editor
      </Link>
    </header>
  );
}
