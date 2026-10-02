import Link from "next/link";
import { Logo } from "@/components/logo";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { MenuDisclosure } from "./menu-disclosure";
import { NavClaimLink } from "./nav-claim-link";
import { MAIN_NAV, type NavKey } from "./site-map";

const NAV_LINK =
  "relative inline-flex min-h-11 min-w-11 items-center px-3 text-sm whitespace-nowrap text-line-2 hover:text-on-ink aria-[current=page]:text-on-ink aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-1.5 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-brass";

const MENU_LINK =
  "flex min-h-12 items-center justify-between border-b border-ink-line px-1 text-base text-on-ink aria-[current=page]:text-ink-link";

/**
 * The charcoal bar on every marketing page. From 1080px the page links sit inline; below that
 * they move into the Menu disclosure. "Log in" stays visible at every width and "Claim your
 * link" from 760px (on phones it is inside the menu). `current` marks the page being viewed.
 */
export function SiteHeader({ current }: { current?: NavKey }) {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  const appUrl = appOrigin(rootDomain);
  const ariaCurrent = (key: NavKey) => (key === current ? ("page" as const) : undefined);

  return (
    <header className="relative z-30 bg-ink text-on-ink">
      <div className="mx-auto flex min-h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-6">
        <Link href="/" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <ul className="hidden items-center min-[1080px]:flex">
            {MAIN_NAV.map((item) => (
              <li key={item.key}>
                <Link href={item.href} aria-current={ariaCurrent(item.key)} className={NAV_LINK}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <a
            href={`${appUrl}/login`}
            className="inline-flex min-h-11 min-w-11 items-center px-3 text-sm whitespace-nowrap text-on-ink"
          >
            Log in
          </a>
          <NavClaimLink
            href={`${appUrl}/signup`}
            rootDomain={rootDomain}
            className="ml-2 hidden min-h-11 items-center rounded-md bg-brass px-4 text-sm font-semibold whitespace-nowrap text-ink hl:inline-flex"
          >
            Claim your link
          </NavClaimLink>
          <MenuDisclosure
            className="ml-1 min-[1080px]:hidden"
            panelClassName="absolute inset-x-0 top-full border-t border-ink-line bg-ink px-6 pt-2 pb-6"
          >
            <ul className="mx-auto w-full max-w-[1200px]">
              {[...MAIN_NAV, { key: "faq" as const, href: "/faq", label: "FAQ" }].map((item) => (
                <li key={item.key}>
                  <Link href={item.href} aria-current={ariaCurrent(item.key)} className={MENU_LINK}>
                    {item.label}
                    <span aria-hidden="true" className="text-on-ink-muted">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mx-auto mt-5 flex w-full max-w-[1200px] flex-col gap-2 hl:hidden">
              <a
                href={`${appUrl}/signup`}
                className="flex min-h-11 items-center justify-center rounded-md bg-brass px-4 text-sm font-semibold text-ink"
              >
                Claim your link
              </a>
            </div>
          </MenuDisclosure>
        </nav>
      </div>
    </header>
  );
}
