/**
 * The rules of the app announcement (M13-09), shared by the admin action and the screen: plain text of
 * 1 to 200 characters (no control characters), at most one link and it is https, a start (blank or past
 * means now) and an end after it. The database repeats them as constraints (20261013000004). The text
 * is never HTML: the editor draws it as React text.
 */

export const ANNOUNCEMENT_MESSAGE_MAX = 200;
export const ANNOUNCEMENT_LINK_MAX = 2048;

export interface AnnouncementInput {
  message: string;
  link?: string | null;
  starts_at?: string | null;
  ends_at: string;
}

export type AnnouncementCheck =
  | {
      ok: true;
      value: { message: string; link: string | null; startsAt: string | null; endsAt: string };
    }
  | { ok: false; message: string };

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const refuse = (message: string): AnnouncementCheck => ({ ok: false, message });

export function validateAnnouncement(input: AnnouncementInput, now: Date): AnnouncementCheck {
  const message = input.message.trim();
  if (message.length === 0) return refuse("Write the message.");
  if ([...message].length > ANNOUNCEMENT_MESSAGE_MAX) {
    return refuse(`The message is at most ${ANNOUNCEMENT_MESSAGE_MAX} characters.`);
  }
  if (CONTROL.test(message)) return refuse("The message is plain text on one line.");

  let link: string | null = null;
  const rawLink = (input.link ?? "").trim();
  if (rawLink !== "") {
    let url: URL | null = null;
    try {
      url = new URL(rawLink);
    } catch {
      url = null;
    }
    if (
      url === null ||
      url.protocol !== "https:" ||
      /[\s\u0000-\u001f\u007f]/.test(rawLink) ||
      url.username !== "" ||
      url.password !== "" ||
      rawLink.length > ANNOUNCEMENT_LINK_MAX
    ) {
      return refuse("The link must be an https address.");
    }
    link = url.toString();
  }

  const startsAt = parseTime(input.starts_at);
  if (startsAt === "bad") return refuse("The start time isn’t valid.");
  const endsAt = parseTime(input.ends_at);
  if (endsAt === "bad" || endsAt === null) return refuse("The end time isn’t valid.");
  const effectiveStart = Math.max(startsAt ?? now.getTime(), now.getTime());
  if (endsAt <= effectiveStart)
    return refuse("The end must be after the start, and in the future.");

  return {
    ok: true,
    value: {
      message,
      link,
      startsAt: startsAt === null ? null : new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    },
  };
}

/** An ISO date-time with an offset (the browser sends UTC). Blank is null; anything else is "bad". */
function parseTime(raw: string | null | undefined): number | null | "bad" {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return "bad";
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : "bad";
}

/** Is the announcement showing at `nowMs`? (starts_at <= now < ends_at, the table's own rule.) */
export function isActiveAt(window: { starts_at: string; ends_at: string }, nowMs: number): boolean {
  return Date.parse(window.starts_at) <= nowMs && Date.parse(window.ends_at) > nowMs;
}
