import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { makeOwner, type TestOwner } from "./publish-support";

/**
 * Shared setup for the forms wave's integration tests against the local stack (M17-01, M17-02): a
 * signed-in client for an owner, the publishable-key client, and a site with something published so
 * `record_form_submission` takes submissions for it.
 */

export function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
}

export function publishableClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function signIn(admin: SupabaseClient, owner: TestOwner): Promise<SupabaseClient> {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: owner.email });
  if (link.error || !link.data.properties) throw new Error(`generateLink: ${link.error?.message}`);
  const client = publishableClient();
  const session = await client.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (session.error) throw new Error(`verifyOtp: ${session.error.message}`);
  return client;
}

/** An owner whose site has something published (the minimal object the checks read). */
export async function publishedOwner(
  admin: SupabaseClient,
  label: string,
  plan: "free" | "pro" | "studio" = "free",
): Promise<TestOwner> {
  const owner = await makeOwner(admin, label, undefined, plan);
  const { error } = await admin
    .from("pages")
    .update({ published: { version: 1, blocks: [] }, published_at: new Date().toISOString() })
    .eq("id", owner.pageId);
  if (error) throw new Error(`publish: ${error.message}`);
  return owner;
}

export async function record(
  admin: SupabaseClient,
  owner: TestOwner,
  email: string,
  blockId = "formSignup01",
): Promise<string> {
  const { data, error } = await admin.rpc("record_form_submission", {
    p_site_id: owner.pageId,
    p_block_id: blockId,
    p_entry_id: null as unknown as string,
    p_kind: "signup",
    p_email: email,
    p_name: "",
    p_message: "",
  });
  if (error) throw new Error(`record: ${error.code}`);
  return (data as { status: string }[])[0]!.status;
}
