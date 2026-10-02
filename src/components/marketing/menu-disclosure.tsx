"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The phone and tablet menu: a native <details> disclosure, so it opens and closes without
 * JavaScript. Once hydrated it also closes on Escape (focus returns to the toggle), on a click or
 * tap outside the header, and when a link inside it is followed.
 */
export function MenuDisclosure({
  className = "",
  panelClassName = "",
  children,
}: {
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const summary = details.querySelector("summary");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      details.open = false;
      summary?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!details.open) return;
      const header = details.closest("header") ?? details;
      if (event.target instanceof Node && !header.contains(event.target)) details.open = false;
    };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a")) details.open = false;
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    details.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      details.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <details ref={ref} className={`group/menu ${className}`}>
      <summary
        aria-label="Menu"
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md text-on-ink hover:bg-ink-raised [&::-webkit-details-marker]:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-[22px] fill-none stroke-current stroke-[1.8] group-open/menu:hidden"
          strokeLinecap="round"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="hidden size-[22px] fill-none stroke-current stroke-[1.8] group-open/menu:block"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </summary>
      <div className={`hidden group-open/menu:block ${panelClassName}`}>{children}</div>
    </details>
  );
}
