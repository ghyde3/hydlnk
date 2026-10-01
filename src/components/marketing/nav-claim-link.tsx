"use client";

import type { ReactNode } from "react";
import { signupUrl } from "./signup-handoff";

/**
 * The nav's "Claim your link". It is an ordinary link to <app origin>/signup. When the visitor has
 * already typed a name into the hero form, the click carries it along instead of dropping it.
 */
export function NavClaimLink({
  href,
  rootDomain,
  className,
  children,
}: {
  href: string;
  rootDomain: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        // Leave new-tab and new-window clicks to the browser; only a plain click carries the name.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        const typed = document.querySelector<HTMLInputElement>("#hero-handle")?.value ?? "";
        const destination = signupUrl(rootDomain, typed);
        if (destination === href) return;
        event.preventDefault();
        window.location.assign(destination);
      }}
    >
      {children}
    </a>
  );
}
