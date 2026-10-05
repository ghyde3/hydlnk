import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rand, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M11-11: a new site's private name comes from server code, not from the column default (which is
 * still "Main page" for the sites made before Wave M): "Main site", then "Site 2" and "Site 3".
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M11-11 new sites are named by the server (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("the first site is Main site, the next ones Site 2 and Site 3", async () => {
    const { createPageWithClient } = await import("@/lib/pages/create-page-core");
    const tag = rand(6);
    const created = await admin.auth.admin.createUser({
      email: `zq-names-${tag}@example.com`,
      email_confirm: true,
    });
    const userId = created.data.user!.id;
    owners.push({ userId, email: "", pageId: "", handle: "" });
    await admin.from("accounts").update({ plan: "pro" }).eq("id", userId);

    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const made = await createPageWithClient(admin as never, userId, `zq-nm${n}-${tag}`);
      expect(made.ok).toBe(true);
      if (made.ok) ids.push(made.pageId);
    }
    const names: string[] = [];
    for (const id of ids) {
      const row = await admin.from("pages").select("name").eq("id", id).single();
      names.push(row.data!.name as string);
    }
    expect(names).toEqual(["Main site", "Site 2", "Site 3"]);
  });
});
