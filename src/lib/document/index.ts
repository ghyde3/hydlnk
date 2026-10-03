/**
 * The page document: one module for the schemas, limits, ids, URL rules, embed parsing, block
 * defaults and the publish form. The editor, the Publish action and the public-page query all
 * import from here; nothing else defines the document shape.
 */
export {
  BLOCK_TYPES,
  BLOCK_TYPE_LABELS,
  IMAGE_PATH_PATTERN,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  blockSchema,
  draftDocSchema,
  imageRefSchema,
  publishBlockSchema,
  publishDocSchema,
  publishedDocSchema,
  type Block,
  type BlockType,
  type CardBlock,
  type DividerBlock,
  type DocTheme,
  type DraftDoc,
  type EmbedBlock,
  type GridBlock,
  type GridCell,
  type HeaderBlock,
  type ImageBlock,
  type ImageRef,
  type LinkBlock,
  type Profile,
  type PublishDoc,
  type SocialBlock,
  type SocialIcon,
  type SocialPlatform,
  type SocialWebPlatform,
  type TextBlock,
} from "./schema";
export { LIMITS, codePointLength, singleLine, truncateToCodePoints } from "./limits";
export {
  PHOTO_BORDERS,
  PHOTO_SHAPES,
  PHOTO_SIZES,
  PHOTO_SIZE_PX,
  PROFILE_OPTION_DEFAULTS,
  PROFILE_OPTION_KEYS,
  PROFILE_OPTION_MESSAGES,
  applyProfileOption,
  isProfileOptionValue,
  pickOption,
  resolveProfileOptions,
  type PhotoBorder,
  type PhotoShape,
  type PhotoSize,
  type ProfileOptionChange,
  type ProfileOptionKey,
  type ProfileOptions,
} from "./profile-options";
export { BLOCK_ID_PATTERN, newBlockId } from "./ids";
export {
  EMAIL_ERROR_MESSAGE,
  MAX_EMAIL_LENGTH,
  MAX_URL_LENGTH,
  URL_ERROR_MESSAGE,
  emailAddress,
  httpUrl,
  isEmailAddress,
  isHttpUrl,
  mailtoHref,
  normalizeUrl,
  safeHref,
} from "./url";
export {
  EMBED_ERROR_MESSAGE,
  parseEmbed,
  type EmbedKind,
  type EmbedProvider,
  type ParsedEmbed,
  type SpotifyKind,
} from "./embed";
export {
  blockDefaults,
  changeSocialPlatform,
  emptyDraft,
  newGridCell,
  newSocialIcon,
} from "./defaults";
export {
  collectImageRefs,
  collectPublishErrors,
  publishFormsEqual,
  toPublishForm,
  type PublishError,
} from "./publish";
