/**
 * Report a page (M5-05): the words, limits and field names the form, the route handler and the
 * tests share. No imports, so the client form can use it.
 */

/** The reasons, in the order the select shows them. `value` is what `reports.reason` stores. */
export const REPORT_REASONS = [
  { value: "phishing", label: "Phishing or scam" },
  { value: "malware", label: "Malware" },
  { value: "impersonation", label: "Impersonation" },
  { value: "illegal", label: "Illegal content" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export const REPORT_REASON_VALUES = REPORT_REASONS.map((reason) => reason.value) as [
  ReportReason,
  ...ReportReason[],
];

export const REPORT_LIMITS = {
  /** Characters (code points) of details. Mirrors reports_details_length. */
  details: 1000,
  /** Mirrors reports_email_length. */
  email: 254,
  /** What the address field may hold: a pasted URL is longer than a host name. */
  address: 300,
  /** The request body the route reads at most, in bytes. */
  bodyBytes: 16 * 1024,
} as const;

/** The hourly limit per reporter, counted by report_rate_limit_hit. */
export const REPORT_RATE = { limit: 5, windowSeconds: 3600 } as const;

/**
 * The hourly limit on the whole form, whoever sends: counted after the per-reporter limit, under one
 * fixed key, so a crowd of reporters (a botnet, a /64 that was not reduced) still cannot fill the
 * table or the admin queue. Far above what real reports look like.
 */
export const REPORT_GLOBAL_RATE = { limit: 600, windowSeconds: 3600 } as const;
/** The key the global counter is stored under: 64 hex characters, never a reporter hash. */
export const REPORT_GLOBAL_KEY = "0".repeat(64);

/** New reports one page takes in an hour before more are dropped (a flood against one page). */
export const REPORT_PAGE_CAP = 25;

export const REPORT_MESSAGES = {
  sent: "Report sent. We’ll review it.",
  tooMany: "Too many reports. Try again later.",
  notFound: "We couldn’t find that page. Check the address.",
  server: "Something went wrong. Try again in a moment.",
} as const;

/**
 * The hidden field bots fill in. A real visitor never sees it (it is off screen, not focusable and
 * hidden from assistive technology), so a value in it means the form was filled by a script.
 */
export const HONEYPOT_FIELD = "company_url";

/** The address a page is shown under in the form, whatever host the app runs on (brand copy). */
export const BRAND_DOMAIN = "hydlnk.com";

export const REPORT_PATH = "/report";
export const REPORT_SUBMIT_PATH = "/report/submit";

/** Field names of the JSON or form body, and of the `errors` object an answer carries. */
export type ReportField = "page" | "address" | "reason" | "details" | "email";
