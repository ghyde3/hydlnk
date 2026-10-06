import type { PageFilter, PageOption } from "@/lib/analytics/dashboard/page-filter";

/**
 * The page filter (M11-09): All pages, Home, each page of the site by its title and "Deleted page"
 * for history of a page that no longer exists. A native select: the platform's own picker on a
 * phone, 44px tall there and 36px from the desktop width up, full width on a phone so nothing
 * overflows. The label is visible to assistive tech and to the eye only as the select's own text.
 */
export function PageSelect({
  options,
  value,
  onSelect,
}: {
  options: readonly PageOption[];
  value: PageFilter;
  onSelect: (value: PageFilter) => void;
}) {
  return (
    <label className="flex w-full min-w-0 flex-col hl:w-auto">
      <span className="sr-only">Page</span>
      <select
        data-testid="page-filter"
        value={value}
        onChange={(event) => onSelect(event.target.value)}
        className="min-h-11 w-full min-w-0 cursor-pointer truncate rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-ink hl:min-h-9 hl:w-56"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
