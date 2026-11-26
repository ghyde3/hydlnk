import {
  BLOCK_ID_PATTERN,
  codePointLength,
  isEmailAddress,
  isValidSubPagePath,
  stripHiddenCharacters,
  type FormKind,
} from "@/lib/document";

/**
 * The forms wave's shared contract (Wave D, M17-01 to M17-11): the paths of the two public routes,
 * the field names the block's markup posts, the submission rules, the result-page states, the SQL
 * results and the columns a client may read. Pure and client-safe: the tenant renderer, the public
 * route, the editor and the Audience screen all import it, so they cannot drift.
 */

export {
  DEFAULT_CONSENT,
  FORM_DEFAULTS,
  FORM_KINDS,
  FORM_KIND_LABELS,
  switchFormKind,
  type FormKind,
} from "@/lib/document";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value);
}

/** `/f/{pageId}/{blockId}`: where a form posts, and its "sent" page. Both segments encoded. */
export function formActionPath(pageId: string, blockId: string): string {
  return `/f/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}`;
}

/** `/f/{pageId}/o`: the open marker (section 3.3 of the plan). Throws unless `pageId` is a UUID. */
export function formOpenPath(pageId: string): string {
  if (!isUuid(pageId)) throw new Error("formOpenPath: pageId is not a UUID");
  return `/f/${pageId}/o`;
}

/** The `name` of each control the block's markup posts. */
export const FORM_FIELD = {
  email: "email",
  name: "name",
  message: "message",
  honeypot: "hl_confirm",
  token: "t",
} as const;

export const SUBMISSION_LIMITS = {
  email: 254,
  name: 80,
  message: 2000,
  links: 5,
  bodyBytes: 32768,
} as const;

/** The fixed labels of the block's controls. */
export const FORM_LABELS = {
  email: "Email",
  name: "Name",
  message: "Message",
  honeypot: "Leave this field empty",
  back: "Back",
} as const;

export const SUBMISSION_MESSAGES = {
  emailMissing: "Enter an email address.",
  emailInvalid: "Enter a valid email address.",
  nameMissing: "Enter your name.",
  nameTooLong: `Use ${SUBMISSION_LIMITS.name} characters or fewer.`,
  nameLink: "Remove the link from the name.",
  messageMissing: "Write a message.",
  messageTooLong: "Use 2,000 characters or fewer.",
  messageLinks: `Use ${SUBMISSION_LIMITS.links} links or fewer.`,
} as const;

export type SubmissionField = "email" | "name" | "message";
export interface SubmissionValues {
  email: string;
  name: string;
  message: string;
}
export type SubmissionErrors = Partial<Record<SubmissionField, string>>;

/** Whether a form of `kind` draws the name field (`askName` is read for a sign-up only). */
export function asksName(kind: FormKind, askName: boolean): boolean {
  return kind === "contact" || askName;
}

const LINK = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;
const MAX_LINKS_RETURNED = 50;

/** The http(s) links and bare `www.` hosts in a text, in order, at most 50. */
export function linksIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LINK)) {
    // Sentence punctuation after a link is not part of it ("see www.example.com, thanks").
    found.push(match[0].replace(TRAILING_PUNCTUATION, ""));
    if (found.length === MAX_LINKS_RETURNED) break;
  }
  return found;
}

function line(raw: string | null | undefined): string {
  return stripHiddenCharacters(String(raw ?? ""));
}

function lines(raw: string | null | undefined): string {
  return stripHiddenCharacters(String(raw ?? "").replace(/\r\n?/g, "\n"), { multiline: true });
}

/**
 * A visitor's submission, cleaned and checked (M17-06): trimmed, control and bidi characters
 * removed (a message keeps its line feeds; CRLF becomes LF), then validated by the kind's rules. A
 * sign-up's message is always empty and its name too unless it asks for one. `values` is always the
 * cleaned input, so an error page can show what was typed.
 */
export function parseSubmission(
  kind: FormKind,
  askName: boolean,
  raw: Partial<Record<SubmissionField, string | null>>,
):
  | { ok: true; values: SubmissionValues }
  | { ok: false; values: SubmissionValues; errors: SubmissionErrors } {
  const values: SubmissionValues = {
    email: line(raw.email),
    name: asksName(kind, askName) ? line(raw.name) : "",
    message: kind === "contact" ? lines(raw.message) : "",
  };
  const errors: SubmissionErrors = {};

  if (values.email === "") errors.email = SUBMISSION_MESSAGES.emailMissing;
  else if (codePointLength(values.email) > SUBMISSION_LIMITS.email || !isEmailAddress(values.email))
    errors.email = SUBMISSION_MESSAGES.emailInvalid;

  if (kind === "contact" && values.name === "") errors.name = SUBMISSION_MESSAGES.nameMissing;
  else if (codePointLength(values.name) > SUBMISSION_LIMITS.name)
    errors.name = SUBMISSION_MESSAGES.nameTooLong;
  else if (linksIn(values.name).length > 0) errors.name = SUBMISSION_MESSAGES.nameLink;

  if (kind === "contact") {
    if (values.message === "") errors.message = SUBMISSION_MESSAGES.messageMissing;
    else if (codePointLength(values.message) > SUBMISSION_LIMITS.message)
      errors.message = SUBMISSION_MESSAGES.messageTooLong;
    else if (linksIn(values.message).length > SUBMISSION_LIMITS.links)
      errors.message = SUBMISSION_MESSAGES.messageLinks;
  }

  return Object.keys(errors).length === 0 ? { ok: true, values } : { ok: false, values, errors };
}

/** The three result pages a form leads to (one block drawn alone on the site's theme). */
export type FormViewKind = "confirm" | "error" | "sent";
export interface FormRenderState {
  blockId: string;
  view: FormViewKind;
  values?: SubmissionValues;
  errors?: SubmissionErrors;
  /** The signed token for the hidden `t` field (confirm and error views). */
  token?: string;
  /** Where "Back" goes on the sent view: "/" or "/{path}". */
  backHref?: string;
}

/** The line above the fields of the confirm and error pages. */
export const FORM_VIEW_LINES: Record<"confirm" | "error", string> = {
  confirm: "Check your details, then send.",
  error: "Fix what is marked, then send.",
};

/** Where the sent page's "Back" may lead: Home (`/`) or one sub-page (`/{path}`), nothing else. */
export function isBackHref(value: unknown): value is string {
  return (
    value === "/" ||
    (typeof value === "string" && value.startsWith("/") && isValidSubPagePath(value.slice(1)))
  );
}

/** The titles of the result pages. */
export const FORM_VIEW_TITLES: Record<FormViewKind, string> = {
  confirm: "Check and send",
  error: "Fix and send",
  sent: "Sent",
};

/** What `record_form_submission` answers (the migration's SQL surface). */
export const RECORD_STATUSES = [
  "stored",
  "duplicate",
  "over_limit",
  "over_limit_first",
  "unavailable",
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** The columns a client may read (never `visitor_hash`). */
export const SUBMISSION_COLUMNS =
  "id, site_id, entry_id, block_id, kind, email, name, message, created_at";
export interface SubmissionRow {
  id: string;
  site_id: string;
  entry_id: string | null;
  block_id: string;
  kind: FormKind;
  email: string;
  name: string;
  message: string;
  created_at: string;
}

/** The Audience screen's paths and paging (M17-08, M17-09). */
export const AUDIENCE_PATH = "/audience";
export const AUDIENCE_EXPORT_PATH = "/audience/export";
export const AUDIENCE_PAGE_SIZE = 50;
/** `?form=`: every form, or one block id. */
export const AUDIENCE_ALL_FORMS = "all";

/** The `data-testid` values of the form block's editor panel and the Audience screen. */
export const FORM_TEST_IDS = {
  editor: "form-block-editor",
  kind: "form-kind",
  notify: "form-notify",
} as const;

export const AUDIENCE_TEST_IDS = {
  screen: "audience-screen",
  meter: "audience-meter",
  overLimit: "audience-over-limit",
  responsibility: "audience-responsibility",
  filter: "audience-filter",
  list: "audience-list",
  row: "audience-row",
  empty: "audience-empty",
  loadError: "audience-load-error",
  deleteOne: "audience-delete",
  deleteAll: "audience-delete-all",
  deleteDialog: "audience-delete-dialog",
  export: "audience-export",
  pager: "audience-pager",
} as const;

/** The Audience screen's fixed sentences (M17-08, M17-11). */
export const AUDIENCE_COPY = {
  responsibility:
    "These are details people sent you through your forms. You decide how to use them and you’re responsible for that.",
  empty: "No submissions yet. Add a form block to collect sign-ups and messages.",
  removedForm: "Removed form",
} as const;
