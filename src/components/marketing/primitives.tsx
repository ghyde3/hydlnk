import Link from "next/link";
import type { ReactNode } from "react";

/** Content column of every marketing section: 1200px max, 24px gutters. */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-[1200px] px-6 ${className}`}>{children}</div>;
}

export const SECTION_Y = "py-[clamp(56px,11vw,96px)]";

const TONES = {
  white: "bg-surface",
  page: "bg-page",
  ink: "bg-ink text-on-ink",
} as const;

/**
 * A full-width band. Bands alternate white and #F4F3F0 with a 1px divider between them; the
 * content sits in the 1200px Container.
 */
export function Section({
  id,
  tone = "white",
  labelledBy,
  className = "",
  containerClassName = "",
  children,
}: {
  id?: string;
  tone?: keyof typeof TONES;
  labelledBy?: string;
  className?: string;
  containerClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={`border-b border-line ${TONES[tone]} ${SECTION_Y} ${className}`}
    >
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}

/** Mono uppercase label above a heading. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-xs tracking-[0.08em] text-text-2 uppercase ${className}`}>
      {children}
    </p>
  );
}

export const H1 = "text-[clamp(38px,8.5vw,60px)] leading-[1.04] font-bold tracking-[-0.03em]";
export const H2 = "text-[clamp(28px,6.5vw,40px)] leading-[1.12] font-bold tracking-[-0.025em]";
export const H3 = "text-[17px] leading-snug font-semibold";
export const LEAD = "text-[clamp(16px,4.2vw,18px)] leading-[1.6] text-text-2";
export const BODY = "text-[15px] leading-[1.65] text-text-2";

/** Eyebrow, h2 and lead at the top of a section. */
export function SectionIntro({
  eyebrow,
  title,
  titleId,
  lead,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`max-w-[720px] ${className}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 id={titleId} className={`${eyebrow ? "mt-3.5" : ""} ${H2}`}>
        {title}
      </h2>
      {lead ? <p className={`mt-4 ${LEAD}`}>{lead}</p> : null}
    </div>
  );
}

/** Small mono tag: "Pro" (brass), "Every plan" (neutral), "Verified" (good). */
export function Chip({
  tone,
  children,
  className = "",
}: {
  tone: "brass" | "neutral" | "good";
  children: ReactNode;
  className?: string;
}) {
  const colors =
    tone === "brass"
      ? "bg-brass-soft text-brass-soft-text"
      : tone === "good"
        ? "bg-good-bg text-[#2B7448]"
        : "bg-page text-text-2";
  return (
    <span
      className={`inline-block rounded-sm px-2 py-[3px] font-mono text-[11px] tracking-[0.06em] uppercase ${colors} ${className}`}
    >
      {children}
    </span>
  );
}

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-[18px] text-sm font-semibold whitespace-nowrap";

const BUTTON_VARIANTS = {
  primary: "bg-ink text-surface",
  secondary: "border border-line-3 bg-surface text-ink",
  brass: "bg-brass text-ink",
  "on-ink": "border border-ink-line text-on-ink",
} as const;

/**
 * A link styled as a button (44px tall). Internal paths use next/link; absolute URLs (the app
 * host) are plain anchors.
 */
export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  className?: string;
  children: ReactNode;
}) {
  const classes = `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`;
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={classes}>
      {children}
    </a>
  );
}

/** "Read the guide →" style text link with a 44px tap area. */
export function ArrowLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink underline decoration-line-3 underline-offset-4 hover:decoration-ink ${className}`}
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

/** Check mark used in plan and feature lists. */
export function Check({ className = "stroke-ink" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`mt-0.5 size-4 shrink-0 fill-none stroke-[2] ${className}`}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Outline icon frame: a 24px viewBox drawn with the current color. */
export function Icon({ children, className = "size-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`fill-none stroke-current stroke-[1.8] ${className}`}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** 40px icon tile used on feature cards. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-page text-brass-text">
      {children}
    </div>
  );
}
