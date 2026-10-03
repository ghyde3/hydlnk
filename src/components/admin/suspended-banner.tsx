import { readSupportEmail } from "@/lib/admin/env";

/**
 * The persistent banner a suspended owner sees on every app screen (M5-09), in the DESIGN.md error
 * style (--hl-bad text, #E8C4BD border), at the top of the main column above the screen header. It
 * is in the flow, not fixed, so it never covers the phone top bar or the bottom tab bar. The mailto
 * link keeps a 44px hit area without growing the line: padding that the negative margin takes back.
 */
export function SuspendedBanner() {
  const email = readSupportEmail();
  return (
    <div
      role="status"
      data-suspended-banner
      className="border-b border-bad-line bg-surface px-4 py-3 text-sm leading-snug text-bad hl:px-8"
    >
      <span>
        Your account is suspended. Your pages are offline. Contact{" "}
        <a
          href={`mailto:${email}`}
          className="-my-3.5 inline-block py-3.5 font-semibold text-bad underline underline-offset-2"
        >
          {email}
        </a>{" "}
        to appeal.
      </span>
    </div>
  );
}
