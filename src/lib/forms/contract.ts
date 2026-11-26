import {
  BLOCK_ID_PATTERN,
  UUID_PATTERN,
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
  formKindLabel,
  switchFormKind,
  type FormKind,
} from "@/lib/document";

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
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

/**
 * The least time any form POST takes, from its arrival to its answer, plus up to the jitter (forms
 * attack pass, finding 2). Without it the time told the outcomes apart: a dropped post answered in
 * 7-11 ms where a stored one took 19 ms or more, and "already subscribed" on a large account
 * answered faster than a store. Every outcome (403 to 503, the pages, every 303) waits until the
 * same moment, so only a request slower than the floor shows its own time. The floor is above the
 * measured p99 of a stored submission on a large account on a production build (PROGRESS.md, forms
 * attack pass). Applied in one place: `handleFormPost` (src/lib/forms/submit.ts).
 */
export const FORM_POST_FLOOR_MS = 250;
export const FORM_POST_JITTER_MS = 10;

/** The owner's message emails a contact form sends at most an hour per account (form-notify). */
export const FORM_NOTIFY_PER_HOUR = 30;

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
  /** A value the database refused although the checks above passed (review B8): never expected. */
  unsupported: "This has characters the form can’t take. Remove them and send again.",
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

/**
 * What counts as a link in what a visitor typed (forms attack pass, finding 4). One rule for the
 * field checks (no link in a name, at most 5 in a message), the blocklist check and the owner's
 * email, which neutralises every one of them:
 *   - `http://`, `https://` or `ftp://` and what follows, or `mailto:` and what follows;
 *   - a `www.` host;
 *   - a bare host with a path: dotted labels, a last label of 2 to 63 letters, then `/`
 *     (`evil.example/login`).
 * Not a link: a bare host with no path (`booking.com`, `node.js`), which names and plain sentences
 * hold too often. No leading word boundary: a link glued to a word character (`xhttps://…`,
 * `_https://…`, `1www.…`) is found all the same.
 */
const LINK =
  /(?:https?|ftp):\/\/[^\s<>"']+|mailto:[^\s<>"']+|www\.[^\s<>"']+|(?:[\p{L}\p{N}-]+\.)+\p{L}{2,63}\/[^\s<>"']*/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;
const MAX_LINKS_RETURNED = 50;

/** The links in a text (the rule above), in order, at most 50. */
export function linksIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LINK)) {
    // Sentence punctuation after a link is not part of it ("see www.example.com, thanks").
    found.push(match[0].replace(TRAILING_PUNCTUATION, ""));
    if (found.length === MAX_LINKS_RETURNED) break;
  }
  return found;
}

/** A text cut at its links (`linksIn`), in order: the pieces between them and the links. */
export function linkParts(text: string): { text: string; link: boolean }[] {
  const parts: { text: string; link: boolean }[] = [];
  let rest = text;
  for (const link of linksIn(text)) {
    const at = rest.indexOf(link);
    if (at < 0) continue;
    if (at > 0) parts.push({ text: rest.slice(0, at), link: false });
    parts.push({ text: link, link: true });
    rest = rest.slice(at + link.length);
  }
  if (rest !== "") parts.push({ text: rest, link: false });
  return parts;
}

/**
 * A text with each of its links (`linksIn`) made inert for plain text: every `.` becomes `[.]` and
 * every `:` becomes `[:]` inside the link (`https[:]//evil[.]example/login`), the usual way to write
 * an address no client turns into a link. The rest of the text, line breaks included, is unchanged.
 */
export function neutralizeLinks(text: string): string {
  return linkParts(text)
    .map((part) => (part.link ? part.text.replace(/[.:]/g, (c) => `[${c}]`) : part.text))
    .join("");
}

function line(raw: string | null | undefined): string {
  return stripHiddenCharacters(String(raw ?? "")).normalize("NFC");
}

function lines(raw: string | null | undefined): string {
  return stripHiddenCharacters(String(raw ?? "").replace(/\r\n?/g, "\n"), {
    multiline: true,
  }).normalize("NFC");
}

/**
 * An address as one spelling (forms attack pass, finding 7): NFKC, so full-width letters and
 * digits (`ｖｉｓｉｔｏｒ＠ｅｘａｍｐｌｅ．ｔｅｓｔ`) and a decomposed accent read as the plain ones and
 * a repeat sign-up is the duplicate it is. Letter case is left to the database (`lower(email)`).
 * `+tags` and dots are kept: they can be different mailboxes.
 */
function address(raw: string | null | undefined): string {
  return stripHiddenCharacters(String(raw ?? "")).normalize("NFKC");
}

/** A format character (zero-width space, joiners, soft hyphen, BOM): invisible, never in an address. */
const FORMAT_CHARACTER = /\p{Cf}/u;
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC_OR_GREEK = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

/**
 * True when a label of the address's domain mixes Latin letters with Cyrillic or Greek ones
 * (`exаmple.test` with a Cyrillic `а`): a look-alike of another address, refused. A domain in one
 * script (`пример.рф`, an IDN the link rules accept too, src/lib/document/url.ts) is kept as typed.
 */
function mixesScripts(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return domain.split(".").some((label) => LATIN.test(label) && CYRILLIC_OR_GREEK.test(label));
}

/**
 * A visitor's submission, cleaned and checked (M17-06): trimmed, control and bidi characters
 * removed (a message keeps its line feeds; CRLF becomes LF), the name and message in NFC and the
 * address in NFKC (finding 7), then validated by the kind's rules; an address holding a format
 * character or a domain label that mixes Latin with Cyrillic or Greek is not valid. A
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
    email: address(raw.email),
    name: asksName(kind, askName) ? line(raw.name) : "",
    message: kind === "contact" ? lines(raw.message) : "",
  };
  const errors: SubmissionErrors = {};

  if (values.email === "") errors.email = SUBMISSION_MESSAGES.emailMissing;
  else if (
    codePointLength(values.email) > SUBMISSION_LIMITS.email ||
    !isEmailAddress(values.email) ||
    FORMAT_CHARACTER.test(values.email) ||
    mixesScripts(values.email)
  )
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

/** What `record_form_submission` answers (the migrations' SQL surface). */
export const RECORD_STATUSES = [
  "stored",
  "duplicate",
  "over_limit",
  "over_limit_first",
  "over_daily_limit",
  "unavailable",
  "invalid_email",
  "invalid_name",
  "invalid_message",
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** The field a check of the table refused (`invalid_*`), or null for any other status. */
export function refusedField(status: RecordStatus): SubmissionField | null {
  switch (status) {
    case "invalid_email":
      return "email";
    case "invalid_name":
      return "name";
    case "invalid_message":
      return "message";
    default:
      return null;
  }
}

/** The columns a client may read: every column of the table (it holds no visitor hash). */
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

/** `?form=`: "all" or one block id; anything else is null (the export answers 400, the screen shows all). */
export function parseFormFilter(
  value: string | readonly string[] | null | undefined,
): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === "" || raw === AUDIENCE_ALL_FORMS) {
    return AUDIENCE_ALL_FORMS;
  }
  return isBlockId(raw) ? raw : null;
}

/** `?page=`: a whole number from 1 (anything else is page 1). */
export function parsePageNumber(value: string | readonly string[] | null | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === "string" && /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1;
  return n;
}

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
  notifySkipped: "audience-notify-skipped",
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
