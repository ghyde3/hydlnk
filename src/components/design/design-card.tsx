import { useId, type ReactNode } from "react";

/**
 * One of the Design screen's five style groups (M6-47): a card that is a section named by its
 * `h2`. The groups inside it are `h3` headings, so the page reads h1, h2, h3 with nothing skipped.
 * `section` is the value of `data-design-section`, the stable hook the specs use.
 */
export function DesignCard({
  section,
  title,
  children,
}: {
  section: "color" | "fonts" | "buttons" | "layout" | "background";
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      data-design-section={section}
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4 hl:p-5"
    >
      <h2 id={headingId} className="m-0 text-sm font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}
