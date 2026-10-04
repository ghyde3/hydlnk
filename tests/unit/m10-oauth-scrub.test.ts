import { describe, expect, it } from "vitest";
import { FILTERED, scrubEvent, scrubJson, scrubString } from "@/lib/sentry/scrub";

/**
 * M10-17: no secret of the authorization server in a Sentry report. An event holding any of them reads
 * '[Filtered]' wherever it sits (message, breadcrumb, URL, header value, extra), and scrubbing a
 * scrubbed event changes nothing.
 */

const body = (seed: string) => `${seed}`.repeat(43).slice(0, 43);
const ACCESS = `hl_at_${body("A")}`;
const REFRESH = `hl_rt_${body("b")}`;
const CODE = `hl_ac_${body("C-_")}`;
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CSRF = "Zm9vYmFyYmF6cXV4MTIz";
const RESUME = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ROOT = "hydlnk.com";

describe("M10-17 scrubString", () => {
  it.each([
    ["an access token", ACCESS],
    ["a refresh token", REFRESH],
    ["an authorization code", CODE],
  ])("%s becomes [Filtered] wherever it sits", (_name, token) => {
    expect(scrubString(`failed for ${token} just now`, { rootDomain: ROOT })).toBe(
      `failed for ${FILTERED} just now`,
    );
    expect(scrubString(`Authorization: Bearer ${token}`, { rootDomain: ROOT })).toBe(
      `Authorization: Bearer ${FILTERED}`,
    );
    expect(scrubString(`https://x.example/cb?z=${token}&y=1`, { rootDomain: ROOT })).not.toContain(
      token,
    );
    expect(
      scrubString(JSON.stringify({ nested: { value: token } }), { rootDomain: ROOT }),
    ).not.toContain(token);
  });

  it("a token followed by more characters is still cut, and a shorter lookalike is not a token", () => {
    expect(scrubString(`${ACCESS}extra`)).toBe(`${FILTERED}extra`);
    expect(scrubString("hl_at_short")).toBe("hl_at_short");
  });

  it.each([
    ["code_verifier", VERIFIER],
    ["client_secret", "s3cr3t-value"],
    ["client_assertion", "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ4In0.sig"],
    ["csrf", CSRF],
    ["hl_oauth_resume", RESUME],
  ])("%s= in a query string, a cookie header or a form body", (name, value) => {
    expect(scrubString(`/oauth/token?${name}=${value}&x=1`)).toBe(
      `/oauth/token?${name}=${FILTERED}&x=1`,
    );
    expect(scrubString(`${name}=${value}; Path=/`)).not.toContain(value);
    expect(scrubString(`grant_type=authorization_code&${name}=${value}`)).not.toContain(value);
    expect(scrubString(JSON.stringify({ [name]: value }))).not.toContain(value);
  });

  it("is idempotent: scrubbing a scrubbed string changes nothing", () => {
    const text = `a ${ACCESS} b ${REFRESH} c ${CODE} d code_verifier=${VERIFIER} e hl_oauth_resume=${RESUME} f csrf=${CSRF}`;
    const once = scrubString(text, { rootDomain: ROOT });
    expect(once).not.toMatch(/hl_(at|rt|ac)_/);
    expect(once).not.toContain(VERIFIER);
    expect(once).not.toContain(RESUME);
    expect(once).not.toContain(CSRF);
    expect(scrubString(once, { rootDomain: ROOT })).toBe(once);
  });
});

describe("M10-17 scrubEvent and scrubJson", () => {
  const event = () => ({
    message: `token endpoint said ${ACCESS}`,
    exception: { values: [{ type: "Error", value: `bad refresh ${REFRESH}` }] },
    breadcrumbs: [
      {
        category: "fetch",
        message: `POST /oauth/token code_verifier=${VERIFIER}&code=${CODE}`,
        data: { url: `https://app.hydlnk.com/oauth/token?csrf=${CSRF}` },
      },
    ],
    request: {
      url: `https://app.hydlnk.com/oauth/authorize?state=${CODE}`,
      headers: { authorization: `Bearer ${ACCESS}`, cookie: `hl_oauth_resume=${RESUME}` },
      cookies: { hl_oauth_resume: RESUME },
    },
    extra: {
      hl_oauth_resume: RESUME,
      code_verifier: VERIFIER,
      client_secret: "shh",
      client_assertion: "jwt-assertion-value",
      csrf: CSRF,
      note: `retry with ${REFRESH}`,
      list: [ACCESS, { deep: CODE }],
    },
    tags: { which: `hl_oauth_resume=${RESUME}` },
  });

  it("reads [Filtered] for every secret, wherever it sits", () => {
    const out = scrubEvent(event(), { rootDomain: ROOT });
    const text = JSON.stringify(out);
    for (const secret of [
      ACCESS,
      REFRESH,
      CODE,
      VERIFIER,
      CSRF,
      RESUME,
      "shh",
      "jwt-assertion-value",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(out.extra.hl_oauth_resume).toBe(FILTERED);
    expect(out.extra.code_verifier).toBe(FILTERED);
    expect(out.extra.client_secret).toBe(FILTERED);
    expect(out.extra.client_assertion).toBe(FILTERED);
    expect(out.extra.csrf).toBe(FILTERED);
    expect(out.message).toBe(`token endpoint said ${FILTERED}`);
  });

  it("is idempotent: scrubbing a scrubbed event changes nothing", () => {
    const once = scrubEvent(event(), { rootDomain: ROOT });
    expect(scrubEvent(once, { rootDomain: ROOT })).toEqual(once);
  });

  it("a breadcrumb is scrubbed the same way", () => {
    const crumb = scrubJson(
      { message: `POST ${REFRESH}`, data: { csrf: CSRF, hl_oauth_resume: RESUME } },
      { rootDomain: ROOT },
    );
    expect(JSON.stringify(crumb)).not.toMatch(new RegExp(`${REFRESH}|${CSRF}|${RESUME}`));
  });
});
