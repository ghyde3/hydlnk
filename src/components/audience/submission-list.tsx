import { AUDIENCE_TEST_IDS, FORM_KIND_LABELS, type SubmissionRow } from "@/lib/forms/contract";
import { DeleteButton } from "./delete-controls";

const WHEN = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** "Nov 26, 2026, 4:05 PM UTC". */
export function submittedAt(iso: string): string {
  return `${WHEN.format(new Date(iso))} UTC`;
}

const HEAD = ["Date", "Form", "Name", "Email", "Message", ""];

/**
 * The submissions, newest first (M17-08). One table: from 760px a table with the columns above; on
 * a phone each row is a stacked card with a small label over each value. Every value is React text.
 */
export function SubmissionList({
  rows,
}: {
  rows: readonly (SubmissionRow & { formLabel: string })[];
}) {
  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface">
      <table
        data-testid={AUDIENCE_TEST_IDS.list}
        className="block w-full border-collapse text-[14px] hl:table"
      >
        <thead className="hidden hl:table-header-group">
          <tr className="border-b border-line text-left text-xs font-semibold text-text-2">
            {HEAD.map((cell, index) => (
              <th key={index} scope="col" className="px-4 py-2.5 font-semibold">
                {cell === "" ? <span className="sr-only">Actions</span> : cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block hl:table-row-group">
          {rows.map((row) => (
            <tr
              key={row.id}
              data-testid={AUDIENCE_TEST_IDS.row}
              data-kind={row.kind}
              className="block border-b border-line px-4 py-3 last:border-b-0 hl:table-row hl:px-0 hl:py-0"
            >
              <Cell label="Date" mono>
                {submittedAt(row.created_at)}
              </Cell>
              <Cell label="Form">{row.formLabel}</Cell>
              <Cell label="Name">{row.name === "" ? "—" : row.name}</Cell>
              <Cell label="Email">{row.email}</Cell>
              <Cell label="Message" wide>
                {row.message === "" ? FORM_KIND_LABELS[row.kind] : row.message}
              </Cell>
              <td className="block pt-2 hl:table-cell hl:px-4 hl:py-2.5 hl:text-right">
                <DeleteButton id={row.id} label={`the submission from ${row.email}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Cell({
  label,
  children,
  mono,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <td
      className={`block py-0.5 align-top hl:table-cell hl:px-4 hl:py-2.5 ${wide ? "hl:min-w-[240px]" : ""}`}
    >
      <span className="block text-xs font-semibold text-text-2 hl:hidden">{label}</span>
      <span
        className={`block min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere] ${mono ? "font-mono text-[13px]" : ""}`}
      >
        {children}
      </span>
    </td>
  );
}
