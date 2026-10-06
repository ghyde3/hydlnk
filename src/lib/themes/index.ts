/**
 * Pure theme logic for the Design screen, the saved-themes card, the block override controls and
 * the Publish gate. Client-safe: the server-only loader is `@/lib/themes/load`.
 */
export {
  INK_ON_DARK,
  INK_ON_LIGHT,
  LIGHT_THRESHOLD,
  contrastRatio,
  hexToRgb,
  inkFor,
  isHexColor,
  isLightColor,
  perceivedBrightness,
  relativeLuminance,
} from "./color";
export {
  SAVED_THEME_LIMIT,
  SAVED_THEME_LIMIT_CODE,
  THEME_NAME_MAX,
  savedThemeLimitMessage,
} from "./limits";
export {
  EMPTY_NAME_MESSAGE,
  cardTag,
  checkThemeName,
  isEdited,
  nextThemeName,
  ownThemes,
  resolvedTokensFor,
  themeById,
  themeStatusLabel,
  themeTokensFor,
  tokenSetsEqual,
  type NameCheck,
} from "./status";
export {
  BORDER_WIDTH_OPTIONS,
  BUTTON_STYLES,
  BUTTON_STYLE_LABELS,
  COLOR_KEYS,
  RADIUS_OPTIONS,
  STYLE_SPECS,
  activeOverrides,
  hasColorOverride,
  hasStyleControl,
  isOverridable,
  overrideChipLabel,
  overridesOf,
  readBorderWidth,
  readButtonStyle,
  readColor,
  readRadius,
  setBorderWidth,
  setButtonStyle,
  setColor,
  setRadius,
  styleSpecOf,
  type ButtonStyle,
  type ColorControlSpec,
  type OverridableBlock,
  type OverrideConcept,
  type StyleBlockType,
  type StyleControl,
  type StyleSpec,
} from "./overrides";
export {
  deleteSavedTheme,
  fetchThemeLibrary,
  insertSavedTheme,
  renameSavedTheme,
  toThemeRow,
  updateSavedThemeTokens,
  type ThemeDelete,
  type ThemeOp,
  type ThemeOpFailure,
} from "./client";
export { PUBLISH_STOPPED, friendlyPublishError, friendlyPublishErrors } from "./publish-errors";
export { mediaPathOf } from "./bg-image";
export type { ThemeRow } from "./types";
