"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ERROR_MESSAGE, errorReference } from "@/lib/error-copy";

/*
 * HYDLNK UI look as literal inline values, for the same reason as unavailable-panel.tsx: the tenant
 * layout loads no HYDLNK CSS and defines no --hl-* variables. Charcoal page, light text, a brass
 * button. No --t-* token is used: this is HYDLNK speaking, not the tenant, and nothing of the tenant's
 * page (name, bio, links) is read or shown.
 */
const PAGE: CSSProperties = { background: "#1C1B1A", color: "#F4F3F0" };
const MUTED: CSSProperties = { color: "#A9A49B" };
const CTA: CSSProperties = {
  background: "#B8914F",
  color: "#1C1B1A",
  border: 0,
  cursor: "pointer",
};

/**
 * A tenant page that throws while it renders (M5-20): the same sentence, a Retry and the reference
 * id as every other error page, drawn with the tenant-safe look. Layout reuses `.tenant-unclaimed`.
 */
export function TenantErrorPanel({
  error,
  onRetry,
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
}) {
  const [reference] = useState(() => errorReference(error));
  useEffect(() => {
    console.error(`[error ${reference}]`, error);
  }, [error, reference]);
  return (
    <main className="tenant-unavailable tenant-unclaimed" style={PAGE}>
      <div className="tenant-unclaimed-column">
        <p className="tenant-unclaimed-eyebrow" style={{ ...MUTED, letterSpacing: "0.14em" }}>
          HYDLNK
        </p>
        <h1 role="alert" data-testid="error-message">
          {ERROR_MESSAGE}
        </h1>
        <button type="button" className="tenant-unclaimed-link" style={CTA} onClick={onRetry}>
          Retry
        </button>
        <p
          data-testid="error-reference"
          style={{ ...MUTED, fontFamily: "monospace", fontSize: 12 }}
        >
          Reference: {reference}
        </p>
      </div>
    </main>
  );
}
