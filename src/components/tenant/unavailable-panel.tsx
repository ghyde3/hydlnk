import type { CSSProperties } from "react";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

/*
 * HYDLNK UI look as literal inline values, for the same reason as unclaimed-panel.tsx: the tenant
 * layout loads no HYDLNK CSS and defines no --hl-* variables, and no HYDLNK color belongs in the
 * shared tenant stylesheet. Charcoal page, light text, a brass call to action (Main.dc.html: the
 * primary CTA on charcoal is brass with charcoal text). Layout reuses the .tenant-unclaimed classes.
 * No --t-* token is used anywhere here: this is HYDLNK speaking, not the tenant.
 */
const PAGE: CSSProperties = { background: "#1C1B1A", color: "#F4F3F0" };
const MUTED: CSSProperties = { color: "#A9A49B" };
const CTA: CSSProperties = { background: "#B8914F", color: "#1C1B1A" };

/**
 * The 404 for a page whose owner is suspended (M5-08): "This page isn’t available." and a way to
 * the HYDLNK site. It is drawn from the handle alone, so nothing the tenant wrote (name, bio, link
 * titles or URLs, avatar) is read for it or can appear in it, and the handle is not offered as
 * claimable: it is held.
 */
export function UnavailablePanel() {
  return (
    <main className="tenant-unavailable tenant-unclaimed" style={PAGE}>
      <div className="tenant-unclaimed-column">
        <p className="tenant-unclaimed-eyebrow" style={{ ...MUTED, letterSpacing: "0.14em" }}>
          HYDLNK
        </p>
        <h1>This page isn’t available.</h1>
        <p className="tenant-unclaimed-copy" style={MUTED}>
          It has been taken offline.
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
