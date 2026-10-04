import { describe, expect, it } from "vitest";
import { createBeforeBreadcrumb } from "@/lib/sentry/hooks";
import { FILTERED, scrubEvent, scrubString, stripQuery, stripQueryInText } from "@/lib/sentry/scrub";

/**
 * M9-10 privacy: the pure scrubber that runs over every Sentry event before it leaves. An email
 * address becomes '[email]'; a handle host becomes '[handle].{root}'; /t/{handle}, /sites/{id} and
 * /share/{token} lose their value; token, code, access_token, refresh_token and key values, sb-
 * cookies and JWT-shaped strings become '[Filtered]'.
 */

const ROOT = "hydlnk.com";
const LOCAL = "localhost:3000";
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const SHARE = "https://app.hydlnk.com/share/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdo";

describe("M9-10 scrubString", () => {
  const scrub = (value: string, rootDomain = ROOT) => scrubString(value, { rootDomain });

  it("an email address becomes [email], wherever it is", () => {
    expect(scrub("failed for gary@example.com today")).toBe("failed for [email] today");
    expect(scrub("a.b+tag@sub.example.co.uk,x@y.io")).toBe("[email],[email]");
    expect(scrub("https://x.test/cb?email=gary%40example.com&n=1")).toBe("https://x.test/cb?email=[email]&n=1");
    expect(scrub(JSON.stringify({ to: "owner@example.test" }))).toBe('{"to":"[email]"}');
  });

  it("a handle host becomes [handle].{root}, for the production root and the local one", () => {
    expect(scrub("fetch https://mara.hydlnk.com/ failed")).toBe("fetch https://[handle].hydlnk.com/ failed");
    expect(scrub("mara.hydlnk.com and zq-test-1.hydlnk.com")).toBe("[handle].hydlnk.com and [handle].hydlnk.com");
    expect(scrub("http://mara.localhost:3000/x", LOCAL)).toBe("http://[handle].localhost:3000/x");
    expect(scrub("MARA.HYDLNK.COM")).toBe("[handle].hydlnk.com");
  });

  it("our own hosts are not handles: the root, app, www, a longer port, another domain", () => {
    for (const same of ["https://hydlnk.com/pricing", "https://app.hydlnk.com/editor", "https://www.hydlnk.com/", "https://example.com/hydlnk.com"]) {
      expect(scrub(same)).toBe(same);
    }
    expect(scrub("http://app.localhost:3000/editor", LOCAL)).toBe("http://app.localhost:3000/editor");
    expect(scrub("http://localhost:3000/", LOCAL)).toBe("http://localhost:3000/");
    expect(scrub("http://mara.localhost:30001/", LOCAL)).toBe("http://mara.localhost:30001/");
    // No root domain to go by: host names are left alone (the paths and the rest still apply).
    expect(scrubString("https://mara.hydlnk.com/")).toBe("https://mara.hydlnk.com/");
  });

  it("/t/{handle}, /sites/{id} and /share/{token} become /t/[handle], /sites/[id] and /share/[token]", () => {
    expect(scrub("GET /t/mara 500")).toBe("GET /t/[handle] 500");
    expect(scrub("/t/mara/extra?x=1")).toBe("/t/[handle]/extra?x=1");
    expect(scrub("/sites/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("/sites/[id]");
    expect(scrub(`render ${SHARE} failed`)).toBe("render https://app.hydlnk.com/share/[token] failed");
    expect(scrub("/share/abc_DEF-123?utm=1")).toBe("/share/[token]?utm=1");
  });

  it("token, code, access_token, refresh_token and key values become [Filtered]", () => {
    expect(scrub("https://app.hydlnk.com/auth/callback?code=abc123&state=x")).toBe(
      "https://app.hydlnk.com/auth/callback?code=[Filtered]&state=x",
    );
    expect(scrub("?token=abc&access_token=def&refresh_token=ghi&key=jkl&token_hash=mno")).toBe(
      "?token=[Filtered]&access_token=[Filtered]&refresh_token=[Filtered]&key=[Filtered]&token_hash=[Filtered]",
    );
    expect(scrub("#access_token=eyJabc&refresh_token=zzz&type=recovery")).toBe(
      "#access_token=[Filtered]&refresh_token=[Filtered]&type=recovery",
    );
    expect(scrub('{"token":"abc","code": "def","key":"ghi","n":1}')).toBe(
      '{"token":"[Filtered]","code": "[Filtered]","key":"[Filtered]","n":1}',
    );
    expect(scrub("apikey=zzz API_KEY=yyy")).toBe("apikey=[Filtered] API_KEY=[Filtered]");
  });

  it("names that merely contain those words are left alone", () => {
    for (const same of ["monkey=banana", "keyboard=1", "tokens=3", "barcode=12", "https://x.test/?encoded=1", "stateful=yes"]) {
      expect(scrub(same), same).toBe(same);
    }
  });

  it("any sb- cookie and any JWT-shaped string become [Filtered]", () => {
    expect(scrub("cookie sb-abcdefghij-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0; Path=/")).toBe(
      "cookie sb-abcdefghij-auth-token=[Filtered]; Path=/",
    );
    expect(scrub("sb-ref-auth-token.0=abc.def; sb-ref-auth-token.1=ghi")).toBe(
      "sb-ref-auth-token.0=[Filtered]; sb-ref-auth-token.1=[Filtered]",
    );
    expect(scrub(`Bearer ${JWT}`)).toBe(`Bearer ${FILTERED}`);
    expect(scrub(`jwt=${JWT}&x=1`)).not.toContain("eyJ");
    expect(scrub(`token ${JWT} and ${JWT}`)).toBe(`token ${FILTERED} and ${FILTERED}`);
    // Not a JWT: dotted names that do not start the way a JWT header does.
    expect(scrub("at Object.handler.fetchData")).toBe("at Object.handler.fetchData");
    expect(scrub("react-dom.production.min.js")).toBe("react-dom.production.min.js");
  });

  it("a home directory in a stack path loses the user name", () => {
    expect(scrub("/Users/gary/dev/hydlnk/src/x.ts")).toBe("/Users/[user]/dev/hydlnk/src/x.ts");
    expect(scrub("/home/runner/work/x")).toBe("/home/[user]/work/x");
  });

  it("is idempotent: scrubbing a scrubbed string changes nothing", () => {
    const messy = [
      `${SHARE}?token=a&code=b mara.hydlnk.com gary@example.com /t/mara /sites/x1 ${JWT} sb-a-auth-token=zzz key=1 /Users/gary/x`,
      "api_key=abc token=def",
      '{"token":"a","key":"b"}',
      "/t/[handle] /sites/[id] /share/[token] [handle].hydlnk.com [email] [Filtered]",
    ];
    for (const value of messy) {
      const once = scrub(value);
      expect(scrub(once), value).toBe(once);
    }
  });

  it("leaves ordinary text alone", () => {
    for (const same of ["Something went wrong. Try again.", "TypeError: Cannot read properties of undefined (reading 'x')", "GET /app/editor 200", "Hydration failed because the server rendered HTML didn't match"]) {
      expect(scrub(same)).toBe(same);
    }
  });
});

describe("M9-10 stripQuery", () => {
  it("cuts an address or a path at its query string and fragment", () => {
    expect(stripQuery("https://app.hydlnk.com/editor?x=1#y")).toBe("https://app.hydlnk.com/editor");
    expect(stripQuery("/design#top")).toBe("/design");
    expect(stripQuery("/design")).toBe("/design");
    expect(stripQueryInText("GET https://x.supabase.co/rest/v1/pages?handle=eq.mara&select=*")).toBe("GET https://x.supabase.co/rest/v1/pages");
    expect(stripQueryInText("no address here?")).toBe("no address here?");
  });
});

/** An event as the SDK builds it, with something personal in every field the brief names. */
function richEvent() {
  return {
    event_id: "0123456789abcdef0123456789abcdef",
    level: "error",
    message: "Could not send the link to gary@example.com for mara.hydlnk.com",
    logentry: { message: "also gary@example.com" },
    transaction: "GET /t/mara?x=1",
    server_name: "Garys-MacBook.local",
    user: { id: "u1", email: "gary@example.com", ip_address: "203.0.113.9", username: "gary" },
    request: {
      url: `${SHARE}?token=secret1&x=2#frag`,
      method: "GET",
      query_string: "token=secret1&x=2",
      cookies: { "sb-abc-auth-token": "base64-eyJ0" },
      headers: { Cookie: "sb-abc-auth-token=zzz", Authorization: `Bearer ${JWT}`, "User-Agent": "x" },
      data: { password: "hunter2", email: "gary@example.com" },
    },
    tags: { handle_host: "mara.hydlnk.com", page: "/t/mara", owner: "gary@example.com" },
    extra: {
      note: `see ${SHARE}`,
      jwt: JWT,
      token: "tok-123",
      nested: { deeper: [{ email: "a@b.co", code: "oauth-code-9", list: ["x@y.zz", "/sites/abc-123"] }] },
    },
    contexts: { nextjs: { request_path: "/t/mara?code=zzz", router_path: "/t/[handle]" } },
    exception: {
      values: [
        {
          type: "Error",
          value: `Failed for gary@example.com via ${SHARE} with ${JWT}`,
          stacktrace: {
            frames: [
              {
                filename: "/Users/gary/dev/hydlnk/src/x.ts",
                function: "send",
                lineno: 3,
                vars: { to: "gary@example.com", host: "mara.hydlnk.com", access_token: "abc", url: `${SHARE}?code=1`, note: `${SHARE}?code=1` },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/pages?handle=eq.mara&email=eq.gary%40example.com", method: "GET" } },
      { category: "navigation", data: { from: "/t/mara?x=1", to: `/share/abc?code=1` } },
      { category: "console", message: "gary@example.com" },
    ],
    spans: [
      { op: "http.client", description: "GET https://x.supabase.co/rest/v1/pages?handle=eq.mara", data: { "url.full": "https://x.supabase.co/rest/v1/pages?handle=eq.mara", "url.query": "?handle=eq.mara", "http.url": "https://x.supabase.co/a?b=c" } },
      { op: "db", description: "select * from accounts where email = 'gary@example.com'" },
    ],
  };
}

describe("M9-10 scrubEvent", () => {
  const scrubbed = scrubEvent(richEvent(), { rootDomain: ROOT });
  const text = JSON.stringify(scrubbed);

  it("the message, every exception value, the frame variables, tags, extras, the request address and the transaction name are scrubbed", () => {
    expect(scrubbed.message).toBe("Could not send the link to [email] for [handle].hydlnk.com");
    expect(scrubbed.logentry.message).toBe("also [email]");
    expect(scrubbed.exception.values[0]!.value).toBe(`Failed for [email] via https://app.hydlnk.com/share/[token] with ${FILTERED}`);
    const frame = scrubbed.exception.values[0]!.stacktrace.frames[0]!;
    expect(frame.vars).toEqual({
      to: "[email]",
      host: "[handle].hydlnk.com",
      access_token: FILTERED,
      // A field that holds an address loses its query string; in free text the secret is filtered in place.
      url: "https://app.hydlnk.com/share/[token]",
      note: "https://app.hydlnk.com/share/[token]?code=[Filtered]",
    });
    expect(frame.filename).toBe("/Users/[user]/dev/hydlnk/src/x.ts");
    expect(scrubbed.tags).toEqual({ handle_host: "[handle].hydlnk.com", page: "/t/[handle]", owner: "[email]" });
    expect(scrubbed.extra.note).toBe("see https://app.hydlnk.com/share/[token]");
    expect(scrubbed.extra.jwt).toBe(FILTERED);
    expect(scrubbed.extra.token).toBe(FILTERED);
    expect(scrubbed.extra.nested.deeper[0]!.email).toBe("[email]");
    expect(scrubbed.extra.nested.deeper[0]!.code).toBe(FILTERED);
    expect(scrubbed.extra.nested.deeper[0]!.list).toEqual(["[email]", "/sites/[id]"]);
    expect(scrubbed.transaction).toBe("GET /t/[handle]");
    expect(scrubbed.contexts.nextjs.request_path).toBe("/t/[handle]");
    expect(scrubbed.contexts.nextjs.router_path).toBe("/t/[handle]");
  });

  it("the request keeps its method and its address without query string or fragment; cookies, headers, bodies and query strings are gone", () => {
    expect(scrubbed.request).toEqual({ url: "https://app.hydlnk.com/share/[token]", method: "GET" });
  });

  it("the user and the server name are removed", () => {
    expect("user" in scrubbed).toBe(false);
    expect("server_name" in scrubbed).toBe(false);
  });

  it("spans lose their query strings and their personal data", () => {
    expect(scrubbed.spans[0]!.description).toBe("GET https://x.supabase.co/rest/v1/pages");
    expect(scrubbed.spans[0]!.data).toEqual({ "url.full": "https://x.supabase.co/rest/v1/pages", "http.url": "https://x.supabase.co/a" });
    expect(scrubbed.spans[1]!.description).toBe("select * from accounts where email = '[email]'");
  });

  it("nothing personal is left anywhere in the serialized event", () => {
    for (const secret of ["gary@example.com", "gary%40", "mara.hydlnk.com", "/t/mara", "/sites/abc", "hunter2", "secret1", "tok-123", "oauth-code-9", "203.0.113.9", "eyJhbGci", "Zm9vYmFy", "Garys-MacBook", "base64-eyJ0", "/Users/gary", "sb-abc-auth-token=zzz", "username"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("the event it was given is not changed", () => {
    const original = richEvent();
    const copy = JSON.stringify(original);
    scrubEvent(original, { rootDomain: ROOT });
    expect(JSON.stringify(original)).toBe(copy);
  });

  it("is idempotent", () => {
    expect(scrubEvent(scrubbed, { rootDomain: ROOT })).toEqual(scrubbed);
  });

  it("an event with nothing personal comes out the same (apart from a request address losing its query)", () => {
    const plain = { message: "Something went wrong", level: "error", tags: { area: "editor" }, request: { url: "https://app.hydlnk.com/editor", method: "GET" } };
    expect(scrubEvent(plain, { rootDomain: ROOT })).toEqual(plain);
  });
});

describe("M9-10 breadcrumbs", () => {
  const beforeBreadcrumb = createBeforeBreadcrumb({ rootDomain: ROOT });

  it("console output is dropped", () => {
    expect(beforeBreadcrumb({ category: "console", message: "hello gary@example.com" })).toBeNull();
    expect(beforeBreadcrumb({ category: "console", level: "error" } as never)).toBeNull();
  });

  it("fetch and XHR breadcrumbs keep the path without a query", () => {
    for (const category of ["fetch", "xhr"]) {
      const out = beforeBreadcrumb({
        category,
        data: { url: "https://x.supabase.co/rest/v1/pages?handle=eq.mara&token=abc", method: "GET", status_code: 200 },
      })!;
      expect(out.data).toEqual({ url: "https://x.supabase.co/rest/v1/pages", method: "GET", status_code: 200 });
    }
    expect(beforeBreadcrumb({ category: "fetch", data: { url: "/app/api/pages?x=1#y" } })!.data).toEqual({ url: "/app/api/pages" });
  });

  it("navigation breadcrumbs keep both paths without a query and without a handle", () => {
    const out = beforeBreadcrumb({ category: "navigation", data: { from: "/t/mara?x=1", to: "/share/abc?code=1" } })!;
    expect(out.data).toEqual({ from: "/t/[handle]", to: "/share/[token]" });
  });

  it("any other breadcrumb is scrubbed, and a user's click text is not kept with an email", () => {
    const out = beforeBreadcrumb({ category: "ui.click", message: "button.save[gary@example.com]" })!;
    expect(out.message).toBe("button.save[[email]]");
    expect(beforeBreadcrumb({ category: "custom" })).toEqual({ category: "custom" });
  });
});

describe("M9-10 what the SDK hands over is not always plain data", () => {
  /** A stand-in for a Scope: a class instance whose members point back at their owner, several ways. */
  class FakeScope {
    parent: unknown;
    client: unknown;
    breadcrumbs: unknown[] = [];
    constructor(parent?: FakeScope) {
      this.parent = parent ?? null;
      this.client = { scope: this, integrations: [{ scope: this }], transport: { scope: this } };
      for (let i = 0; i < 50; i++) this.breadcrumbs.push({ owner: this, n: i, email: "gary@example.com" });
    }
  }

  it("a cycle in the event is cut, not followed, and the scrub finishes at once", () => {
    const event: Record<string, unknown> = { message: "boom for gary@example.com", extra: {} };
    const extra = event.extra as Record<string, unknown>;
    extra.self = extra;
    extra.event = event;
    extra.list = [extra, event];
    const started = Date.now();
    const out = scrubEvent(event, { rootDomain: ROOT }) as { message: string; extra: { self: unknown; event: unknown } };
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.message).toBe("boom for [email]");
    expect(out.extra.self).toBe("[Circular]");
    // The event reached again through `extra` is walked once more (the walk sets the SDK's own data aside
    // first, so it starts from a copy), and cut at the second visit of `extra`: bounded either way.
    expect(JSON.stringify(out.extra.event)).toBe('{"message":"boom for [email]","extra":"[Circular]"}');
  });

  it("sdkProcessingMetadata (live scopes, the request being read) is neither walked nor copied: it comes back as the same object", () => {
    const scope = new FakeScope(new FakeScope());
    const metadata = { capturedSpanScope: scope, capturedSpanIsolationScope: scope, normalizedRequest: { headers: { cookie: "sb-a=1" }, url: "https://app.hydlnk.com/editor?x=1" } };
    const event = { message: "gary@example.com", request: { url: "https://app.hydlnk.com/editor?x=1" }, sdkProcessingMetadata: metadata };
    const started = Date.now();
    const out = scrubEvent(event, { rootDomain: ROOT });
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.sdkProcessingMetadata).toBe(metadata);
    expect(out.message).toBe("[email]");
    expect(out.request.url).toBe("https://app.hydlnk.com/editor");
    // The input still has it too: nothing was removed from the caller's event.
    expect(event.sdkProcessingMetadata).toBe(metadata);
  });

  it("a class instance anywhere else in an event (a scope, a map) is not copied: it is named, and its data stays where it was", () => {
    const out = scrubEvent({ extra: { scope: new FakeScope(), when: new Date(0), map: new Map([["a", "gary@example.com"]]) } }, { rootDomain: ROOT }) as unknown as {
      extra: Record<string, string>;
    };
    expect(out.extra).toEqual({ scope: "[FakeScope]", when: "[Date]", map: "[Map]" });
    expect(JSON.stringify(out)).not.toContain("gary@example.com");
  });

  it("an Error inside an event keeps its name and its scrubbed message, nothing else", () => {
    const error = Object.assign(new Error("failed for gary@example.com"), { cause: new Error("x"), secret: "token-9" });
    const out = scrubEvent({ extra: { error } }, { rootDomain: ROOT }) as { extra: { error: unknown } };
    expect(out.extra.error).toEqual({ name: "Error", message: "failed for [email]" });
  });

  it("a wide, deep event is bounded: the walk stops at its node budget and says so", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 50_000; i++) wide[`k${i}`] = { v: "gary@example.com" };
    const started = Date.now();
    const out = scrubEvent({ extra: wide }, { rootDomain: ROOT });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(JSON.stringify(out)).toContain("[Truncated]");
    expect(JSON.stringify(out)).not.toContain("gary@example.com");
  });

  it("a very long string is cut and scrubbed in bounded time, even one that is a single run of address characters", () => {
    const blob = `${"a.b".repeat(400_000)}`;
    const started = Date.now();
    const out = scrubString(`${blob} gary@example.com`, { rootDomain: ROOT });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.endsWith("[Truncated]")).toBe(true);
    expect(out.length).toBeLessThan(9000);
    // A string under the limit is untouched by the cut.
    expect(scrubString(`${"x".repeat(7000)} gary@example.com`)).toBe(`${"x".repeat(7000)} [email]`);
  });

  it("a deep chain stops at the depth limit", () => {
    let chain: Record<string, unknown> = { leaf: "gary@example.com" };
    for (let i = 0; i < 200; i++) chain = { next: chain };
    const out = JSON.stringify(scrubEvent({ extra: chain }, { rootDomain: ROOT }));
    expect(out).toContain("[Truncated]");
    expect(out).not.toContain("gary@example.com");
  });
});
