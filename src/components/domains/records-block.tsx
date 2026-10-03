"use client";

import { useEffect, useRef, useState } from "react";
import type { DomainRecord } from "@/lib/domains/types";
import { RECORDS_UNAVAILABLE } from "./view-model";
import { SECONDARY } from "./ui";

/** How long a Copy button says "Copied" before it goes back to "Copy". */
export const COPIED_MS = 2000;

/**
 * Copy for one record row: writes only the Value to the clipboard and says "Copied" for two
 * seconds. The label changes, the accessible name stays "Copy record value".
 */
function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }
  return { copied, copy };
}

function CopyButton({ value, phone }: { value: string; phone?: boolean }) {
  const { copied, copy } = useCopy(value);
  return (
    <button
      type="button"
      aria-label="Copy record value"
      onClick={copy}
      className={`cursor-pointer rounded-sm border border-line-3 bg-surface font-sans font-semibold text-ink ${
        phone ? "min-h-11 shrink-0 px-3.5 text-[13px]" : "min-h-[34px] w-full text-xs"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const GRID = "grid grid-cols-[80px_80px_minmax(0,1fr)_72px] items-center gap-3 px-3.5";

/** >= 760px: the records as a table (Type, Name, Value, Copy), mono 13px, header 11px uppercase on --hl-page. */
function RecordsTable({ records }: { records: DomainRecord[] }) {
  return (
    <div
      role="table"
      aria-label="DNS records to add"
      className="hidden overflow-hidden rounded-md border border-line-2 font-mono text-[13px] hl:block"
    >
      <div
        role="row"
        className={`${GRID} bg-page py-2 text-[11px] tracking-[0.06em] text-text-2 uppercase`}
      >
        <span role="columnheader">Type</span>
        <span role="columnheader">Name</span>
        <span role="columnheader">Value</span>
        <span role="columnheader">
          <span className="sr-only">Copy</span>
        </span>
      </div>
      {records.map((record, index) => (
        <div
          key={`${record.type}:${record.name}:${index}`}
          role="row"
          data-dns-record={record.type}
          className={`${GRID} border-t border-line py-1.5`}
        >
          <span role="cell">{record.type}</span>
          <span role="cell" className="[overflow-wrap:anywhere]">
            {record.name}
          </span>
          <span role="cell" className="[overflow-wrap:anywhere]">
            {record.value}
          </span>
          <span role="cell">
            <CopyButton value={record.value} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** < 760px: each record as a stacked definition list (Type, Name, Value with its own Copy button). */
function RecordsList({ records }: { records: DomainRecord[] }) {
  return (
    <div className="flex flex-col gap-2 hl:hidden">
      {records.map((record, index) => (
        <dl
          key={`${record.type}:${record.name}:${index}`}
          data-dns-record={record.type}
          className="m-0 flex flex-col overflow-hidden rounded-md border border-line-2 text-[13px]"
        >
          <div className="flex justify-between gap-3 px-3 py-2.5">
            <dt className="text-text-2">Type</dt>
            <dd className="m-0 font-mono">{record.type}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-line px-3 py-2.5">
            <dt className="text-text-2">Name</dt>
            <dd className="m-0 font-mono [overflow-wrap:anywhere]">{record.name}</dd>
          </div>
          <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
            <dt className="text-text-2">Value</dt>
            <dd className="m-0 flex items-center justify-between gap-2.5">
              <span className="min-w-0 font-mono [overflow-wrap:anywhere]">{record.value}</span>
              <CopyButton value={record.value} phone />
            </dd>
          </div>
        </dl>
      ))}
    </div>
  );
}

/** The mono fragments inside the apex note ("A", "@", the address). */
function Mono({ children }: { children: string }) {
  return <span className="font-mono text-ink">{children}</span>;
}

/**
 * The DNS records of a pending domain, exactly as the server read them from Vercel (never typed
 * here), a table on a desktop and a definition list on a phone, then the apex note for a subdomain.
 * When the records could not be read the block says so and offers "Try again": no fallback values.
 */
export function RecordsBlock({
  records,
  unavailable,
  apex,
  retrying,
  onRetry,
}: {
  records: DomainRecord[];
  unavailable: boolean;
  apex: { name: string; ipv4: string } | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (unavailable || records.length === 0) {
    return (
      <div
        role="status"
        data-dns-unavailable
        className="flex flex-col gap-2.5 rounded-md border border-line-2 p-3 hl:flex-row hl:items-center hl:justify-between"
      >
        <p className="text-[13px] text-text-2">{RECORDS_UNAVAILABLE}</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying || undefined}
          className={`${SECONDARY} w-full hl:w-auto`}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <>
      <RecordsTable records={records} />
      <RecordsList records={records} />
      {apex ? (
        <p data-apex-note className="text-[13px] leading-[1.55] text-text-2">
          Using a root domain like {apex.name} instead? Add an <Mono>A</Mono> record for{" "}
          <Mono>@</Mono> pointing to <Mono>{apex.ipv4}</Mono>.
        </p>
      ) : null}
    </>
  );
}
