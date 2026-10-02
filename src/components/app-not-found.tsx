import Link from "next/link";
import { Card, ScreenBody, ScreenHeader } from "@/components/app/screen";
import { Logo } from "@/components/logo";
import { NOT_FOUND_COPY, NOT_FOUND_TITLE } from "@/lib/error-copy";

const LINK =
  "mt-1 inline-flex min-h-11 items-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface no-underline";

/**
 * The app host's 404 inside the signed-in shell (M5-20): the screen's own header and a card with a
 * link to the Editor. The shell (sidebar, tab bar) is drawn around it by `AppShellFrame`.
 */
export function AppNotFoundInShell() {
  return (
    <>
      <ScreenHeader breadcrumb="404" title={NOT_FOUND_TITLE} />
      <ScreenBody>
        <Card className="flex flex-col items-start gap-3">
          <p className="m-0 max-w-[520px] text-[15px] leading-relaxed text-text-2">
            {NOT_FOUND_COPY}
          </p>
          <Link href="/editor" className={LINK}>
            Go to the Editor
          </Link>
        </Card>
      </ScreenBody>
    </>
  );
}

/**
 * The same 404 for someone who is signed out (or has no page yet): a plain HYDLNK page, the
 * charcoal bar with the logo and the same card. The Editor link sends a signed-out visitor to sign-in.
 */
export function AppNotFoundPlain() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex min-h-14 items-center bg-ink px-4 text-on-ink hl:px-6">
        <Link href="/" aria-label="HYDLNK home" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
      </div>
      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-start justify-center gap-4 px-4 py-16 hl:px-6">
        <p className="font-mono text-xs tracking-[0.08em] text-text-2 uppercase">404</p>
        <h1 className="text-[clamp(28px,6vw,40px)] leading-[1.12] font-bold tracking-[-0.025em]">
          {NOT_FOUND_TITLE}
        </h1>
        <p className="max-w-[520px] text-base leading-relaxed text-text-2">{NOT_FOUND_COPY}</p>
        <Link href="/editor" className={LINK}>
          Go to the Editor
        </Link>
      </main>
    </div>
  );
}
