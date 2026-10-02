import Link from "next/link";
import { Logo } from "@/components/logo";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { NavClaimLink } from "./nav-claim-link";

const NAV_LINK = "min-h-11 min-w-11 items-center px-3 text-sm whitespace-nowrap";
const SECTION_LINK = `${NAV_LINK} hidden text-line-2 hl:inline-flex`;

/**
 * Charcoal nav of the marketing site. On the landing page the section links are in-page anchors;
 * on other marketing pages (404) they point back at the landing page. Below 760px only the logo
 * and "Log in" remain.
 */
export function SiteHeader({ landing = false }: { landing?: boolean }) {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  const appUrl = appOrigin(rootDomain);
  const base = landing ? "" : "/";

  return (
    <header className="bg-ink text-on-ink">
      <div className="mx-auto flex min-h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-6">
        <Link href={landing ? "#top" : "/"} className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <a href={`${base}#features`} className={SECTION_LINK}>
            Features
          </a>
          <a href={`${base}#pricing`} className={SECTION_LINK}>
            Pricing
          </a>
          <a href={`${base}#faq`} className={SECTION_LINK}>
            FAQ
          </a>
          <a href={`${appUrl}/login`} className={`${NAV_LINK} inline-flex text-on-ink`}>
            Log in
          </a>
          <NavClaimLink
            href={`${appUrl}/signup`}
            rootDomain={rootDomain}
            className="ml-2 hidden min-h-11 items-center rounded-md bg-brass px-4 text-sm font-semibold text-ink hl:inline-flex"
          >
            Claim your link
          </NavClaimLink>
        </nav>
      </div>
    </header>
  );
}
