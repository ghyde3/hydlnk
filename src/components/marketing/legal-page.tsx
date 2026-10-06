import type { ReactNode } from "react";
import { Container, Eyebrow, H1, LEAD } from "./primitives";
import { MarketingShell } from "./shell";
import type { NavKey } from "./site-map";

/** The date shown on a legal page unless it passes its own. */
export const LEGAL_UPDATED = { iso: "2026-10-02", label: "October 2, 2026" } as const;
/** The Privacy Policy changed on this date (staff may view a draft for support, Wave N; before that, the connected AI apps section). */
export const PRIVACY_UPDATED = { iso: "2026-10-06", label: "October 6, 2026" } as const;
/** The Terms changed on this date (the Free plan traffic section). */
export const TERMS_UPDATED = { iso: "2026-10-06", label: "October 6, 2026" } as const;

/**
 * Privacy and Terms: the page chrome, an h1 with the last-updated date, a contents list and the
 * text in a column no wider than 70 characters.
 */
export function LegalPage({
  current,
  title,
  intro,
  toc,
  updated = LEGAL_UPDATED,
  children,
}: {
  current: NavKey;
  title: string;
  intro: ReactNode;
  toc: readonly (readonly [string, string])[];
  updated?: { iso: string; label: string };
  children: ReactNode;
}) {
  return (
    <MarketingShell current={current}>
      <article aria-labelledby="page-title">
        <header className="border-b border-line bg-surface pt-[clamp(32px,7vw,64px)] pb-[clamp(36px,7vw,56px)]">
          <Container>
            <Eyebrow>Legal</Eyebrow>
            <h1 id="page-title" className={`mt-3 ${H1}`}>
              {title}
            </h1>
            <p className="mt-4 font-mono text-sm text-text-2">
              Last updated <time dateTime={updated.iso}>{updated.label}</time>
            </p>
            <div className={`mt-5 max-w-[70ch] ${LEAD}`}>{intro}</div>
          </Container>
        </header>
        <div className="bg-surface py-[clamp(40px,8vw,72px)]">
          <Container className="grid gap-10 min-[1080px]:grid-cols-[260px_minmax(0,1fr)] min-[1080px]:gap-16">
            <nav
              aria-label="Contents"
              className="min-[1080px]:sticky min-[1080px]:top-6 min-[1080px]:self-start"
            >
              <p className="font-mono text-[11px] tracking-[0.08em] text-text-2 uppercase">
                Contents
              </p>
              <ol className="mt-2 border-l border-line">
                {toc.map(([id, label], index) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="-ml-px flex min-h-11 items-center gap-2 border-l-2 border-transparent py-1 pl-3 text-sm text-text-2 hover:border-ink hover:text-ink"
                    >
                      <span className="w-5 shrink-0 font-mono text-xs text-text-3">
                        {index + 1}
                      </span>
                      {label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="prose-hl min-w-0">{children}</div>
          </Container>
        </div>
      </article>
    </MarketingShell>
  );
}
