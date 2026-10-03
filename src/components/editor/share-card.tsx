"use client";

import { useEffect, useId, useRef, type Dispatch } from "react";
import { Field, controlClass } from "@/components/blocks/field";
import { FocusPicker } from "@/components/blocks/forms/focus-picker";
import {
  LIMITS,
  codePointLength,
  type ImageRef,
  type PublishError,
  type Share,
} from "@/lib/document";
import type { EditorAction, FocusRequest } from "@/lib/editor/state";
import { ImageUploadControl } from "./image-upload-control";
import { SharePreviewCard } from "./share-card-preview";

export const SHARE_CARD_HINT = "How your page looks when you send its link";
export const SHARE_IMAGE_HELP =
  "Wide images work best, at least 1200 pixels across. Leave it empty and we make one from your name and colors.";

const messageOf = (errors: readonly PublishError[], match: (field: string) => boolean) =>
  errors.find((error) => error.blockId === null && match(error.field))?.message ?? null;

/**
 * The Share card (M6-33), directly below the Profile card: the title, description and image of the
 * page's link preview, with a live preview card. Everything is on every plan. It writes only the
 * three fields and the image's focus (`share/title`, `share/description`, `share/image`,
 * `share/focus`), each one an undo step like any other edit, and calls no endpoint but the draft
 * save and the shared upload route (`kind=content`). Empty fields fall back to the display name and
 * the bio when the page is published, which the placeholders and the preview show.
 *
 * The Publish gate's messages (M6-32) show under the field they belong to; the card is always open,
 * so the invalid control is in view, and a failed Publish moves focus to it.
 */
export function ShareCard({
  share,
  name,
  bio,
  host,
  liveOgUrl,
  errors,
  focus,
  dispatch,
}: {
  share: Share | undefined;
  name: string;
  bio: string;
  /** The address the preview shows: `mara.hydlnk.com`, or the primary custom domain. */
  host: string;
  /** `{liveUrl}/og?v={publishedAt}` once the page is published, else null. */
  liveOgUrl: string | null;
  errors: readonly PublishError[];
  focus: FocusRequest | null;
  dispatch: Dispatch<EditorAction>;
}) {
  const headingId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const title = share?.title ?? "";
  const description = share?.description ?? "";
  const image: ImageRef | null = share?.image ?? null;

  const titleError = messageOf(errors, (field) => field === "share.title");
  const descriptionError = messageOf(errors, (field) => field === "share.description");
  // A focus outside the picture (M6-23) belongs under the focus control; every other problem with
  // the image (not an upload of yours, gone, too narrow, not a reference) under the Image field.
  const focusError = messageOf(errors, (field) => field.startsWith("share.image.focus"));
  const imageError = messageOf(
    errors,
    (field) =>
      field === "share.image" ||
      (field.startsWith("share.image.") && !field.startsWith("share.image.focus")),
  );

  // A failed Publish names a field of this card: bring it into view and focus its control.
  const request = focus?.kind === "share-field" ? focus : null;
  const nonce = request?.nonce ?? null;
  const field = request?.field ?? null;
  useEffect(() => {
    if (nonce === null || field === null) return;
    const control =
      field === "title"
        ? titleRef.current
        : field === "description"
          ? descriptionRef.current
          : focusError !== null && imageError === null
            ? (sectionRef.current?.querySelector<HTMLElement>('[aria-label="Focus point"]') ?? null)
            : (imageRef.current?.querySelector<HTMLElement>("button:not([disabled])") ?? null);
    control?.scrollIntoView({ block: "center" });
    control?.focus({ preventScroll: true });
    dispatch({ type: "focus/handled", nonce });
  }, [nonce, field, focusError, imageError, dispatch]);

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      data-testid="share-card"
      className="flex flex-col gap-3.5 rounded-md border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={headingId} className="text-sm font-semibold">
          Share card
        </h2>
        <span className="text-xs text-text-2">{SHARE_CARD_HINT}</span>
      </div>

      <Field
        label="Title"
        hint="Leave empty to use your display name."
        error={titleError}
        suffix={
          <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
            {codePointLength(title)} / {LIMITS.shareTitle}
          </span>
        }
      >
        {(control) => (
          <input
            {...control}
            ref={titleRef}
            type="text"
            value={title}
            placeholder={name}
            data-field="share-title"
            autoComplete="off"
            onChange={(event) => dispatch({ type: "share/title", value: event.target.value })}
            className={controlClass(titleError !== null)}
          />
        )}
      </Field>

      <Field
        label="Description"
        hint="Leave empty to use your bio."
        error={descriptionError}
        suffix={
          <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
            {codePointLength(description)} / {LIMITS.shareDescription}
          </span>
        }
      >
        {(control) => (
          <textarea
            {...control}
            ref={descriptionRef}
            rows={3}
            value={description}
            placeholder={bio}
            data-field="share-description"
            onChange={(event) => dispatch({ type: "share/description", value: event.target.value })}
            className={`${controlClass(descriptionError !== null, "py-2.5 leading-normal")} resize-y`}
          />
        )}
      </Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">Image</span>
        <div ref={imageRef} data-field="share-image">
          <ImageUploadControl
            kind="content"
            label="image"
            help={SHARE_IMAGE_HELP}
            value={image}
            onChange={(next) => dispatch({ type: "share/image", value: next })}
          />
        </div>
        <div aria-live="polite" className="empty:hidden">
          {imageError ? (
            <p data-field="share-image-error" className="text-[13px] text-bad">
              {imageError}
            </p>
          ) : null}
        </div>
      </div>

      {image ? (
        <FocusPicker
          image={image}
          ratio={{ width: 191, height: 100 }}
          error={focusError}
          onChange={(next) => dispatch({ type: "share/focus", value: next ?? null })}
        />
      ) : null}

      <SharePreviewCard share={share} name={name} bio={bio} host={host} liveOgUrl={liveOgUrl} />
    </section>
  );
}
