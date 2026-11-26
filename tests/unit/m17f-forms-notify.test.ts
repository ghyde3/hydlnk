import nodemailer, { type SendMailOptions } from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { sendMessage, type EmailEnv } from "@/lib/domains/email";
import type { RateLimitResult } from "@/lib/rate-limit";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: {} }));

const { notifyOwnerOfLimit, notifyOwnerOfMessage, NOTIFY_LIMIT } =
  await import("@/lib/forms/notify");
const { FORM_LIMIT_SUBJECT, FORM_MESSAGE_SUBJECT } = await import("@/lib/forms/email-content");

/**
 * M17-10 and the limit email of M17-02: the recipient is always the account's own address, the
 * visitor's address is the Reply-To and nowhere else in a header, a line break with "Bcc:" in a name
 * or message adds no header (checked on the message nodemailer builds), at most 30 an hour, skipped
 * without SMTP on a deployment, and neither function ever throws or logs an address.
 */

const OWNER = "owner@example.test";
const SMTP: EmailEnv = { SMTP_HOST: "smtp.example.test", EMAIL_FROM: "HYDLNK <hello@hydlnk.com>" };

/** A real nodemailer that builds the raw message instead of sending it. */
function buildingSmtp() {
  const raw: string[] = [];
  const sent: SendMailOptions[] = [];
  const createTransport = (() => {
    const real = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    return {
      sendMail: async (options: SendMailOptions) => {
        sent.push(options);
        const info = await real.sendMail(options);
        raw.push(String(info.message));
        return info;
      },
    };
  }) as unknown as typeof nodemailer.createTransport;
  return { raw, sent, createTransport };
}

function deps(over: { limit?: RateLimitResult; owner?: unknown; send?: unknown } = {}) {
  const smtp = buildingSmtp();
  const log = vi.fn();
  return {
    smtp,
    log,
    deps: {
      owner: vi.fn(async () =>
        over.owner instanceof Error
          ? Promise.reject(over.owner)
          : "owner" in over
            ? (over.owner as never)
            : { email: OWNER, plan: "free" as const },
      ),
      rateLimit: vi.fn(async () => over.limit ?? { allowed: true, retryAfter: 0 }),
      send:
        (over.send as never) ??
        ((message: Parameters<typeof sendMessage>[0]) =>
          sendMessage(message, SMTP, { createTransport: smtp.createTransport })),
      rootDomain: "localhost:3000",
      log,
    },
  };
}

const notice = (over: Partial<Parameters<typeof notifyOwnerOfMessage>[0]> = {}) => ({
  ownerId: "11111111-1111-4111-8111-111111111111",
  handle: "mara",
  formTitle: "Contact form",
  name: "Vera Visitor",
  email: "vera@example.test",
  message: "Hello <b>there</b>",
  ...over,
});

/** The header block of a raw message: everything before the first empty line, unfolded. */
const headersOf = (raw: string) =>
  raw
    .split("\n\n")[0]!
    .replace(/\n[ \t]+/g, " ")
    .split("\n");

describe("M17-10 the message email", () => {
  it("goes to the account's own address, with the fixed subject and the visitor as Reply-To", async () => {
    const d = deps();
    expect(await notifyOwnerOfMessage(notice(), d.deps)).toBe("sent");
    const headers = headersOf(d.smtp.raw[0]!);
    expect(headers).toContain(`To: ${OWNER}`);
    expect(headers).toContain(`Subject: ${FORM_MESSAGE_SUBJECT}`);
    expect(headers).toContain("Reply-To: vera@example.test");
    // The visitor's address is in no other header.
    expect(headers.filter((line) => line.includes("vera@example.test"))).toEqual([
      "Reply-To: vera@example.test",
    ]);
    expect(d.deps.rateLimit).toHaveBeenCalledWith(
      `form-notify:${notice().ownerId}`,
      NOTIFY_LIMIT,
      3600,
    );
  });

  it("the name, the address and the message are escaped text in the HTML part and plain in the text part", async () => {
    const d = deps();
    await notifyOwnerOfMessage(notice({ message: "<script>alert(1)</script> & more" }), d.deps);
    const raw = d.smtp.raw[0]!;
    const { html, text } = d.smtp.sent[0]! as { html: string; text: string };
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
    expect(html).toContain("Vera Visitor &lt;vera@example.test&gt;");
    // The plain-text part is text: the characters as typed, which no mail client runs.
    expect(text).toContain("<script>alert(1)</script> & more");
    expect(raw).toContain("Content-Type: text/plain");
    expect(raw).toContain("Content-Type: text/html");
  });

  it("a line break followed by Bcc: in a name or a message adds no header", async () => {
    const d = deps();
    await notifyOwnerOfMessage(
      notice({
        name: "Eve\r\nBcc: victim@example.test",
        message: "hi\nBcc: other@example.test\r\nCc: x@example.test",
      }),
      d.deps,
    );
    const headers = headersOf(d.smtp.raw[0]!);
    expect(headers.some((line) => /^(bcc|cc):/i.test(line))).toBe(false);
    expect(headers.filter((line) => /^to:/i.test(line))).toEqual([`To: ${OWNER}`]);
  });

  it("a visitor address that is not a plain address is never a Reply-To", async () => {
    const d = deps();
    await notifyOwnerOfMessage(
      notice({ email: "a@example.test\r\nBcc: victim@example.test" }),
      d.deps,
    );
    const headers = headersOf(d.smtp.raw[0]!);
    expect(headers.some((line) => /^reply-to:/i.test(line))).toBe(false);
    expect(headers.some((line) => /^bcc:/i.test(line))).toBe(false);
  });

  it("past 30 an hour: limited, nothing sent", async () => {
    const d = deps({ limit: { allowed: false, retryAfter: 100 } });
    expect(await notifyOwnerOfMessage(notice(), d.deps)).toBe("limited");
    expect(d.smtp.raw).toHaveLength(0);
    expect(d.deps.owner).not.toHaveBeenCalled();
  });

  it("a deployment without SMTP skips it", async () => {
    const log = vi.fn();
    const d = deps({
      send: (message: Parameters<typeof sendMessage>[0]) =>
        sendMessage(message, { VERCEL_ENV: "production" }, { log }),
    });
    expect(await notifyOwnerOfMessage(notice(), d.deps)).toBe("skipped");
    expect(String(log.mock.calls[0]![0])).not.toContain(OWNER);
  });

  it("locally it goes to Mailpit with ReplyTo", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const d = deps({
      send: (message: Parameters<typeof sendMessage>[0]) =>
        sendMessage(
          message,
          { MAILPIT_URL: "http://mailpit.test" },
          { fetchImpl: fetchImpl as never },
        ),
    });
    expect(await notifyOwnerOfMessage(notice(), d.deps)).toBe("sent");
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.To).toEqual([{ Email: OWNER }]);
    expect(body.ReplyTo).toEqual([{ Email: "vera@example.test" }]);
    expect(body.Subject).toBe(FORM_MESSAGE_SUBJECT);
  });

  it("never throws: a failing transport or owner lookup is skipped and logged without an address", async () => {
    const failing = deps({
      send: async () => Promise.reject(new Error(`SMTP said no to ${OWNER} and vera@example.test`)),
    });
    expect(await notifyOwnerOfMessage(notice(), failing.deps)).toBe("skipped");
    const lookup = deps({ owner: new Error("db down") });
    expect(await notifyOwnerOfMessage(notice(), lookup.deps)).toBe("skipped");
    for (const line of [...failing.log.mock.calls, ...lookup.log.mock.calls].map(String)) {
      expect(line).not.toContain(OWNER);
      expect(line).not.toContain("vera@example.test");
    }
  });

  it("an account that is gone gets nothing", async () => {
    const d = deps({ owner: null });
    expect(await notifyOwnerOfMessage(notice(), d.deps)).toBe("skipped");
    expect(d.smtp.raw).toHaveLength(0);
  });
});

describe("M17-02 the limit email", () => {
  it("one email to the owner with the plan's numbers and no visitor text", async () => {
    const d = deps({ owner: { email: OWNER, plan: "pro" } });
    expect(await notifyOwnerOfLimit({ ownerId: "x" }, d.deps)).toBe("sent");
    const raw = d.smtp.raw[0]!;
    expect(headersOf(raw)).toContain(`To: ${OWNER}`);
    const { html, text } = d.smtp.sent[0]! as { html: string; text: string };
    for (const part of [html, text]) expect(part).toContain("5,000 form submissions on Pro");
    expect(headersOf(raw).some((line) => line.startsWith("Subject:"))).toBe(true);
    expect(FORM_LIMIT_SUBJECT).toBe("Your forms reached this month’s limit");
    expect(headersOf(raw).some((line) => /^reply-to:/i.test(line))).toBe(false);
  });

  it("never throws", async () => {
    const d = deps({ send: async () => Promise.reject(new Error("down")) });
    expect(await notifyOwnerOfLimit({ ownerId: "x" }, d.deps)).toBe("skipped");
  });
});
