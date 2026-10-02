import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

const { hostOnlyCookie } = await import("@/lib/routing/cookies");

/** M1-06: the auth cookie is host-only everywhere and Secure wherever the site is served over https. */
describe("hostOnlyCookie", () => {
  const supabaseOptions = {
    path: "/",
    sameSite: "lax" as const,
    maxAge: 400 * 24 * 3600,
    domain: ".hydlnk.com",
  };

  it("drops the domain so the cookie stays on the app host", () => {
    expect(hostOnlyCookie(supabaseOptions, "hydlnk.com")).not.toHaveProperty("domain");
    expect(hostOnlyCookie(supabaseOptions, "localhost:3000")).not.toHaveProperty("domain");
  });

  it("keeps path, SameSite and lifetime", () => {
    expect(hostOnlyCookie(supabaseOptions, "hydlnk.com")).toMatchObject({
      path: "/",
      sameSite: "lax",
      maxAge: 400 * 24 * 3600,
    });
  });

  it("is Secure on https deployments and not on plain-http local development", () => {
    expect(hostOnlyCookie(supabaseOptions, "hydlnk.com").secure).toBe(true);
    expect(hostOnlyCookie(supabaseOptions, "staging.example.com").secure).toBe(true);
    expect(hostOnlyCookie(supabaseOptions, "localhost:3000").secure).toBe(false);
  });

  it("takes the root domain from the environment by default (localhost here)", () => {
    expect(hostOnlyCookie(supabaseOptions).secure).toBe(false);
  });

  it("does not mutate the options it is given", () => {
    const input = { ...supabaseOptions };
    hostOnlyCookie(input, "hydlnk.com");
    expect(input).toEqual(supabaseOptions);
  });
});
