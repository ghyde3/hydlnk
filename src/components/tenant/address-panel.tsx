import type { CSSProperties } from "react";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";
import { ADDRESS_INVALID_MESSAGE, ADDRESS_RESERVED_MESSAGE } from "@/lib/error-copy";

/*
 * HYDLNK UI look as literal inline values, for the same reason as unclaimed-panel.tsx and
 * unavailable-panel.tsx: the tenant layout loads no HYDLNK CSS. Charcoal page, light text, a brass
 * link. No --t-* token is used and no claim button is offered: these two addresses can never be
 * claimed, so nothing here points at /signup.
 */
const PAGE: CSSProperties = { background: "#1C1B1A", color: "#F4F3F0" };
const MUTED: CSSProperties = { color: "#A9A49B" };
const CTA: CSSProperties = { background: "#B8914F", color: "#1C1B1A" };

/**
 * The 404 for an address that is not a handle anyone can claim (M5-20): "That address is reserved."
 * (admin, www, api and the other names HYDLNK keeps) or "That address isn’t valid." (too short,
 * too long, or not made of the characters a handle may use). The status is 404, as for any
 * unclaimed address, and the only way out is the HYDLNK site. The address itself is not echoed.
 */
export function AddressPanel({ kind }: { kind: "reserved" | "invalid" }) {
  return (
    <main className="tenant-unavailable tenant-unclaimed" style={PAGE} data-address-panel={kind}>
      <div className="tenant-unclaimed-column">
        <p className="tenant-unclaimed-eyebrow" style={{ ...MUTED, letterSpacing: "0.14em" }}>
          HYDLNK
        </p>
        <h1>{kind === "reserved" ? ADDRESS_RESERVED_MESSAGE : ADDRESS_INVALID_MESSAGE}</h1>
        <p className="tenant-unclaimed-copy" style={MUTED}>
          {kind === "reserved"
            ? "HYDLNK keeps this name for itself."
            : "Addresses use 3 to 30 letters, numbers and dashes."}
        </p>
        <a
          className="tenant-unclaimed-link"
          style={CTA}
          href={`${rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/`}
        >
          Go to hydlnk.com
        </a>
      </div>
    </main>
  );
}
