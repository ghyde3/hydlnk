import { PageRenderer } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import { pageChrome } from "@/lib/publish/chrome";

/**
 * A published tenant page (M2-22): `PageRenderer` in live mode, drawn from the frozen published
 * document and nothing else. The footer's two links come from `pageChrome`, decided here from the
 * owner's plan (read server-side with the page) and the page id, never from the document.
 */
export function TenantPage({
  document,
  pageId,
  plan,
}: {
  document: PublishDoc;
  pageId: string;
  /** `accounts.plan` of the page's owner. */
  plan: string;
}) {
  return (
    <PageRenderer doc={document} pageId={pageId} mode="live" chrome={pageChrome(plan, pageId)} />
  );
}
