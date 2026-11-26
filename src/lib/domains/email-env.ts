import "server-only";
import { serverEnv } from "@/lib/env/server";
import { testHooksEnabled } from "@/lib/env/test-hooks";
import type { EmailEnv } from "./email";

/** The email settings of this server, for `sendMessage` (src/lib/domains/email.ts). */
export function serverEmailEnv(): EmailEnv {
  return {
    SMTP_HOST: serverEnv.SMTP_HOST,
    SMTP_PORT: serverEnv.SMTP_PORT,
    SMTP_USER: serverEnv.SMTP_USER,
    SMTP_PASS: serverEnv.SMTP_PASS,
    EMAIL_FROM: serverEnv.EMAIL_FROM,
    MAILPIT_URL: process.env.MAILPIT_URL,
    VERCEL_ENV: serverEnv.VERCEL_ENV,
    // The end-to-end harness (CI's browser suite runs `next start` with the test hooks on, never on a
    // Vercel production deployment) sends like local development, to Mailpit: its specs read the
    // emails there (M9-13).
    NODE_ENV: testHooksEnabled() ? "test" : serverEnv.NODE_ENV,
  };
}
