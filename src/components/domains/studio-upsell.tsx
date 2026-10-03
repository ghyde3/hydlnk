import Link from "next/link";
import { SECONDARY } from "./ui";
import { studioUpsellText } from "./view-model";

/**
 * The dashed strip under a Pro account's Custom domain card (M4-10): "Running pages for clients?
 * Studio includes 15 custom domains." with a "Compare plans" link to /settings#plans (which scrolls
 * the plans section into view and focuses the Studio card heading). The count comes from the limits
 * table. The page renders it for Pro only. Nothing here names what v1 does not have.
 */
export function StudioUpsell() {
  return (
    <section
      data-studio-upsell
      className="flex flex-col gap-3 rounded-md border border-dashed border-line-3 p-4 hl:flex-row hl:items-center hl:justify-between hl:p-5"
    >
      <p className="text-sm text-text-2">{studioUpsellText()}</p>
      <Link href="/settings#plans" className={`${SECONDARY} w-full hl:w-auto`}>
        Compare plans
      </Link>
    </section>
  );
}
