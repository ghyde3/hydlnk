"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
} from "react";
import { ChevronDownIcon } from "@/components/app/icons";
import {
  LIMITS,
  PHOTO_BORDERS,
  PHOTO_SHAPES,
  PHOTO_SIZES,
  PROFILE_OPTION_DEFAULTS,
  codePointLength,
  resolveProfileOptions,
  type ImageRef,
  type ProfileOptionKey,
  type ProfileOptions,
} from "@/lib/document";
import { profileInitials } from "@/lib/editor/initials";
import type { EditorAction, FocusRequest } from "@/lib/editor/state";
import { ImageUploadControl } from "./image-upload-control";
import { hiddenParts } from "./profile-hidden";

const INPUT = "min-h-11 w-full rounded-md border bg-surface px-3 text-base font-normal text-ink";

const PHOTO_SHAPE_LABELS: Record<ProfileOptions["photoShape"], string> = {
  circle: "Circle",
  rounded: "Rounded",
  square: "Square",
};
const PHOTO_SIZE_LABELS: Record<ProfileOptions["photoSize"], string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};
const PHOTO_BORDER_LABELS: Record<ProfileOptions["photoBorder"], string> = {
  page: "Page default",
  none: "None",
  thin: "Thin",
  thick: "Thick",
};

/** The card's own 72px avatar follows the shape (and only the shape) of the page's photo. */
const AVATAR_RADIUS: Record<ProfileOptions["photoShape"], string> = {
  circle: "50%",
  rounded: "24%",
  square: "0px",
};

/** What a switch that is off says (M6-16, M6-18): plain words, and where the text still shows up. */
export const PHOTO_HIDDEN_HINT =
  "Your photo is hidden on the page. It stays here in case you want it back.";
export const NAME_HIDDEN_HINT =
  "Hidden on the page. It still sets your page title and is read by screen readers.";
export const BIO_HIDDEN_HINT =
  "Hidden on the page. It can still show in search results and link previews.";

/**
 * The Profile card (M2-07, M2-09, M6-16, M6-18, M7-03): the photo (upload, replace, remove), the
 * display name and the bio stay in view; the photo's shape, size and border and the three "show on
 * page" switches live under one collapsed disclosure, "Photo and header options", so the card is
 * short. The inputs keep exactly what is typed; the reducer clamps it to 60 and 160 code points on
 * one line, so a paste that is too long is cut, not refused. Every option is one `profile/option`
 * action, so each is its own undo step. The name and bio inputs stay editable while their switch is
 * off: they still set the page title and the description.
 *
 * The section is collapsed on every load; open or closed is view state only (not remembered, not
 * part of the draft, no request, no undo step). Nothing is hidden without saying so: while it is
 * collapsed and a switch is off, the button carries a second line, "Hidden on your page: photo,
 * name", which is part of its accessible name.
 */
export function ProfileCard({
  name,
  bio,
  photo,
  options,
  nameError,
  focus,
  dispatch,
}: {
  name: string;
  bio: string;
  photo: ImageRef | null;
  /** The profile's display options; any that is missing reads as its default. */
  options?: Partial<ProfileOptions>;
  /** The Publish gate's message for the display name, shown under the field. */
  nameError: string | null;
  focus: FocusRequest | null;
  dispatch: Dispatch<EditorAction>;
}) {
  const nameId = useId();
  const bioId = useId();
  const bioCountId = useId();
  const nameErrorId = useId();
  const photoHintId = useId();
  const nameHintId = useId();
  const bioHintId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const shown = resolveProfileOptions(options ?? PROFILE_OPTION_DEFAULTS);
  // Collapsed on every load: not remembered, not part of the draft.
  const [open, setOpen] = useState(false);
  const optionsTriggerId = useId();
  const optionsRegionId = useId();

  const set = <K extends ProfileOptionKey>(key: K, value: ProfileOptions[K]): void =>
    dispatch({ type: "profile/option", key, value } as EditorAction);

  const focusNonce = focus?.kind === "profile-name" ? focus.nonce : null;
  useEffect(() => {
    if (focusNonce === null) return;
    nameRef.current?.scrollIntoView({ block: "center" });
    nameRef.current?.focus({ preventScroll: true });
    dispatch({ type: "focus/handled", nonce: focusNonce });
  }, [focusNonce, dispatch]);

  const photoOff = !shown.showPhoto;
  const hidden = hiddenParts(shown);
  const nameDescribedBy =
    [nameError ? nameErrorId : null, shown.showName ? null : nameHintId]
      .filter((id) => id !== null)
      .join(" ") || undefined;
  const bioDescribedBy = [bioCountId, shown.showBio ? null : bioHintId]
    .filter((id) => id !== null)
    .join(" ");

  return (
    <section
      aria-labelledby={`${nameId}-title`}
      data-testid="profile-card"
      className="flex flex-col gap-3.5 rounded-md border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id={`${nameId}-title`} className="text-sm font-semibold">
          Profile
        </h2>
        <span className="text-xs text-text-2">Shown at the top of your page</span>
      </div>

      <div
        data-testid="profile-photo-row"
        style={{ "--avatar-radius": AVATAR_RADIUS[shown.photoShape] } as CSSProperties}
        className="[&_[role=img]]:rounded-[var(--avatar-radius)]"
      >
        <ImageUploadControl
          kind="avatar"
          value={photo}
          initials={profileInitials(name)}
          onChange={(next) => dispatch({ type: "profile/photo", value: next })}
        />
      </div>

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
          aria-describedby={nameDescribedBy}
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
          aria-describedby={bioDescribedBy}
          onChange={(event) => dispatch({ type: "profile/bio", value: event.target.value })}
          className="min-h-16 w-full resize-y rounded-md border border-line-3 bg-surface px-3 py-2.5 text-base leading-[1.4] font-normal text-ink"
        />
        <span id={bioCountId} className="self-end font-mono text-[11px] text-text-2">
          {codePointLength(bio)} / {LIMITS.bio}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          id={optionsTriggerId}
          aria-expanded={open}
          aria-controls={optionsRegionId}
          data-testid="profile-options-toggle"
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-line-3 bg-surface px-3 py-1.5 text-left text-sm font-semibold text-ink"
        >
          <span className="flex min-w-0 flex-col">
            <span>Photo and header options</span>
            {hidden.length > 0 && !open ? (
              <span className="text-xs font-normal text-text-2">
                Hidden on your page: {hidden.join(", ")}
              </span>
            ) : null}
          </span>
          <span aria-hidden="true" className={`shrink-0 ${open ? "rotate-180" : ""}`}>
            <ChevronDownIcon size={16} />
          </span>
        </button>

        <div
          id={optionsRegionId}
          role="region"
          aria-label="Photo and header options"
          hidden={!open}
          data-testid="profile-options"
        >
          <div className="flex flex-col gap-3.5 pt-1">
            <div className="flex flex-col gap-1">
              <Switch
                label="Show photo on page"
                pressed={shown.showPhoto}
                describedBy={photoOff ? photoHintId : undefined}
                onToggle={() => set("showPhoto", !shown.showPhoto)}
              />
              {photoOff ? (
                <p id={photoHintId} className="m-0 text-xs text-text-2">
                  {PHOTO_HIDDEN_HINT}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <ChoiceGroup
                label="Photo shape"
                disabled={photoOff}
                choices={PHOTO_SHAPES.map((value) => ({ value, label: PHOTO_SHAPE_LABELS[value] }))}
                current={shown.photoShape}
                onPick={(value) => set("photoShape", value)}
              />
              <ChoiceGroup
                label="Photo size"
                disabled={photoOff}
                choices={PHOTO_SIZES.map((value) => ({ value, label: PHOTO_SIZE_LABELS[value] }))}
                current={shown.photoSize}
                onPick={(value) => set("photoSize", value)}
              />
              <ChoiceGroup
                label="Photo border"
                disabled={photoOff}
                choices={PHOTO_BORDERS.map((value) => ({
                  value,
                  label: PHOTO_BORDER_LABELS[value],
                }))}
                current={shown.photoBorder}
                onPick={(value) => set("photoBorder", value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Switch
                label="Show display name on page"
                pressed={shown.showName}
                describedBy={shown.showName ? undefined : nameHintId}
                onToggle={() => set("showName", !shown.showName)}
              />
              {shown.showName ? null : (
                <p id={nameHintId} className="m-0 text-xs text-text-2">
                  {NAME_HIDDEN_HINT}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Switch
                label="Show bio on page"
                pressed={shown.showBio}
                describedBy={shown.showBio ? undefined : bioHintId}
                onToggle={() => set("showBio", !shown.showBio)}
              />
              {shown.showBio ? null : (
                <p id={bioHintId} className="m-0 text-xs text-text-2">
                  {BIO_HIDDEN_HINT}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A labeled on/off pill (the M2-12 switch of a block row): one button, `aria-pressed`, with its
 * visible label inside it, so the hit area is the whole row and at least 52px by 48px.
 */
function Switch({
  label,
  pressed,
  onToggle,
  describedBy,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-describedby={describedBy}
      onClick={onToggle}
      className="flex min-h-12 min-w-[52px] max-w-full items-center justify-between gap-3 text-left text-[13px] font-normal text-ink-2"
    >
      <span className="min-w-0">{label}</span>
      <span
        aria-hidden="true"
        className={`relative block h-[18px] w-8 shrink-0 rounded-full ${pressed ? "bg-ink" : "bg-line-3"}`}
      >
        <span
          className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${pressed ? "left-4" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

/**
 * A segmented control in the look of the Design screen's option groups (a track, the chosen option
 * white on a 1px ring, `aria-pressed` on each). Off, the group is `aria-disabled` and its options
 * are disabled: the choice is kept, only unavailable.
 */
function ChoiceGroup<V extends string>({
  label,
  choices,
  current,
  disabled,
  onPick,
}: {
  label: string;
  choices: readonly { value: V; label: ReactNode }[];
  current: V;
  disabled: boolean;
  onPick: (value: V) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <div
        role="group"
        aria-label={label}
        aria-disabled={disabled ? "true" : undefined}
        className={`flex flex-wrap gap-0.5 rounded-md border border-line bg-track p-[3px] ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={current === choice.value}
            disabled={disabled}
            onClick={() => onPick(choice.value)}
            style={{ flex: "1 1 72px" }}
            className={`flex min-h-11 min-w-0 items-center justify-center rounded-sm px-2 text-center text-sm leading-tight font-medium ${
              current === choice.value
                ? "bg-surface text-ink ring-1 ring-line-2"
                : "bg-transparent text-text-2"
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
