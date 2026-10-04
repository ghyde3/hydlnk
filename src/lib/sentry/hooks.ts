import { isAppEvent } from "./filter";
import { scrubEvent, scrubJson, stripQuery, type ScrubOptions } from "./scrub";

/**
 * The three hooks both starters hand to `Sentry.init` (M9-10): `beforeSend` for errors,
 * `beforeSendTransaction` for traces and `beforeBreadcrumb`. Pure and generic over the event type,
 * so no Sentry type is imported and a test can call them with plain objects.
 *
 * Order matters: an event is FILTERED first, on its raw request address (an event about a tenant
 * page is dropped whole), and only then scrubbed (the address loses its query string, and everything
 * personal is replaced). Scrubbing first would erase what the filter reads.
 */

export interface HookOptions extends ScrubOptions {
  rootDomain: string | undefined;
}

type WithRequest = { request?: { url?: unknown } | undefined };

/** For errors and messages: null drops the event. */
export function createBeforeSend(options: HookOptions) {
  return function beforeSend<E extends WithRequest & object>(event: E): E | null {
    if (!isAppEvent(event, options.rootDomain)) return null;
    return scrubEvent(event, options);
  };
}

/** For transactions (traces): the same rule, the same scrubbing, every span included. */
export function createBeforeSendTransaction(options: HookOptions) {
  return function beforeSendTransaction<E extends WithRequest & object>(event: E): E | null {
    if (!isAppEvent(event, options.rootDomain)) return null;
    return scrubEvent(event, options);
  };
}

interface BreadcrumbLike {
  category?: string | undefined;
  type?: string | undefined;
  message?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

/** A click, an input or any other user interface breadcrumb: `ui.click`, `ui.input`, `ui.lifecycle`. */
function isUiCategory(category: string | undefined): boolean {
  return category === "ui" || (category?.startsWith("ui.") ?? false);
}

/**
 * Console output is dropped (it holds whatever the app printed), and so is every `ui.*` breadcrumb:
 * the SDK describes a clicked or typed-in element with its `aria-label`, `title`, `alt` and `name`,
 * and the editor's preview writes the owner's draft text into those (a book's title, a place's name,
 * an image's alt text), which the brief says must never leave the browser. A request or a navigation
 * keeps its address without the query string; everything is scrubbed like an event.
 */
export function createBeforeBreadcrumb(options: ScrubOptions) {
  return function beforeBreadcrumb<B extends BreadcrumbLike>(breadcrumb: B): B | null {
    if (breadcrumb.category === "console" || isUiCategory(breadcrumb.category)) return null;
    const copy = scrubJson(breadcrumb, options);
    const data = copy.data;
    if (data) {
      for (const key of ["url", "from", "to"]) {
        const value = data[key];
        if (typeof value === "string") data[key] = stripQuery(value);
      }
    }
    return copy;
  };
}
