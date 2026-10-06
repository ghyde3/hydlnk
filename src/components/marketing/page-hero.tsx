import type { ReactNode } from "react";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { ButtonLink, Container, Eyebrow, H1, LEAD } from "./primitives";

/** The sign-up page on the app host: every "Claim your handle" button goes here. */
export function signupHref(): string {
  return `${appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/signup`;
}

/**
 * Top of every inner marketing page: eyebrow, the page's h1, a lead and the conversion pair
 * ("Claim your handle" on the app host, plus one secondary link). An optional visual sits to the
 * right from 1080px and below the copy on narrower screens.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  secondary = { href: "/pricing", label: "See pricing" },
  aside,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  secondary?: { href: string; label: string } | null;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="page-title"
      className="border-b border-line bg-surface pt-[clamp(40px,8vw,80px)] pb-[clamp(48px,9vw,88px)]"
    >
      <Container
        className={
          aside
            ? "grid items-center gap-x-16 gap-y-12 min-[1080px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
            : ""
        }
      >
        <div className="min-w-0 max-w-[760px]">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 id="page-title" className={`mt-4 ${H1}`}>
            {title}
          </h1>
          <p className={`mt-5 max-w-[600px] ${LEAD}`}>{lead}</p>
          <div className="mt-7 flex flex-wrap gap-2">
            <ButtonLink href={signupHref()} variant="primary">
              Claim your handle
            </ButtonLink>
            {secondary ? (
              <ButtonLink href={secondary.href} variant="secondary">
                {secondary.label}
              </ButtonLink>
            ) : null}
          </div>
          {children}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </Container>
    </section>
  );
}
