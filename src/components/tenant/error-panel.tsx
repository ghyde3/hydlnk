import type { CSSProperties } from "react";
import { ERROR_MESSAGE } from "@/lib/error-copy";

/*
 * HYDLNK UI look as literal inline values, for the same reason as unavailable-panel.tsx: the tenant
 * document loads no HYDLNK CSS and defines no --hl-* variables. Charcoal page, light text, a brass
 * button. No --t-* token is used: this is HYDLNK speaking, not the tenant, and nothing of the tenant's
 * page (name, bio, links) is read or shown.
 */
const PAGE: CSSProperties = { background: "#1C1B1A", color: "#F4F3F0" };
const MUTED: CSSProperties = { color: "#A9A49B" };
const CTA: CSSProperties = { background: "#B8914F", color: "#1C1B1A" };

/**
 * The 500 of a tenant address (M5-20, M8-03): the same sentence, a Retry and the reference id as
 * every other error page, drawn with the tenant-safe look. It is plain markup like every other state
 * of the live path: there is no script on it, so Retry is an ordinary link to the page's own URL (an
 * empty `href` is the current address), and it works with scripts blocked. The reference is the one
 * the server wrote to its log as `[error {reference}]`. Layout reuses `.tenant-unclaimed`.
 */
export function TenantErrorPanel({ reference }: { reference: string }) {
  return (
    <main className="tenant-unavailable tenant-unclaimed" style={PAGE}>
      <div className="tenant-unclaimed-column">
        <p className="tenant-unclaimed-eyebrow" style={{ ...MUTED, letterSpacing: "0.14em" }}>
          HYDLNK
        </p>
        <h1 role="alert" data-testid="error-message">
          {ERROR_MESSAGE}
        </h1>
        <a className="tenant-unclaimed-link" style={CTA} href="">
          Retry
        </a>
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
