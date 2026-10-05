import type { ComponentType } from "react";
import type { BlockType } from "@/lib/document";
import { CardForm, EmbedForm, ImageForm } from "./media-forms";
import { LinkForm } from "./link-form";
import { DividerForm, HeaderForm, TextForm } from "./simple-forms";
import { GridForm, SocialForm } from "./list-forms";
import { MapForm } from "./map-form";
import { AppsForm, BookForm } from "./store-forms";
import { ContactForm } from "./contact-form";
import { DiscountForm } from "./discount-form";
import { FaqForm } from "./faq-form";
import { HoursFormStub, ItemsFormStub } from "./items-hours-form-stub";
import { PageLinkForm } from "./page-link-form";
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
  faq: FaqForm,
  contact: ContactForm,
  discount: DiscountForm,
  book: BookForm,
  apps: AppsForm,
  map: MapForm,
  // M11-07: the editor worker replaces this stub with the real form (label, and a target picker).
  page_link: PageLinkForm,
  // M12-01, M12-02: the editor worker replaces these stubs with the real forms.
  items: ItemsFormStub,
  hours: HoursFormStub,
};
