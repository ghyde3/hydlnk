import Link from "next/link";
import type { ReactNode } from "react";

/** One of the provider's own help articles a registrar guide is based on. */
export interface Source {
  href: string;
  title: string;
}

/** The sections every registrar guide shares, as [id, title]. */
export const REGISTRAR_TOC = [
  ["check", "Check that your DNS is managed here"],
  ["subdomain", "Subdomain: add the CNAME"],
  ["root", "Root domain: add the A record"],
  ["problems", "Common problems"],
  ["time", "How long it takes, then check in HYDLNK"],
] as const;

/** Where to read the record to add: the same sentence in every guide. */
export function ValueNote() {
  return (
    <p>
      The value is the one HYDLNK shows on the Domains screen of the editor. Copy it from there;
      never type it from memory or from another guide.
    </p>
  );
}

/** The rules that hold at every provider, as list items for the "Common problems" section. */
export function SharedProblems({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <li>
        <strong>An AAAA record on the same name.</strong> Remove it. If a name has an AAAA record,
        some visitors are sent there instead of to your page.
      </li>
      <li>
        <strong>A CNAME that shares its name with another record.</strong> A CNAME can’t sit next to
        any other record on the same name. Delete the others first, or use a different subdomain.
      </li>
      <li>
        <strong>A CAA record that doesn’t allow us.</strong> If your domain has a CAA record, it
        must allow <code>letsencrypt.org</code>, or https won’t start. If you have no CAA records,
        you don’t need to add one.
      </li>
    </>
  );
}

/** The last section's closing: checking the domain in HYDLNK. */
export function CheckInHydlnk() {
  return (
    <>
      <p>
        Then open Domains in the HYDLNK editor. The screen looks again on its own, and Check DNS now
        looks straight away. When it says Verified, https starts on its own, usually within a few
        minutes, and your page loads at your domain. There is nothing else to turn on.
      </p>
      <p>
        If it still says Waiting for DNS after the time above, read{" "}
        <Link href="/learn/connecting-a-domain#trouble">If it doesn’t verify</Link> in the main
        guide.
      </p>
    </>
  );
}

/** "Checked October 2026" and the provider's own articles the guide is based on. */
export function Sources({ items }: { items: readonly Source[] }) {
  return (
    <>
      <p>
        <strong>Checked October 2026.</strong> Dashboards change; if a menu is named differently
        when you look, the field names above still apply.
      </p>
      <h3>Based on</h3>
      <ul className="link-list">
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} rel="nofollow noopener">
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
