"use client";

import type { ReactNode } from "react";
import { signupUrl } from "./signup-handoff";

/**
 * The first claim field on the page that already has something typed in it: any ClaimForm input
 * (they all carry data-claim-handle), with the hero field as the fallback.
 */
function typedHandle(): string {
  const fields = document.querySelectorAll<HTMLInputElement>(
    "input[data-claim-handle], #hero-handle",
  );
  for (const field of fields) if (field.value.trim() !== "") return field.value;
  return "";
}

/**
 * The nav's "Claim your link". It is an ordinary link to <app origin>/signup. When the visitor has
 * already typed a name into a claim form on the page, the click carries it along instead of
 * dropping it.
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
        const destination = signupUrl(rootDomain, typedHandle());
        if (destination === href) return;
        event.preventDefault();
        window.location.assign(destination);
      }}
    >
      {children}
    </a>
  );
}
