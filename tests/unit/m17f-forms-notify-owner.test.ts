import { beforeAll, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";

vi.mock("server-only", () => ({}));

// The local stack's URL and key come from .env.local before the server modules read the environment;
// the notify module is imported in beforeAll, so the unit step (no env) skips this file cleanly.
const { run } = await stackIsUp();

/**
 * M17-10, review A3: the form emails go only to an account whose sign-in address is confirmed
 * (`email_confirmed_at`), read with the secret key from the real auth table.
 */
describe.skipIf(!run)(
  "M17-10 only a confirmed sign-in address gets a form email (review A3, local Supabase)",
  () => {
    let readOwner: typeof import("@/lib/forms/notify").readOwner;
    beforeAll(async () => {
      ({ readOwner } = await import("@/lib/forms/notify"));
    });

    it("readOwner answers the address of a confirmed account and null for an unconfirmed one", async () => {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        {
          auth: { persistSession: false },
        },
      );
      const tag = Math.random().toString(36).slice(2, 8);
      const confirmed = await admin.auth.admin.createUser({
        email: `zq-fconf-${tag}@example.com`,
        email_confirm: true,
      });
      const unconfirmed = await admin.auth.admin.createUser({
        email: `zq-funconf-${tag}@example.com`,
        email_confirm: false,
      });
      try {
        expect(await readOwner(confirmed.data.user!.id)).toEqual({
          email: `zq-fconf-${tag}@example.com`,
          plan: "free",
        });
        expect(await readOwner(unconfirmed.data.user!.id)).toBeNull();
      } finally {
        await admin.auth.admin.deleteUser(confirmed.data.user!.id);
        await admin.auth.admin.deleteUser(unconfirmed.data.user!.id);
      }
    }, 30_000);
  },
);
