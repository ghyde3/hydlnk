import Link from "next/link";
import { LOCKED_TITLE, lockedBody } from "@/lib/versions/messages";

/**
 * What an account whose plan keeps no versions sees instead of the list (M6-50): Free, and a Pro
 * account that was downgraded (its rows are kept and come back on an upgrade). The number in the
 * sentence comes from the limits table. The screen makes no request to page_versions and calls
 * neither action while this shows.
 */
export function LockedCard() {
  return (
    <section
      data-testid="history-locked"
      className="flex flex-col items-start gap-3 rounded-md border border-line bg-surface p-4 hl:p-5"
    >
      <h2 className="m-0 text-sm font-semibold">{LOCKED_TITLE}</h2>
      <p className="m-0 max-w-[560px] text-[15px] leading-relaxed text-text-2">{lockedBody()}</p>
      <Link
        href="/settings#plans"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface hl:w-auto"
      >
        See plans
      </Link>
    </section>
  );
}
