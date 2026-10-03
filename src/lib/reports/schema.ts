import { z } from "zod";
import { codePointLength } from "@/lib/document/limits";
import { isEmailAddress } from "@/lib/document/url";
import {
  REPORT_LIMITS,
  REPORT_REASON_VALUES,
  type ReportField,
  type ReportReason,
} from "./constants";

/**
 * The report form's input, validated on the server (M5-05). The route handler runs this on every
 * submission, whatever the client did. The messages name the field and what to do, because the
 * form shows them under the field.
 */

export interface ReportInput {
  /** A page id, from the `?page=` link of a public page's footer. */
  page?: string;
  /** What the visitor typed when there is no page id: a handle address or a custom domain. */
  address?: string;
  reason: ReportReason;
  details?: string;
  email?: string;
}

export type ReportErrors = Partial<Record<ReportField, string>>;

export type ParsedReport = { ok: true; data: ReportInput } | { ok: false; errors: ReportErrors };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Controls Postgres or a viewer could trip over (NUL included); tab and line breaks stay. */
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

const optionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
};

export const ADDRESS_REQUIRED = "Enter the page’s address, like name.hydlnk.com.";
export const REASON_REQUIRED = "Choose a reason.";
export const DETAILS_REQUIRED = "Tell us what is wrong. Details are required for Something else.";
export const EMAIL_INVALID = "Enter a valid email address, or leave it empty.";
export const PAGE_INVALID = "That report link isn’t valid. Enter the page’s address instead.";
export const detailsTooLong = `Details can be at most ${REPORT_LIMITS.details} characters. Shorten them.`;

const schema = z
  .object({
    page: z.string().optional(),
    address: z.string().optional(),
    reason: z.unknown(),
    details: z.string().optional(),
    email: z.string().optional(),
  })
  .transform((raw, ctx) => {
    const issue = (path: ReportField, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };

    const page = optionalText(raw.page);
    if (page !== undefined && !UUID.test(page)) issue("page", PAGE_INVALID);

    const address = optionalText(raw.address);
    if (address !== undefined && address.length > REPORT_LIMITS.address) {
      issue("address", ADDRESS_REQUIRED);
    }
    if (page === undefined && address === undefined) issue("address", ADDRESS_REQUIRED);

    const reason = REPORT_REASON_VALUES.find((value) => value === raw.reason);
    if (!reason) issue("reason", REASON_REQUIRED);

    const details = optionalText(raw.details?.replace(/\r\n?/g, "\n").replace(CONTROLS, ""));
    if (details !== undefined && codePointLength(details) > REPORT_LIMITS.details) {
      issue("details", detailsTooLong);
    }
    if (reason === "other" && details === undefined) issue("details", DETAILS_REQUIRED);

    const email = optionalText(raw.email);
    if (email !== undefined && !isEmailAddress(email)) issue("email", EMAIL_INVALID);

    return {
      page: page?.toLowerCase(),
      address,
      reason: reason as ReportReason,
      details,
      email,
    } satisfies ReportInput;
  });

/**
 * Validates a raw body (every value already a string or missing). The first message per field wins.
 * Anything that is not a string counts as missing, so an object or array in a field is an error on
 * that field rather than a crash.
 */
export function parseReportInput(raw: unknown): ParsedReport {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : undefined);
  const result = schema.safeParse({
    page: text("page"),
    address: text("address"),
    reason: body.reason,
    details: text("details"),
    email: text("email"),
  });
  if (result.success) return { ok: true, data: result.data };
  const errors: ReportErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as ReportField | undefined;
    if (field && errors[field] === undefined) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
