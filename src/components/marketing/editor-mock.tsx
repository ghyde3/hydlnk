import { BLOCK_CATALOG } from "./block-catalog";

const ROWS = [
  { type: "link", title: "Shop the spring kiln opening", on: true },
  { type: "card", title: "Spring kiln", on: true },
  { type: "link", title: "Book a wheel class", on: true },
  { type: "grid", title: "Classes · Commissions", on: true },
  { type: "link", title: "Winter sale (ended)", on: false },
] as const;

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-block h-[22px] w-[38px] shrink-0 rounded-[999px] ${on ? "bg-ink" : "bg-line-3"}`}
    >
      <span
        className={`absolute top-[3px] size-4 rounded-[50%] bg-surface ${on ? "left-[19px]" : "left-[3px]"}`}
      />
    </span>
  );
}

/**
 * A still of the editor's block list, drawn in the HYDLNK UI: drag handles, block types, the
 * visibility switch (the last block is hidden, not deleted), the add-a-block chips and the
 * publish state. Decorative; the surrounding section explains it in text.
 */
export function EditorMock() {
  const icon = (type: string) => BLOCK_CATALOG.find((block) => block.id === type)?.icon;
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-md border border-line-2 bg-surface text-sm">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-page px-4 py-3">
        <span className="font-semibold">Blocks</span>
        <span className="rounded-sm bg-brass-soft px-2 py-[3px] font-mono text-[11px] tracking-[0.06em] text-brass-soft-text uppercase">
          Unpublished changes
        </span>
      </div>
      <ul>
        {ROWS.map((row) => (
          <li
            key={row.title}
            className={`flex items-center gap-3 border-b border-line px-4 py-3 ${row.on ? "" : "bg-page text-text-2"}`}
          >
            <span className="grid grid-cols-2 gap-[3px] text-text-3">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="block size-[3px] rounded-[50%] bg-current" />
              ))}
            </span>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-line text-brass-text">
              {icon(row.type)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase">
                {row.type}
              </span>
              <span className="block truncate">{row.title}</span>
            </span>
            <Toggle on={row.on} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
        {["Link", "Card", "Header", "Text", "Image", "Social", "Embed", "Grid", "Divider"].map((label) => (
          <span
            key={label}
            className="rounded-sm border border-line-3 px-2 py-1 font-mono text-[11px] text-ink"
          >
            + {label}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="font-mono text-xs text-text-2">Draft saved</span>
        <span className="rounded-md bg-ink px-4 py-2 text-[13px] font-semibold text-surface">Publish</span>
      </div>
    </div>
  );
}
