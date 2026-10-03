/**
 * The profile's display options (M6-15, M6-17): the photo's shape, size and border, and whether the
 * photo, the display name and the bio show on the page. One module owns the lists, the defaults,
 * the Publish gate's wording and the pure helpers the schema, the loader, the publish form, the
 * editor reducer and the renderer all share, so no layer keeps its own copy of a list.
 *
 * Every option has a default, and a document stored before these existed has none of them: reading
 * it fills the defaults, so an old page looks exactly as it did. The renderer never trusts a stored
 * string: it maps each value through a fixed list (`pickOption`) and falls back to the default.
 */

export const PHOTO_SHAPES = ["circle", "rounded", "square"] as const;
export const PHOTO_SIZES = ["small", "medium", "large"] as const;
/** `page` is the theme's own border (its width, in the accent color), the look before M6-15. */
export const PHOTO_BORDERS = ["page", "none", "thin", "thick"] as const;

export type PhotoShape = (typeof PHOTO_SHAPES)[number];
export type PhotoSize = (typeof PHOTO_SIZES)[number];
export type PhotoBorder = (typeof PHOTO_BORDERS)[number];

/** Rendered width and height of the photo, in px, at the page's normal width. */
export const PHOTO_SIZE_PX: Record<PhotoSize, number> = { small: 64, medium: 96, large: 144 };

export interface ProfileOptions {
  photoShape: PhotoShape;
  photoSize: PhotoSize;
  photoBorder: PhotoBorder;
  /** False draws no photo and no initials at all. */
  showPhoto: boolean;
  /** False keeps the name as a visually hidden heading (it is still the page title). */
  showName: boolean;
  /** False draws no bio (it is still the meta description). */
  showBio: boolean;
}
export type ProfileOptionKey = keyof ProfileOptions;

export const PROFILE_OPTION_DEFAULTS: Readonly<ProfileOptions> = {
  photoShape: "circle",
  photoSize: "medium",
  photoBorder: "page",
  showPhoto: true,
  showName: true,
  showBio: true,
};

export const PROFILE_OPTION_KEYS = Object.keys(PROFILE_OPTION_DEFAULTS) as ProfileOptionKey[];

/** What the Publish gate says about a value outside its list, one sentence per field. */
export const PROFILE_OPTION_MESSAGES: Record<ProfileOptionKey, string> = {
  photoShape: "Choose a photo shape from the list.",
  photoSize: "Choose a photo size from the list.",
  photoBorder: "Choose a photo border from the list.",
  showPhoto: "Choose on or off.",
  showName: "Choose on or off.",
  showBio: "Choose on or off.",
};

const LISTS: Record<ProfileOptionKey, readonly unknown[] | "boolean"> = {
  photoShape: PHOTO_SHAPES,
  photoSize: PHOTO_SIZES,
  photoBorder: PHOTO_BORDERS,
  showPhoto: "boolean",
  showName: "boolean",
  showBio: "boolean",
};

/** Is `value` one the option accepts: a member of its list, or a real boolean? */
export function isProfileOptionValue<K extends ProfileOptionKey>(
  key: K,
  value: unknown,
): value is ProfileOptions[K] {
  const list = LISTS[key];
  return list === "boolean" ? typeof value === "boolean" : list.includes(value);
}

/**
 * `value` when it is valid for the option, else the option's default. Never returns a raw string
 * that is not on the list, which is what lets the renderer put it in a `data-*` attribute.
 */
export function pickOption<K extends ProfileOptionKey>(key: K, value: unknown): ProfileOptions[K] {
  return isProfileOptionValue(key, value)
    ? value
    : (PROFILE_OPTION_DEFAULTS[key] as ProfileOptions[K]);
}

/**
 * The six options of a stored profile, every one filled: valid stored values are carried through,
 * missing or invalid ones take the default. Total: any input, including `undefined`, works.
 */
export function resolveProfileOptions(raw: unknown): ProfileOptions {
  const source =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
  return {
    photoShape: pickOption("photoShape", source?.photoShape),
    photoSize: pickOption("photoSize", source?.photoSize),
    photoBorder: pickOption("photoBorder", source?.photoBorder),
    showPhoto: pickOption("showPhoto", source?.showPhoto),
    showName: pickOption("showName", source?.showName),
    showBio: pickOption("showBio", source?.showBio),
  };
}

/** One change to one option, typed so a caller cannot pair a key with another option's value. */
export type ProfileOptionChange = {
  [K in ProfileOptionKey]: { key: K; value: ProfileOptions[K] };
}[ProfileOptionKey];

/**
 * The profile with one option changed, or `profile` itself (the same object) when the change is a
 * no-op or the value is not valid for the option, so the editor never writes a value outside its
 * list and the screen can skip the autosave. The option is always written explicitly.
 */
export function applyProfileOption<P extends object>(
  profile: P,
  change: { key: ProfileOptionKey; value: unknown },
): P {
  const { key, value } = change;
  if (!PROFILE_OPTION_KEYS.includes(key) || !isProfileOptionValue(key, value)) return profile;
  const current = (profile as Record<string, unknown>)[key];
  if (current === value) return profile;
  return { ...profile, [key]: value };
}
