import type { ReactNode } from "react";
import { BODY, H2, Section } from "../primitives";
import { CHECKED_LABEL, SOURCES, type Claim, type SourceId } from "./data";

/** Sources of the given claims, each once, in the order first used. */
export function sourceIdsOf(claims: readonly Claim[]): SourceId[] {
  const seen = new Set<SourceId>();
  for (const item of claims) for (const id of item.sources) seen.add(id);
  return [...seen];
}

/**
 * The foot of every comparison and search page: the sources behind each claim (competitor links
 * are nofollow), the day they were read and whose trademarks the names are.
 */
export function SourcesSection({
  claims,
  trademarks,
}: {
  claims: readonly Claim[];
  trademarks: string;
}) {
  return (
    <Section id="sources" tone="page" labelledBy="sources-title">
      <div className="max-w-[760px]">
        <h2 id="sources-title" className={H2}>
          Sources
        </h2>
        <p className={`mt-4 ${BODY}`}>
          Prices and plan terms are as they were at the time of writing and can change, so check
          the source before you decide.
        </p>
        <ul className="mt-4 grid gap-1">
          {sourceIdsOf(claims).map((id) => (
            <li key={id}>
              <a
                href={SOURCES[id].url}
                rel="nofollow noopener"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text underline decoration-line-3 underline-offset-4 [overflow-wrap:anywhere] hover:decoration-accent-text"
              >
                {SOURCES[id].label}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 font-mono text-xs tracking-[0.08em] text-text-2 uppercase">
          {CHECKED_LABEL}
        </p>
        <p className={`mt-2 ${BODY}`}>{trademarks}</p>
      </div>
    </Section>
  );
}

const CARD = "rounded-md border border-line bg-surface p-[22px]";

/** A titled card with a paragraph or a list inside. */
export function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={CARD}>
      <h3 className="text-base font-semibold">{title}</h3>
      <div className={`mt-2 ${BODY}`}>{children}</div>
    </div>
  );
}

export interface TableRow {
  label: string;
  cells: readonly ReactNode[];
}

/**
 * A comparison table that stacks on a phone. It is a grid with table roles: from 760px the column
 * headings sit on top; below that each cell carries its own column name, so nothing scrolls
 * sideways.
 */
export function StackedTable({
  columns,
  rows,
  caption,
}: {
  columns: readonly string[];
  rows: readonly TableRow[];
  caption: string;
}) {
  const grid = {
    gridTemplateColumns: `minmax(0,1.1fr) ${columns.map(() => "minmax(0,2fr)").join(" ")}`,
  };
  return (
    <div role="table" aria-label={caption} className="mt-10 overflow-hidden rounded-md border border-line bg-surface">
      <div role="rowgroup" className="hidden bg-page min-[760px]:block">
        <div role="row" style={grid} className="grid gap-4 border-b border-line px-5 py-3">
          <span role="columnheader" className="font-mono text-xs tracking-[0.08em] text-text-2 uppercase">
            &nbsp;
          </span>
          {columns.map((column) => (
            <span
              key={column}
              role="columnheader"
              className="font-mono text-xs tracking-[0.08em] text-text-2 uppercase"
            >
              {column}
            </span>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row) => (
          <div
            key={row.label}
            role="row"
            style={grid}
            className="grid gap-x-4 gap-y-3 border-b border-line px-5 py-4 last:border-b-0 max-[759px]:!grid-cols-1"
          >
            <h3 role="rowheader" className="text-[15px] font-semibold">
              {row.label}
            </h3>
            {row.cells.map((cell, index) => (
              <div key={columns[index]} role="cell" className={`min-w-0 ${BODY}`}>
                <span className="mb-0.5 block font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase min-[760px]:hidden">
                  {columns[index]}
                </span>
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
