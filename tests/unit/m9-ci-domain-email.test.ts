import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * M9-13: the domain-live email in CI's browser suite. The suite runs the production build, where the
 * email would be skipped (no SMTP_HOST on a deployment); with the test hooks on (HYDLNK_QUERY_COUNTER=1,
 * never on a Vercel production deployment) the real wiring (src/lib/domains/deps-server.ts) hands the
 * sender the environment of local development, so it goes to Mailpit and the specs can read it.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));
const serverEnv: Record<string, string | undefined> = { NODE_ENV: "production" };
vi.mock("@/lib/env/server", () => ({ serverEnv }));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));
vi.mock("@/lib/domains/vercel", () => ({ vercelClient: () => ({}) }));
const sent = vi.fn(async () => "sent");
vi.mock("@/lib/domains/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domains/email")>()),
  sendDomainLiveEmail: sent,
}));

const { createDomainDeps } = await import("@/lib/domains/deps-server");
const { emailTransportKind } =
  await vi.importActual<typeof import("@/lib/domains/email")>("@/lib/domains/email");

type SentEnv = Parameters<typeof emailTransportKind>[0];

async function transportFor(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else vi.stubEnv(name, value);
  }
  sent.mockClear();
  await createDomainDeps().sendLiveEmail({
    to: "owner@example.com",
    hostname: "links.example.com",
  });
  const calls = sent.mock.calls as unknown as [unknown, SentEnv][];
  return emailTransportKind(calls[0]![1]);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("which transport the real wiring picks on a production build", () => {
  it("skips the email on a production build with the hooks off", async () => {
    expect(await transportFor({ HYDLNK_QUERY_COUNTER: undefined, VERCEL_ENV: undefined })).toBe(
      "skip",
    );
    expect(await transportFor({ HYDLNK_QUERY_COUNTER: "0" })).toBe("skip");
  });

  it("goes to Mailpit with the hooks on and no Vercel environment: CI's `next start`", async () => {
    expect(await transportFor({ HYDLNK_QUERY_COUNTER: "1", VERCEL_ENV: undefined })).toBe(
      "mailpit",
    );
  });

  it("never on a Vercel deployment, whatever the flag says", async () => {
    serverEnv.VERCEL_ENV = "production";
    expect(await transportFor({ HYDLNK_QUERY_COUNTER: "1", VERCEL_ENV: "production" })).toBe(
      "skip",
    );
    serverEnv.VERCEL_ENV = "preview";
    expect(await transportFor({ HYDLNK_QUERY_COUNTER: "1", VERCEL_ENV: "preview" })).toBe("skip");
    delete serverEnv.VERCEL_ENV;
  });
});
