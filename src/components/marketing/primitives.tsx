import type { ReactNode } from "react";

/** Content column of every landing section: 1200px max, 24px gutters. */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-[1200px] px-6 ${className}`}>{children}</div>;
}

export const SECTION_Y = "py-[clamp(56px,11vw,88px)]";

/** Mono uppercase label above a section heading. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-xs tracking-[0.08em] text-text-2 uppercase ${className}`}>
      {children}
    </p>
  );
}

export const H2 = "text-[clamp(28px,6.5vw,40px)] leading-[1.12] font-bold tracking-[-0.025em]";

export const LEAD = "text-[17px] leading-[1.6] text-text-2";

/** Small mono tag: "Pro" (brass) and "Every plan" (neutral). */
export function Chip({
  tone,
  children,
  className = "",
}: {
  tone: "brass" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  const colors = tone === "brass" ? "bg-brass-soft text-brass-soft-text" : "bg-page text-text-2";
  return (
    <span
      className={`rounded-sm px-2 py-[3px] font-mono text-[11px] tracking-[0.06em] uppercase ${colors} ${className}`}
    >
      {children}
    </span>
  );
}
