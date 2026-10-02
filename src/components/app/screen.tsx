import type { ReactNode } from "react";

/**
 * A screen's white header bar: a mono 12px breadcrumb over the 22px/700 title, with the content on
 * the --hl-page canvas below. Every screen renders exactly one of these, and its h1 is the only
 * h1 on the page.
 */
export function ScreenHeader({ breadcrumb, title }: { breadcrumb: string; title: string }) {
  return (
    <header className="border-b border-line bg-surface px-4 py-3.5 hl:px-8">
      <p className="font-mono text-xs text-text-2">{breadcrumb}</p>
      <h1 className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">{title}</h1>
    </header>
  );
}

/** Content area under the header; `max` caps the width of the cards (e.g. 920px for Settings). */
export function ScreenBody({
  children,
  maxWidth = "max-w-[880px]",
}: {
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="flex-1 px-4 py-4 hl:px-8 hl:py-6">
      <div className={`flex flex-col gap-3 ${maxWidth}`}>{children}</div>
    </div>
  );
}

/** White 1px-bordered card with 6px corners and 16-20px padding. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-line bg-surface p-4 hl:p-5 ${className}`}>
      {children}
    </section>
  );
}

/** The one placeholder card each unbuilt screen shows until its milestone fills it in. */
export function PlaceholderCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <p className="text-[15px] leading-relaxed text-text-2">{children}</p>
    </Card>
  );
}
