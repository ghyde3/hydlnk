"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { AdminAnnouncement } from "@/lib/admin/announcement-queries";
import { ANNOUNCEMENT_MESSAGE_MAX } from "@/lib/announcements/rules";
import { postAdmin } from "@/lib/blocklist/admin-client";
import { formatWhen } from "./format";
import { DANGER, FieldBox, PRIMARY, controlClass } from "./fields";

/**
 * The /admin/announcement screen below its header (M13-09): the message now set (or scheduled) with
 * Clear, and the form that sets a new one, which replaces it. Times are typed in the admin's own time
 * zone and sent as UTC. The server repeats every rule (`validateAnnouncement`) and answers with the
 * sentence shown under the field.
 */

/** A `datetime-local` value (the browser's time zone) as an ISO string in UTC, or "" when blank. */
function toIso(local: string): string {
  if (local === "") return "";
  const time = new Date(local).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : "invalid";
}

type Errors = { message?: string; link?: string; starts?: string; ends?: string };

function fieldOf(message: string): keyof Errors {
  if (/link/i.test(message)) return "link";
  if (/start/i.test(message) && !/end/i.test(message)) return "starts";
  if (/end/i.test(message)) return "ends";
  return "message";
}

export function AnnouncementForm({ current }: { current: AdminAnnouncement[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const startsAt = toIso(starts);
    const endsAt = toIso(ends);
    if (startsAt === "invalid") return setErrors({ starts: "The start time isn’t valid." });
    if (endsAt === "" || endsAt === "invalid") return setErrors({ ends: "Choose when it ends." });
    sending.current = true;
    setPending(true);
    setErrors({});
    setNote(null);
    const result = await postAdmin("/api/admin/announcement", {
      message,
      link,
      starts_at: startsAt === "" ? null : startsAt,
      ends_at: endsAt,
    });
    sending.current = false;
    setPending(false);
    if (!result.ok) {
      setErrors({ [fieldOf(result.message)]: result.message });
      return;
    }
    setMessage("");
    setLink("");
    setStarts("");
    setEnds("");
    setNote("Announcement set.");
    router.refresh();
  }

  async function clear(id: string) {
    if (sending.current) return;
    sending.current = true;
    setClearError(null);
    const result = await postAdmin(`/api/admin/announcement/${encodeURIComponent(id)}/clear`, {});
    sending.current = false;
    if (!result.ok) {
      setClearError(result.message);
      return;
    }
    setNote("Announcement cleared.");
    router.refresh();
  }

  return (
    <>
      <section
        aria-label="Current announcement"
        className="rounded-md border border-line bg-surface p-4 hl:p-5"
      >
        {current.length > 0 ? (
          <div className="flex flex-col gap-4">
            {current.map((item) => (
              <div key={item.id} data-announcement-current className="flex flex-col gap-2">
                <p className="font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase">
                  {item.showing ? "Showing now" : "Scheduled"}
                </p>
                <p className="text-[15px] leading-relaxed [overflow-wrap:anywhere]">
                  {item.message}
                </p>
                {item.link ? (
                  <p className="font-mono text-xs text-text-2 [overflow-wrap:anywhere]">
                    {item.link}
                  </p>
                ) : null}
                <p className="font-mono text-xs text-text-2">
                  {formatWhen(item.startsAt)} to {formatWhen(item.endsAt)}
                </p>
              </div>
            ))}
            <div>
              <button type="button" onClick={() => void clear(current[0]!.id)} className={DANGER}>
                {current.length > 1 ? "Clear all announcements" : "Clear announcement"}
              </button>
            </div>
            {clearError ? (
              <p role="alert" className="text-[13px] text-bad">
                {clearError}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-text-2">No announcement is set.</p>
        )}
      </section>

      {note ? (
        <p role="status" className="text-sm font-semibold text-good">
          {note}
        </p>
      ) : null}

      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-label="Set the announcement"
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 hl:p-5"
      >
        <h2 className="text-base font-bold">
          {current.length > 0 ? "Replace the announcement" : "Set an announcement"}
        </h2>
        <FieldBox
          label="Message"
          error={errors.message}
          hint={`Plain text, up to ${ANNOUNCEMENT_MESSAGE_MAX} characters. ${[...message].length} used.`}
        >
          {(props) => (
            <textarea
              {...props}
              name="message"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className={`${controlClass(Boolean(errors.message))} py-2`}
            />
          )}
        </FieldBox>
        <FieldBox label="Link (optional)" error={errors.link} hint="An https address.">
          {(props) => (
            <input
              {...props}
              type="text"
              name="link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="url"
              className={controlClass(Boolean(errors.link))}
            />
          )}
        </FieldBox>
        <div className="grid gap-3 hl:grid-cols-2">
          <FieldBox label="Starts" error={errors.starts} hint="Leave blank to start now.">
            {(props) => (
              <input
                {...props}
                type="datetime-local"
                name="starts"
                value={starts}
                onChange={(event) => setStarts(event.target.value)}
                className={controlClass(Boolean(errors.starts))}
              />
            )}
          </FieldBox>
          <FieldBox label="Ends" error={errors.ends} hint="In your time zone.">
            {(props) => (
              <input
                {...props}
                type="datetime-local"
                name="ends"
                value={ends}
                onChange={(event) => setEnds(event.target.value)}
                className={controlClass(Boolean(errors.ends))}
              />
            )}
          </FieldBox>
        </div>
        <div>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={`${PRIMARY} w-full hl:w-auto`}
          >
            {pending
              ? "Saving..."
              : current.length > 0
                ? "Replace announcement"
                : "Set announcement"}
          </button>
        </div>
      </form>
    </>
  );
}
