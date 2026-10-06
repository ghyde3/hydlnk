import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";

/** ".hydlnk.com", the part of the address that never changes. */
export const ADDRESS_SUFFIX = `.${HANDLE_DISPLAY_DOMAIN}`;
/** What the specimen line says before the visitor types. */
export const PLACEHOLDER_HANDLE = "you";

/** One face a specimen line is set in. */
export interface SpecimenFace {
  /** Which look this copy belongs to, for the hero's look switch; absent outside the hero. */
  look?: string;
  family: string;
  weight: number;
  /** One character's width as a share of the font size (see looks.ts). */
  advance: number;
}
