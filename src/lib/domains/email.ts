import nodemailer from "nodemailer";
import { HOSTNAME_MAX_LENGTH, HOSTNAME_PATTERN } from "./hostname";
import { liveEmailContent } from "./live-email";

/**
 * Sends the domain-live email (M5-23). No `server-only` import and no environment read: `env` is
 * handed in, so the transport choice is unit-testable ("./email-server" feeds it the real
 * environment).
 *
 *   SMTP_HOST set   SMTP through nodemailer (the same provider as the auth email): SMTP_PORT
 *                   (default 587; 465 is implicit TLS), SMTP_USER and SMTP_PASS when the provider
 *                   needs a login, EMAIL_FROM as the sender.
 *   nothing set, local development
 *                   Supabase's Mailpit. Its SMTP port is not published to the host, so the message
 *                   goes through Mailpit's HTTP API (POST /api/v1/send on MAILPIT_URL, default
 *                   http://localhost:54324): it lands in the same inbox the auth emails use.
 *   nothing set, any deployment (VERCEL_ENV set or NODE_ENV=production)
 *                   skipped: one log line, no address, nothing thrown. Never a reason to fail a
 *                   verification.
 *
 * The content is rendered by react-email (M9-09: src/emails/domain-live.tsx), which is why building
 * it is asynchronous. A hostname that is not the shape of a stored `domains.hostname` is refused
 * before anything is rendered or sent.
 */

export interface EmailEnv {
  SMTP_HOST?: string | undefined;
  SMTP_PORT?: string | undefined;
  SMTP_USER?: string | undefined;
  SMTP_PASS?: string | undefined;
  EMAIL_FROM?: string | undefined;
  MAILPIT_URL?: string | undefined;
  VERCEL_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
}

export type EmailTransportKind = "smtp" | "mailpit" | "skip";

export function emailTransportKind(env: EmailEnv): EmailTransportKind {
  if (env.SMTP_HOST) return "smtp";
  if (env.VERCEL_ENV || env.NODE_ENV === "production") return "skip";
  return "mailpit";
}

export interface EmailSenderDeps {
  fetchImpl?: typeof fetch;
  createTransport?: typeof nodemailer.createTransport;
  log?: (message: string) => void;
}

const LOCAL_FROM = "HYDLNK <hello@hydlnk.com>";

/** True for a value that could be a stored domains.hostname: the database's own pattern, at most 253 characters. */
export function isStoredHostname(value: unknown): value is string {
  return typeof value === "string" && value.length <= HOSTNAME_MAX_LENGTH && HOSTNAME_PATTERN.test(value);
}

export async function sendDomainLiveEmail(
  input: { to: string; hostname: string },
  env: EmailEnv,
  deps: EmailSenderDeps = {},
): Promise<"sent" | "skipped" | "refused"> {
  // Before anything is rendered: a stored hostname is lower case letters, digits, hyphens and dots.
  // Nothing else reaches the template, and the log line never holds the value.
  if (!isStoredHostname(input.hostname)) {
    (deps.log ?? console.warn)(
      "[domains] the domain-live email was refused: the hostname is not a valid stored hostname (verification is unaffected)",
    );
    return "refused";
  }
  const kind = emailTransportKind(env);
  if (kind === "skip") {
    (deps.log ?? console.warn)(
      "[domains] SMTP_HOST is not set: the domain-live email was skipped (verification is unaffected)",
    );
    return "skipped";
  }

  const content = await liveEmailContent(input.hostname);
  if (kind === "smtp") {
    const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : 587;
    const transport = (deps.createTransport ?? nodemailer.createTransport)({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail({
      from: env.EMAIL_FROM ?? LOCAL_FROM,
      to: input.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    return "sent";
  }

  // Local Mailpit over HTTP.
  const base = (env.MAILPIT_URL ?? "http://localhost:54324").replace(/\/+$/, "");
  const response = await (deps.fetchImpl ?? fetch)(`${base}/api/v1/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: { Email: "hello@hydlnk.com", Name: "HYDLNK" },
      To: [{ Email: input.to }],
      Subject: content.subject,
      Text: content.text,
      HTML: content.html,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Mailpit refused the message (HTTP ${response.status})`);
  return "sent";
}
