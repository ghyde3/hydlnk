import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

const FOOTER_LINK = "inline-flex min-h-11 min-w-11 items-center px-3 text-[13px] text-text-2";

export function SiteFooter() {
  const origin = rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);

  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 py-2.5">
        <div className="flex min-h-11 items-center gap-2.5">
          <span aria-hidden="true" className="inline-block size-2 rotate-45 bg-brass" />
          <span className="text-[13px] font-bold tracking-[0.14em]">HYDLNK</span>
          <span className="ml-1.5 text-[13px] text-text-2">© {new Date().getFullYear()}</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-1">
          <a href={`${origin}/privacy`} className={FOOTER_LINK}>
            Privacy
          </a>
          <a href={`${origin}/terms`} className={FOOTER_LINK}>
            Terms
          </a>
        </nav>
      </div>
    </footer>
  );
}
