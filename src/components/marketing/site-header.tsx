import Link from "next/link";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { Logo } from "@/components/logo";

/** Charcoal nav of the marketing site: logo and the way into the app. */
export function SiteHeader() {
  const appUrl = appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);

  return (
    <header className="bg-ink text-on-ink">
      <div className="mx-auto flex min-h-16 max-w-[1200px] items-center justify-between gap-4 px-4 hl:px-6">
        <Link href="/" aria-label="HYDLNK home" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <nav aria-label="Main">
          <a
            href={`${appUrl}/`}
            className="inline-flex min-h-11 min-w-11 items-center px-3 text-sm text-on-ink"
          >
            Log in
          </a>
        </nav>
      </div>
    </header>
  );
}
