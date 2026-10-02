"use client";

import { useEffect, useId, useRef, type Dispatch } from "react";
import { LIMITS, codePointLength, type ImageRef } from "@/lib/document";
import { profileInitials } from "@/lib/editor/initials";
import type { EditorAction, FocusRequest } from "@/lib/editor/state";
import { ImageUploadControl } from "./image-upload-control";

const INPUT = "min-h-11 w-full rounded-md border bg-surface px-3 text-base font-normal text-ink";

/**
 * The Profile card (M2-07, M2-09): the photo (upload, replace, remove), the display name and the
 * bio. The inputs keep exactly what is typed; the reducer clamps it to 60 and 160 code points on
 * one line, so a paste that is too long is cut, not refused.
 */
export function ProfileCard({
  name,
  bio,
  photo,
  nameError,
  focus,
  dispatch,
}: {
  name: string;
  bio: string;
  photo: ImageRef | null;
  /** The Publish gate's message for the display name, shown under the field. */
  nameError: string | null;
  focus: FocusRequest | null;
  dispatch: Dispatch<EditorAction>;
}) {
  const nameId = useId();
  const bioId = useId();
  const bioCountId = useId();
  const nameErrorId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const focusNonce = focus?.kind === "profile-name" ? focus.nonce : null;
  useEffect(() => {
    if (focusNonce === null) return;
    nameRef.current?.scrollIntoView({ block: "center" });
    nameRef.current?.focus({ preventScroll: true });
    dispatch({ type: "focus/handled", nonce: focusNonce });
  }, [focusNonce, dispatch]);

  return (
    <section
      aria-labelledby={`${nameId}-title`}
      className="flex flex-col gap-3.5 rounded-md border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={`${nameId}-title`} className="text-sm font-semibold">
          Profile
        </h2>
        <span className="text-xs text-text-2">Shown at the top of your page</span>
      </div>

      <ImageUploadControl
        kind="avatar"
        value={photo}
        initials={profileInitials(name)}
        onChange={(next) => dispatch({ type: "profile/photo", value: next })}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="text-[13px] font-semibold text-ink-2">
          Display name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          type="text"
          value={name}
          autoComplete="name"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? nameErrorId : undefined}
          onChange={(event) => dispatch({ type: "profile/name", value: event.target.value })}
          className={`${INPUT} ${nameError ? "border-bad" : "border-line-3"}`}
        />
        {nameError ? (
          <span id={nameErrorId} className="text-[13px] text-bad">
            {nameError}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={bioId} className="text-[13px] font-semibold text-ink-2">
          Bio
        </label>
        <textarea
          id={bioId}
          rows={2}
          value={bio}
          aria-describedby={bioCountId}
          onChange={(event) => dispatch({ type: "profile/bio", value: event.target.value })}
          className="min-h-16 w-full resize-y rounded-md border border-line-3 bg-surface px-3 py-2.5 text-base leading-[1.4] font-normal text-ink"
        />
        <span id={bioCountId} className="self-end font-mono text-[11px] text-text-2">
          {codePointLength(bio)} / {LIMITS.bio}
        </span>
      </div>
    </section>
  );
}
