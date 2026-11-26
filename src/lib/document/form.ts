/**
 * The form block's fixed words (Wave D, M17-03): its two kinds, their labels and default texts, and
 * the default consent line. The document schema, the block defaults and the editor read them from
 * here; `src/lib/forms/contract.ts` re-exports them for the submission side. Not to be confused
 * with the `contact` block type (contact details, M9-17): this is the `form` block, kind `contact`.
 */

export const FORM_KINDS = ["signup", "contact"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

/** How a form of each kind is named where its heading is empty (block list, Audience, analytics). */
export const FORM_KIND_LABELS: Record<FormKind, string> = {
  signup: "Sign-up form",
  contact: "Contact form",
};

/** The button label and success message a new form of each kind starts with. */
export const FORM_DEFAULTS: Record<FormKind, { buttonLabel: string; successMessage: string }> = {
  signup: { buttonLabel: "Subscribe", successMessage: "Thanks. You’re on the list." },
  contact: { buttonLabel: "Send", successMessage: "Thanks. Your message was sent." },
};

/** The consent line under the button of a new form (M17-11). */
export const DEFAULT_CONSENT = "Your details go to the owner of this page, who may contact you.";

export const FORM_KIND_MESSAGE = "Choose Sign-up or Contact.";

/**
 * The texts a form keeps when the editor switches its kind (M17-07): the button label and success
 * message follow the new kind only while they still hold the old kind's defaults.
 */
export function switchFormKind<
  T extends { kind: FormKind; buttonLabel: string; successMessage: string },
>(block: T, kind: FormKind): T {
  if (block.kind === kind) return block;
  const from = FORM_DEFAULTS[block.kind];
  const to = FORM_DEFAULTS[kind];
  return {
    ...block,
    kind,
    buttonLabel: block.buttonLabel === from.buttonLabel ? to.buttonLabel : block.buttonLabel,
    successMessage:
      block.successMessage === from.successMessage ? to.successMessage : block.successMessage,
  };
}
