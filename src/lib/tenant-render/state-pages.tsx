import "server-only";
import type { ReactNode } from "react";
import { AddressPanel } from "@/components/tenant/address-panel";
import { TenantErrorPanel } from "@/components/tenant/error-panel";
import { PlainNotFound } from "@/components/tenant/plain-not-found";
import { UnavailablePanel } from "@/components/tenant/unavailable-panel";
import { UnclaimedPanel } from "@/components/tenant/unclaimed-panel";
import { UnpublishedPlaceholder } from "@/components/tenant/unpublished-placeholder";
import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";
import type { HandleStatus } from "@/lib/handles/status";
import { renderDocument, renderHead } from "./head";
import { renderStatic } from "./static-markup";
import { stateCssFor } from "./state-css";

/**
 * Every tenant-host document that is not a published page (M8-03), built the way the page is: the
 * existing panel component rendered to a string, one `<style>` with the rules that markup uses, a
 * head with `noindex`, and no script. The panels themselves (`UnclaimedPanel`, `AddressPanel`,
 * `PlainNotFound`, `UnavailablePanel`, `TenantErrorPanel`, `UnpublishedPlaceholder`) stay the one
 * source of the copy, colors and links; nothing here repeats them. None of these documents loads
 * a thing besides the document itself and the favicon.
 */

function stateDocument(title: string, node: ReactNode): string {
  const body = renderStatic(node);
  return renderDocument(
    renderHead({
      metadata: { title, robots: { index: false } },
      css: stateCssFor(body),
    }),
    body,
  );
}

/** A claimed handle with nothing published (M1-15): 200, the system theme, "Nothing published here yet." */
export function placeholderDocument(handle: string): string {
  return stateDocument(`${handle}.${HANDLE_DISPLAY_DOMAIN}`, <UnpublishedPlaceholder handle={handle} />);
}

/** The panel for an address with no page: claimable, reserved, invalid, or none of those (the plain 404). */
export function missingDocument(handle: string, status: HandleStatus | null): string {
  const panel =
    status === "available" ? (
      <UnclaimedPanel handle={handle} />
    ) : status === "reserved" ? (
      <AddressPanel kind="reserved" />
    ) : status === "short" || status === "too_long" || status === "invalid" ? (
      <AddressPanel kind="invalid" />
    ) : (
      <PlainNotFound />
    );
  return stateDocument("Page not found", panel);
}

/** `/anything` on a tenant host and every address that is not a page: the plain 404. */
export function plainNotFoundDocument(): string {
  return stateDocument("Page not found", <PlainNotFound />);
}

/** A suspended owner (M5-08): nothing of the page, and the handle stays held. */
export function unavailableDocument(): string {
  return stateDocument("Page not available", <UnavailablePanel />);
}

/** The 500 panel (M5-20, M8-03): the sentence, a Retry link and the reference of the server log line. */
export function errorDocument(reference: string): string {
  return stateDocument("Something went wrong", <TenantErrorPanel reference={reference} />);
}
