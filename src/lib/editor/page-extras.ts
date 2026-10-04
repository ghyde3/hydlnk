import {
  LIMITS,
  isBannerEmpty,
  newBlockId,
  pickNameFont,
  pickNameSize,
  pickLogoPlacement,
  singleLine,
  truncateToCodePoints,
  type DraftDoc,
  type ImageRef,
  type LogoPlacement,
  type NameSize,
} from "@/lib/document";
import type { FontFamily } from "@/lib/theme";
import { collectIds } from "./duplicate";

/**
 * Pure edits of the page-level extras of Wave K for the editor (M9-23, M9-24): the support banner
 * and the profile's logo, logo placement, name font and name size. Each takes the draft and
 * returns the next one, or the SAME object when nothing changes (so the autosave does not write on
 * a no-op); the workspace applies them with `editDraft`, so each is one undo step (typing coalesces
 * by the group the caller names).
 */

export type BannerFieldName = "text" | "label" | "url";

const BANNER_MAX: Record<Exclude<BannerFieldName, "url">, number> = {
  text: LIMITS.bannerText,
  label: LIMITS.bannerLabel,
};

/** What a banner field stores: one line and within its limit (a paste is cut, never refused); the address as typed. */
export function clampBannerField(field: BannerFieldName, value: string): string {
  if (field === "url") return value.slice(0, LIMITS.draftUrl);
  return truncateToCodePoints(singleLine(value), BANNER_MAX[field]);
}

/** A fresh banner id that no block, icon, cell or link of the page already holds. */
function freshBannerId(draft: DraftDoc): string {
  const taken = collectIds(draft);
  let id = newBlockId();
  while (taken.has(id)) id = newBlockId();
  return id;
}

/**
 * One field of the banner. The banner comes into being (with a fresh id, visible) at the first edit
 * of a field of a page that has none.
 */
export function setBannerField(draft: DraftDoc, field: BannerFieldName, raw: string): DraftDoc {
  const value = clampBannerField(field, raw);
  const current = draft.banner;
  if (current) {
    if (current[field] === value) return draft;
    return { ...draft, banner: { ...current, [field]: value } };
  }
  if (value === "") return draft;
  return {
    ...draft,
    banner: {
      id: freshBannerId(draft),
      visible: true,
      text: "",
      label: "",
      url: "",
      [field]: value,
    },
  };
}

/**
 * The "Show a message at the top of your page" switch. On: the banner is visible (and made when the
 * page had none). Off: it is hidden and keeps what was typed, so turning it on again brings it back;
 * a banner with nothing in it is taken out of the draft instead (the page is as if it had none).
 */
export function setBannerVisible(draft: DraftDoc, visible: boolean): DraftDoc {
  const current = draft.banner;
  if (visible) {
    if (current) {
      return current.visible === true ? draft : { ...draft, banner: { ...current, visible: true } };
    }
    return {
      ...draft,
      banner: { id: freshBannerId(draft), visible: true, text: "", label: "", url: "" },
    };
  }
  if (!current) return draft;
  if (isBannerEmpty(current)) {
    const rest: DraftDoc = { ...draft };
    delete rest.banner;
    return rest;
  }
  return current.visible === false ? draft : { ...draft, banner: { ...current, visible: false } };
}

/** The profile's logo (an upload finished, or null to remove it). */
export function setProfileLogo(draft: DraftDoc, logo: ImageRef | null): DraftDoc {
  const current = draft.profile.logo ?? null;
  if (logo === current) return draft;
  const profile = { ...draft.profile };
  if (logo === null) delete profile.logo;
  else profile.logo = logo;
  return { ...draft, profile };
}

/** Where the logo goes; a value outside the list changes nothing. */
export function setLogoPlacement(draft: DraftDoc, placement: LogoPlacement): DraftDoc {
  if (pickLogoPlacement(placement) !== placement) return draft;
  const current = pickLogoPlacement(draft.profile.logoPlacement);
  if (current === placement && draft.profile.logoPlacement === placement) return draft;
  return { ...draft, profile: { ...draft.profile, logoPlacement: placement } };
}

/** The name's own font: a family of the allowlist, or null for "Same as headings" (the key is removed). */
export function setNameFont(draft: DraftDoc, family: FontFamily | null): DraftDoc {
  if (family !== null && pickNameFont(family) === null) return draft;
  const current = draft.profile.nameFont ?? null;
  if (current === family) return draft;
  const profile = { ...draft.profile };
  if (family === null) delete profile.nameFont;
  else profile.nameFont = family;
  return { ...draft, profile };
}

/** The name's size; a value outside the list changes nothing. */
export function setNameSize(draft: DraftDoc, size: NameSize): DraftDoc {
  if (pickNameSize(size) !== size) return draft;
  if (draft.profile.nameSize === size) return draft;
  return { ...draft, profile: { ...draft.profile, nameSize: size } };
}
