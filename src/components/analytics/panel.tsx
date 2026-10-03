import type { ReactNode } from "react";

/**
 * A white 1px-bordered card (the same look as the shared `Card`), with a test id: the shared one
 * takes none, and the Analytics specs find each card by it.
 */
export function Panel({
  children,
  className = "",
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={`rounded-md border border-line bg-surface p-3.5 hl:p-5 ${className}`}
    >
      {children}
    </section>
  );
}
