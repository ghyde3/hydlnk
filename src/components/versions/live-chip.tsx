/**
 * "Live now": the version that is the page's current published document (M6-50). The same green as
 * the editor's "Published" chip (text #2B7448 on #E7F3EC clears the 4.5:1 floor at 12px; the dot
 * keeps the brand green).
 */
export function LiveChip() {
  return (
    <span
      data-testid="live-chip"
      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-[3px] text-xs font-medium"
      style={{ background: "#E7F3EC", color: "#2B7448" }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full"
        style={{ background: "#2F7D4F" }}
      />
      Live now
    </span>
  );
}
