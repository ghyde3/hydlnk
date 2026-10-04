"use client";

import { useEffect, useId, useRef, type Dispatch } from "react";
import { CountedField } from "@/components/blocks/forms/counted-field";
import { UrlField } from "@/components/blocks/url-field";
import { BLOCKED_FIELD_MESSAGE } from "@/lib/blocklist/messages";
import { LIMITS, type Banner, type DraftDoc, type PublishError } from "@/lib/document";
import { setBannerField, setBannerVisible, type BannerFieldName } from "@/lib/editor/page-extras";
import type { EditorAction, FocusRequest } from "@/lib/editor/state";

/**
 * The Banner card of the Edit tab (M9-23), under the Profile card: a switch "Show a message at the
 * top of your page", the "Message" (at most 100 characters, one line), the "Link label" (at most 30)
 * and the "Link address" (the shared URL field with its own message and the blocked-site error).
 * Available on every plan.
 *
 * The page's draft holds the banner; every edit here is `edit(update, group)` of the workspace, so it
 * is one undo step (typing in one field coalesces) and flips the chip to "Unpublished changes".
 * Turning the switch off keeps what was typed (the draft's banner stays, hidden) so turning it on
 * again brings it back; a banner with nothing in it is taken out of the draft.
 *
 * Publish errors show under the exact field (`banner.text`, `banner.label`, `banner.url`, and the
 * blocklist's block `banner`), and the first one takes focus (`banner-field` in the editor state).
 * The card is editor UI: HYDLNK tokens, 16px inputs, 44px controls.
 */
export function BannerCard({
  banner,
  errors,
  focus,
  edit,
  dispatch,
}: {
  banner: Banner | undefined;
  /** Every error of the page: the card picks the ones that name the banner. */
  errors: readonly PublishError[];
  focus: FocusRequest | null;
  edit: (update: (draft: DraftDoc) => DraftDoc, group?: string) => void;
  dispatch: Dispatch<EditorAction>;
}) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const shown = banner !== undefined && banner.visible !== false;
  const text = banner?.text ?? "";
  const label = banner?.label ?? "";
  const url = banner?.url ?? "";

  const errorOf = (field: BannerFieldName): string | null => {
    const hit = errors.find(
      (error) =>
        (error.blockId === null && error.field === `banner.${field}`) ||
        (field === "url" && error.blockId === "banner" && error.field === "url"),
    );
    if (!hit) return null;
    return hit.blockId === "banner" ? BLOCKED_FIELD_MESSAGE : hit.message;
  };

  // The first field a Publish error names takes focus (the card opens it: it is on show or, when it
  // is hidden, nothing here can fail).
  const focusNonce = focus?.kind === "banner-field" ? focus.nonce : null;
  const focusField = focus?.kind === "banner-field" ? focus.field : null;
  useEffect(() => {
    if (focusNonce === null || focusField === null) return;
    const input = cardRef.current?.querySelector<HTMLElement>(
      `[data-field="banner-${focusField}"]`,
    );
    input?.scrollIntoView({ block: "center" });
    input?.focus({ preventScroll: true });
    dispatch({ type: "focus/handled", nonce: focusNonce });
  }, [focusNonce, focusField, dispatch]);

  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      data-testid="banner-card"
      className="flex flex-col gap-3.5 rounded-md border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Banner
        </h2>
        <span className="text-xs text-text-2">A short message above your profile</span>
      </div>

      <button
        type="button"
        aria-pressed={shown}
        data-testid="banner-switch"
        onClick={() => edit((draft) => setBannerVisible(draft, !shown))}
        className="flex min-h-12 min-w-[52px] max-w-full cursor-pointer items-center justify-between gap-3 text-left text-[13px] font-normal text-ink-2"
      >
        <span className="min-w-0">Show a message at the top of your page</span>
        <span
          aria-hidden="true"
          className={`relative block h-[18px] w-8 shrink-0 rounded-full ${shown ? "bg-ink" : "bg-line-3"}`}
        >
          <span
            className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${shown ? "left-4" : "left-0.5"}`}
          />
        </span>
      </button>

      {shown ? (
        <div data-testid="banner-fields" className="flex flex-col gap-3.5">
          <CountedField
            label="Message"
            field="banner-text"
            max={LIMITS.bannerText}
            value={text}
            error={errorOf("text")}
            hint="Shown above your profile. Visitors can close it."
            onChange={(next) => edit((draft) => setBannerField(draft, "text", next), "banner:text")}
          />
          <CountedField
            label="Link label"
            field="banner-label"
            max={LIMITS.bannerLabel}
            value={label}
            error={errorOf("label")}
            onChange={(next) =>
              edit((draft) => setBannerField(draft, "label", next), "banner:label")
            }
          />
          <UrlField
            label="Link address"
            field="banner-url"
            optional
            value={url}
            error={errorOf("url")}
            onChange={(next) => edit((draft) => setBannerField(draft, "url", next), "banner:url")}
          />
        </div>
      ) : null}
    </section>
  );
}
