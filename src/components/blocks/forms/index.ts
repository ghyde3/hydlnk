import type { ComponentType } from "react";
import type { BlockType } from "@/lib/document";
import { CardForm, EmbedForm, ImageForm } from "./media-forms";
import { DividerForm, HeaderForm, LinkForm, TextForm } from "./simple-forms";
import { GridForm, SocialForm } from "./list-forms";
import type { BlockFormProps } from "./types";

export type { BlockFormProps } from "./types";

/**
 * The expanded edit panel body of each block type (M2-11). Each form renders only the block's own
 * fields; the panel around it owns Move up, Move down, Delete block and the visibility toggle.
 * A form reads raw draft values and reports the whole next block through `onChange`.
 */
export const BLOCK_FORMS: Record<BlockType, ComponentType<BlockFormProps>> = {
  link: LinkForm,
  card: CardForm,
  header: HeaderForm,
  text: TextForm,
  image: ImageForm,
  social: SocialForm,
  embed: EmbedForm,
  grid: GridForm,
  divider: DividerForm,
};
