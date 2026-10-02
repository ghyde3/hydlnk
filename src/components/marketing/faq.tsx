import type { FaqItem } from "./faq-data";

/**
 * Questions as native <details>, so click, Enter and Space all toggle them without JavaScript.
 * Each summary is at least 48px tall and keeps its "+" mark (rotated to "×" when open).
 */
export function FaqList({ items, openFirst = false }: { items: readonly FaqItem[]; openFirst?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-surface">
      {items.map((item, index) => (
        <details
          key={item.question}
          open={openFirst && index === 0}
          className="group border-t border-line px-[18px] pt-1.5 pb-1.5 first:border-t-0 open:pb-4"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
            {item.question}
            <span
              aria-hidden="true"
              className="text-xl font-normal text-text-3 transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-1 mb-1.5 max-w-[680px] text-[15px] leading-[1.65] text-text-2">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
