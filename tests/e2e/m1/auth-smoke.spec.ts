import { expect, test } from "@playwright/test";
import { url } from "../helpers";
import { adminClient, signInAs } from "../fixtures/auth";

/** M1-04: the signInAs fixture yields a signed-in session for the seeded user in both projects. */
test.describe("M1-04 signInAs fixture", () => {
  test("M1-04 signInAs signs the seeded user mara in", async ({ context }) => {
    const signedIn = await signInAs(context, "mara@example.test");
    expect(signedIn.userId).toBe("00000000-0000-4000-8000-0000000000a1");

    const cookies = await context.cookies(url("app"));
    const auth = cookies.filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    expect(auth.length).toBeGreaterThan(0);

    // The cookie's access token belongs to mara (verified by the auth server, not decoded here).
    const jwt = JSON.parse(
      Buffer.from(
        auth
          .map((c) => c.value)
          .join("")
          .replace(/^base64-/, ""),
        "base64url",
      ).toString(),
    ) as { access_token: string };
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"}/auth/v1/user`,
      {
        headers: {
          Authorization: `Bearer ${jwt.access_token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? (await publishable()),
        },
      },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe("mara@example.test");

    // Mara's plan is untouched by signing in.
    const { data } = await adminClient()
      .from("accounts")
      .select("plan")
      .eq("id", signedIn.userId)
      .single();
    expect(data?.plan).toBe("pro");
  });
});

async function publishable(): Promise<string> {
  const { publishableKey } = await import("../fixtures/auth");
  return publishableKey();
}
