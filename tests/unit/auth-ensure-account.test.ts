import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * M1-05 integration test: runs against the local Supabase (supabase start) with the secret key from
 * .env.local. Skipped when the env file or the stack is missing, so `pnpm test` stays usable
 * without Docker, unless REQUIRE_SUPABASE=1 (CI sets it in the step after the stack is up): then a
 * missing stack fails the run instead of skipping the test.
 */
vi.mock("server-only", () => ({}));

function loadEnvLocal(): boolean {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !process.env[match[1]!])
        process.env[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, "$2");
    }
    return Boolean(process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return false;
  }
}

const haveEnv = loadEnvLocal();
let stackUp = false;
if (haveEnv) {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
      signal: AbortSignal.timeout(2000),
    });
    stackUp = res.ok;
  } catch {
    stackUp = false;
  }
}

if (process.env.REQUIRE_SUPABASE === "1" && !(haveEnv && stackUp)) {
  throw new Error(
    "REQUIRE_SUPABASE=1, but the local Supabase stack or .env.local is not available",
  );
}

describe.skipIf(!haveEnv || !stackUp)("M1-05 ensureAccount (integration, local Supabase)", () => {
  let admin: import("@supabase/supabase-js").SupabaseClient;
  let ensureAccount: (id: string) => Promise<void>;
  const userIds: string[] = [];

  async function newUser() {
    const email = `zq-ensure-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
    userIds.push(data.user.id);
    return data.user.id;
  }
  const rows = async (id: string) =>
    (await admin.from("accounts").select("*").eq("id", id)).data ?? [];

  beforeAll(async () => {
    admin = (await import("@/lib/supabase/admin")).createAdminSupabase();
    ensureAccount = (await import("@/lib/auth/accounts")).ensureAccount;
  });

  afterAll(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("recreates a missing row on the free plan with no Stripe customer and not suspended", async () => {
    const id = await newUser();
    await admin.from("accounts").delete().eq("id", id);
    expect(await rows(id)).toHaveLength(0);

    await ensureAccount(id);

    const [row, ...rest] = await rows(id);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ id, plan: "free", stripe_customer_id: null, suspended_at: null });
  });

  it("is idempotent: an existing row (plan pro) is left exactly as it was", async () => {
    const id = await newUser();
    await admin.from("accounts").update({ plan: "pro" }).eq("id", id);
    const before = await rows(id);

    await ensureAccount(id);
    await ensureAccount(id);

    expect(await rows(id)).toEqual(before);
    expect(before[0]?.plan).toBe("pro");
  });

  it("two concurrent calls for one user produce one row and no error", async () => {
    const id = await newUser();
    await admin.from("accounts").delete().eq("id", id);

    const results = await Promise.allSettled([
      ensureAccount(id),
      ensureAccount(id),
      ensureAccount(id),
    ]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(await rows(id)).toHaveLength(1);
  });
});
