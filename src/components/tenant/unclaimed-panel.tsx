import type { CSSProperties } from "react";
import { clientEnv } from "@/lib/env/client";
import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import { appOrigin, rootOrigin } from "@/lib/routing/urls";

/*
 * HYDLNK UI look (page #F4F3F0, ink #1C1B1A, 6px corners) as literal inline values on purpose: the
 * tenant layout loads no HYDLNK CSS and defines no --hl-* variables, and keeping the colors out of
 * the shared tenant stylesheet means tenant pages never carry them. Layout lives in tenant.css.
 */
const PAGE: CSSProperties = { background: "#F4F3F0", color: "#1C1B1A" };
const MUTED: CSSProperties = { color: "#5E5A54" };
const PRIMARY: CSSProperties = { background: "#1C1B1A", color: "#FFFFFF" };
const SECONDARY: CSSProperties = {
  background: "#FFFFFF",
  color: "#1C1B1A",
  border: "1px solid #C9C5BE",
};

/**
 * The 404 for a handle nobody has claimed (M1-15). Offers the visitor the way in: claim it on the
 * app host, or go to the root host.
 */
export function UnclaimedPanel({ handle }: { handle: string }) {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  return (
    <main className="tenant-unclaimed" style={PAGE}>
      <div className="tenant-unclaimed-column">
        <p
          className="tenant-unclaimed-eyebrow"
          style={MUTED}
        >{`${handle}.${HANDLE_DISPLAY_DOMAIN}`}</p>
        <h1>This address isn’t claimed.</h1>
        <p className="tenant-unclaimed-copy" style={MUTED}>
          Nobody has a page here yet. Claim it and make it yours.
        </p>
        <a
          className="tenant-unclaimed-link"
          style={PRIMARY}
          href={`${appOrigin(rootDomain)}/signup?handle=${encodeURIComponent(handle)}`}
        >
          {`Claim ${handle}`}
        </a>
        <a className="tenant-unclaimed-link" style={SECONDARY} href={`${rootOrigin(rootDomain)}/`}>
          Go to hydlnk.com
        </a>
      </div>
    </main>
  );
}
