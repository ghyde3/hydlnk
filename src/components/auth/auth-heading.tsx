import type { ReactNode } from "react";

/** The h1 and intro line every form column starts with. */
export function AuthHeading({ title, intro }: { title: string; intro?: ReactNode }) {
  return (
    <>
      <h1 className="text-[26px] leading-[1.15] font-bold tracking-[-0.02em] hl:text-[32px]">
        {title}
      </h1>
      {intro ? <p className="mt-2 text-[15px] leading-normal text-text-2">{intro}</p> : null}
    </>
  );
}
