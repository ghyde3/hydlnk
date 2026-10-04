import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  VCARD_PROPERTIES,
  escapeText,
  foldLine,
  unfoldVcard,
  vcardFilename,
  vcardFor,
  vcardSlug,
} from "@/lib/contact/vcard";
import {
  TOO_MANY_DOWNLOADS_MESSAGE,
  VCARD_LIMIT,
  handleVcard,
  vcardMethodNotAllowed,
  type ContactCard,
  type VcardDeps,
} from "@/lib/analytics/ingest/vcard";

/**
 * M9-18: the vCard of a contact block (pure function) and the handler behind GET /c/<pageId>/<blockId>
 * (dependencies are spies, so the order of the steps and what is recorded are what is proven).
 */

const PAGE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const BLOCK = "contact-blk-0001";
const URL_ = "http://mara.localhost:3000/";

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const card = (extra: Partial<ContactCard> = {}): ContactCard => ({
  name: "Mara Okafor",
  phone: "+1 (555) 123-4567",
  email: "hello@maraokafor.com",
  hours: "Mon to Fri, 9am to 5pm",
  pageUrl: URL_,
  handle: "mara",
  customHosts: [],
  ...extra,
});

describe("M9-18 vcardFor", () => {
  it("is vCard 3.0 with CRLF line endings and exactly the documented properties", () => {
    const text = vcardFor(card(), URL_);
    expect(text).toBe(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Mara Okafor",
        "N:Okafor;Mara;;;",
        "TEL;TYPE=VOICE:+15551234567",
        "EMAIL;TYPE=INTERNET:hello@maraokafor.com",
        "URL:http://mara.localhost:3000/",
        "NOTE:Mon to Fri\\, 9am to 5pm",
        "END:VCARD",
        "",
      ].join("\r\n"),
    );
    expect(
      text.split("\n").every((line, i, all) => i === all.length - 1 || line.endsWith("\r")),
    ).toBe(true);
  });

  it("leaves out TEL, EMAIL and NOTE when there is none, and holds no photo", () => {
    const text = vcardFor({ name: "Mara", phone: "", email: "a@b.example", hours: "" }, URL_);
    const names = unfoldVcard(text).map((line) => line.split(/[:;]/, 1)[0]);
    expect(names).toEqual(["BEGIN", "VERSION", "FN", "N", "EMAIL", "URL", "END"]);
    expect(text).not.toMatch(/PHOTO|LOGO|ORG|ADR/);
  });

  it("N: the last word is the family name, the rest are the given names; one word goes in the family slot", () => {
    const n = (name: string) =>
      unfoldVcard(vcardFor({ name }, URL_)).find((line) => line.startsWith("N:"));
    expect(n("Mara Okafor")).toBe("N:Okafor;Mara;;;");
    expect(n("Mary Jane Watson")).toBe("N:Watson;Mary Jane;;;");
    expect(n("Cher")).toBe("N:Cher;;;;");
    expect(n("  Ada   Lovelace  ")).toBe("N:Lovelace;Ada;;;");
  });

  it("a semicolon in the name stays inside its N: component: exactly five components, never more", () => {
    const n = (name: string) =>
      unfoldVcard(vcardFor({ name }, URL_)).find((line) => line.startsWith("N:"))!;
    // Components are split on a ';' that is not escaped with a backslash.
    const components = (line: string) => line.slice(2).split(/(?<!\\);/);
    for (const name of ["Jane Doe;Dr.;;", "Jane;Dr. Doe", ";;;;;", "Mara; Okafor", "A;B C;D;E;F"]) {
      const line = n(name);
      expect(components(line), name).toHaveLength(5);
      // The whole of what was typed is still in the card, only escaped.
      expect(line, name).toContain("\\;");
    }
    expect(n("Jane Doe;Dr.;;")).toBe("N:Doe\\;Dr.\\;\\;;Jane;;;");
    // And in FN and NOTE every semicolon is escaped, so the value is one value.
    const lines = unfoldVcard(vcardFor({ name: "Jane;Doe", phone: "5551234", hours: "a;b" }, URL_));
    expect(lines).toContain("FN:Jane\\;Doe");
    expect(lines).toContain("NOTE:a\\;b");
  });

  it("escapes backslash, comma, semicolon and line breaks inside values", () => {
    expect(escapeText("a\\b,c;d\ne")).toBe("a\\\\b\\,c\\;d\\ne");
    // A semicolon becomes a backslash and a semicolon: two characters, not the bare one.
    expect(escapeText(";")).toBe("\\;");
    expect(escapeText(";")).toHaveLength(2);
    const text = vcardFor({ name: "A;B,C", phone: "5551234", hours: "a;b,c\\d\nline two" }, URL_);
    const lines = unfoldVcard(text);
    expect(lines).toContain("FN:A\\;B\\,C");
    expect(lines).toContain("NOTE:a\\;b\\,c\\\\d\\nline two");
  });

  it("removes control and bidi characters, and turns CRLF in hours into one escaped line break", () => {
    const text = vcardFor(
      { name: "Ma\u0007ra ‮Okafor⁦", phone: "5551234", hours: "a\r\nb\rc\u0001d" },
      URL_,
    );
    const lines = unfoldVcard(text);
    expect(lines).toContain("FN:Mara Okafor");
    expect(lines).toContain("NOTE:a\\nb\\ncd");
    expect(text).not.toMatch(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
  });

  it("a name that tries to start a second card produces one BEGIN, one END and only the allowed property names", () => {
    const text = vcardFor(
      {
        name: "Mara\r\nTEL:+1999\r\nEND:VCARD\r\nBEGIN:VCARD",
        phone: "5551234",
        email: "a@b.example",
        hours: "a;b,c\\d\r\nTEL:+1888\r\nEND:VCARD",
      },
      URL_,
    );
    const lines = unfoldVcard(text);
    expect(lines.filter((line) => line === "BEGIN:VCARD")).toHaveLength(1);
    expect(lines.filter((line) => line === "END:VCARD")).toHaveLength(1);
    const names = lines.map((line) => line.split(/[:;]/, 1)[0]!);
    for (const name of names) expect(VCARD_PROPERTIES as readonly string[]).toContain(name);
    expect(names.filter((name) => name === "TEL")).toHaveLength(1);
    expect(lines.find((line) => line.startsWith("TEL"))).toBe("TEL;TYPE=VOICE:5551234");
    expect(lines.find((line) => line.startsWith("NOTE:"))).toBe(
      "NOTE:a\\;b\\,c\\\\d\\nTEL:+1888\\nEND:VCARD",
    );
  });

  it("a 300-character hours value folds at 75 octets and unfolds to the original", () => {
    const hours = "0123456789".repeat(30);
    const text = vcardFor({ name: "Mara", phone: "5551234", hours }, URL_);
    for (const physical of text.split("\r\n")) {
      expect(Buffer.byteLength(physical)).toBeLessThanOrEqual(75);
    }
    expect(text).toContain("\r\n ");
    expect(unfoldVcard(text).find((line) => line.startsWith("NOTE:"))).toBe(`NOTE:${hours}`);
  });

  it("folds on character boundaries: multi-byte text is never split, and unfolding gives it back", () => {
    const hours = "é漢😀".repeat(40);
    const text = vcardFor({ name: "Mara", phone: "5551234", hours }, URL_);
    for (const physical of text.split("\r\n"))
      expect(Buffer.byteLength(physical)).toBeLessThanOrEqual(75);
    expect(Buffer.from(text, "utf8").toString("utf8")).toBe(text);
    expect(unfoldVcard(text).find((line) => line.startsWith("NOTE:"))).toBe(`NOTE:${hours}`);
    expect(foldLine("short")).toBe("short");
  });

  it("TEL is built from the phone's digits and a leading +, never from the raw string", () => {
    for (const phone of ["+1 (555) 123-4567", "555.123.4567", "5551234"]) {
      const tel = unfoldVcard(vcardFor({ name: "M", phone }, URL_)).find((line) =>
        line.startsWith("TEL"),
      )!;
      expect(tel).toMatch(/^TEL;TYPE=VOICE:\+?\d{7,15}$/);
    }
    const bad = unfoldVcard(vcardFor({ name: "M", phone: "javascript:alert(1)" }, URL_));
    expect(bad.some((line) => line.startsWith("TEL"))).toBe(false);
  });
});

describe("M9-18 the file name", () => {
  it.each([
    ["Mara Okafor", "mara-okafor"],
    ["  José Álvarez  ", "jose-alvarez"],
    ['A"B;C/D\\E', "a-b-c-d-e"],
    ["../../etc/passwd", "etc-passwd"],
    ["漢字", "contact"],
    ["", "contact"],
    ["!!!", "contact"],
    ["x".repeat(80), "x".repeat(40)],
    ["a".repeat(39) + " b", "a".repeat(39)],
  ])("%j gives %j", (name, slug) => {
    expect(vcardSlug(name)).toBe(slug);
    expect(vcardFilename(name)).toBe(`${slug}.vcf`);
  });

  it("never holds a quote, a semicolon, a space, a path separator or a non-ASCII character", () => {
    for (const name of ['a"b', "a;b", "a b", "a/b", "a\\b", "é", "😀", "a\r\nb", "<b>"]) {
      expect(vcardSlug(name)).toMatch(/^[a-z0-9-]{1,40}$/);
    }
  });
});

// The handler ------------------------------------------------------------------------------------

function deps(over: Partial<VcardDeps> = {}) {
  const inserted: unknown[] = [];
  const scheduled: (() => Promise<void>)[] = [];
  const d: VcardDeps = {
    rateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
    now: () => new Date("2026-10-05T12:00:00Z"),
    visitorHash: () => "hash",
    insertEvent: vi.fn(async (row) => {
      inserted.push(row);
    }),
    schedule: (task) => {
      scheduled.push(task);
    },
    rootDomain: "localhost:3000",
    resolveContactCard: vi.fn(async () => card()),
    homeHref: "http://localhost:3000/",
    ...over,
  };
  return { d, inserted, flush: async () => Promise.all(scheduled.map((task) => task())) };
}

const req = (
  init: { method?: string; headers?: Record<string, string> } = {},
  path = `/c/${PAGE}/${BLOCK}`,
) =>
  new Request(`http://mara.localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: { host: "mara.localhost:3000", "user-agent": SAFARI, ...init.headers },
  });
const run = (request: Request, d: VcardDeps) =>
  handleVcard(request, { pageId: PAGE, blockId: BLOCK }, d);

describe("M9-18 the answer", () => {
  it("200, text/vcard, an attachment named after the person, and the hardening headers", async () => {
    const { d } = deps();
    const res = await run(req(), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="mara-okafor.vcf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe(vcardFor(card(), URL_));
  });

  it("the body and the headers come from the stored fields and nothing the request carries", async () => {
    const baseline = await run(req(), deps().d);
    const text = await baseline.text();
    const variants = [
      req({}, `/c/${PAGE}/${BLOCK}?name=Evil&download=x.exe&FN=x`),
      req({
        headers: { referer: "https://evil.example/?name=Evil", cookie: "name=Evil; session=1" },
      }),
      req({ headers: { "x-forwarded-host": "evil.example", origin: "https://evil.example" } }),
      req({ headers: { "accept-language": "ja", "user-agent": "curl/8" } }),
    ];
    for (const variant of variants) {
      const res = await run(variant, deps().d);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(text);
      expect([...res.headers].sort()).toEqual([...baseline.headers].sort());
    }
  });

  it("HEAD answers the same status and headers with no body, and records nothing", async () => {
    const { d, flush, inserted } = deps();
    const res = await run(req({ method: "HEAD" }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vcard; charset=utf-8");
    expect(await res.text()).toBe("");
    await flush();
    expect(inserted).toEqual([]);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "%s answers 405 with Allow: GET, HEAD, before any lookup",
    async (method) => {
      const { d } = deps();
      const res = await run(req({ method }), d);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
      expect(d.rateLimit).not.toHaveBeenCalled();
      expect(d.resolveContactCard).not.toHaveBeenCalled();
      expect(vcardMethodNotAllowed().status).toBe(405);
    },
  );
});

describe("M9-18 what is not served", () => {
  it.each([
    ["a bad page id", "not-a-uuid", BLOCK],
    ["a bad block id", PAGE, "bad id!"],
    ["a block id of 65 characters", PAGE, "x".repeat(65)],
  ])(
    "%s: the notice page (404, no-store), no lookup and no row",
    async (_name, pageId, blockId) => {
      const { d, flush, inserted } = deps();
      const res = await handleVcard(req(), { pageId, blockId }, d);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toContain("Go to hydlnk.com");
      expect(d.resolveContactCard).not.toHaveBeenCalled();
      await flush();
      expect(inserted).toEqual([]);
    },
  );

  it("an id with no visible contact block (draft only, hidden, another type, another page, unpublished) is the notice and records nothing", async () => {
    const { d, flush, inserted } = deps({ resolveContactCard: vi.fn(async () => null) });
    const res = await run(req(), d);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.text()).not.toContain("BEGIN:VCARD");
    await flush();
    expect(inserted).toEqual([]);
  });

  it("another host is the 404, whatever the page is: the real Host header, never X-Forwarded-Host", async () => {
    const hostile: Record<string, string>[] = [
      { host: "other.localhost:3000" },
      { host: "localhost:3000" },
      { host: "app.localhost:3000" },
      { host: "evil.example", "x-forwarded-host": "mara.localhost:3000" },
    ];
    for (const headers of hostile) {
      const { d } = deps();
      const res = await run(req({ headers }), d);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("BEGIN:VCARD");
    }
  });

  it("a verified custom host of the page serves it, and so does the handle host", async () => {
    const custom = deps({
      resolveContactCard: vi.fn(async () =>
        card({ customHosts: ["links.mara.example"], pageUrl: "https://links.mara.example/" }),
      ),
    });
    const res = await run(req({ headers: { host: "links.mara.example" } }), custom.d);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("URL:https://links.mara.example/\r\n");
    expect((await run(req(), custom.d)).status).toBe(200);
  });

  it("a database failure is a 503 notice, never a 404 and never a card", async () => {
    const { d } = deps({
      resolveContactCard: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await run(req(), d);
    spy.mockRestore();
    expect(res.status).toBe(503);
  });
});

describe("M9-18 the limiter", () => {
  it("allows 30 downloads a minute per client, then 429 with Retry-After and the notice page", async () => {
    const { d } = deps({ rateLimit: vi.fn(async () => ({ allowed: false, retryAfter: 42 })) });
    const res = await run(req(), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(await res.text()).toContain(TOO_MANY_DOWNLOADS_MESSAGE);
    expect(d.resolveContactCard).not.toHaveBeenCalled();
    expect(d.rateLimit).toHaveBeenCalledWith(expect.stringMatching(/^vcard:/), VCARD_LIMIT, 60);
    expect(VCARD_LIMIT).toBe(30);
  });

  it("a limiter that throws lets the request through (a vCard is public data)", async () => {
    const { d } = deps({
      rateLimit: vi.fn(async () => {
        throw new Error("store down");
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await run(req(), d);
    spy.mockRestore();
    expect(res.status).toBe(200);
  });

  it("the client key is the connecting client, never a header a visitor can pick", async () => {
    const { d } = deps();
    await run(req({ headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }), d);
    expect(d.rateLimit).toHaveBeenCalledWith("vcard:203.0.113.7", 30, 60);
  });
});

describe("M9-18 counting", () => {
  const counted = async (headers: Record<string, string>, method = "GET") => {
    const { d, flush, inserted } = deps();
    const res = await run(req({ method, headers }), d);
    await flush();
    return { res, inserted };
  };

  it("a navigation records one click row under the contact block's id, after the response", async () => {
    const { d, flush, inserted } = deps();
    const res = await run(req(), d);
    expect(res.status).toBe(200);
    expect(inserted).toEqual([]);
    await flush();
    expect(inserted).toEqual([
      expect.objectContaining({ page_id: PAGE, block_id: BLOCK, type: "click", referrer: null }),
    ]);
  });

  it.each([
    [{}, 1],
    [{ "sec-fetch-dest": "document" }, 1],
    [{ "sec-fetch-dest": "empty" }, 1],
    [{ "sec-fetch-dest": "image" }, 0],
    [{ "sec-fetch-dest": "iframe" }, 0],
    [{ "sec-fetch-dest": "script" }, 0],
    [{ "user-agent": "Googlebot/2.1" }, 0],
    [{ "user-agent": "facebookexternalhit/1.1" }, 0],
  ])("%j records %i row(s) and still serves the card", async (headers, rows) => {
    const { res, inserted } = await counted(headers as Record<string, string>);
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(rows);
  });

  it("a failing insert never reaches the visitor", async () => {
    const { d, flush } = deps({
      insertEvent: vi.fn(async () => {
        throw new Error("insert failed");
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await run(req(), d);
    await expect(flush()).resolves.toBeDefined();
    spy.mockRestore();
    expect(res.status).toBe(200);
  });
});

describe("M9-18 the route files", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("is force-dynamic, so an invented path makes no cache entry; GET, HEAD and every other method are exported", () => {
    const route = read("src/app/c/[pageId]/[blockId]/route.ts");
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    for (const method of ["GET", "HEAD"])
      expect(route).toMatch(new RegExp(`export async function ${method}\\(`));
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(route).toMatch(new RegExp(`export const ${method} = `));
    }
    expect(route).not.toMatch(/force-static|generateStaticParams|revalidate/);
  });

  it("lives at the app's root next to /r, not under the tenant routes (a Vitest scan forbids a catch-all there)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    const tenant = walk(join(process.cwd(), "src/app/(tenant)")).map((file) =>
      file.replace(process.cwd(), ""),
    );
    expect(tenant.filter((file) => /\[c\]|\/c\//.test(file))).toEqual([]);
  });

  it("the page's own hosts pass /c/ through and nothing else (isTrackingPath)", async () => {
    const { isTrackingPath } = await import("@/lib/routing/paths");
    expect(isTrackingPath(`/c/${PAGE}/${BLOCK}`)).toBe(true);
    expect(isTrackingPath("/r/x/y")).toBe(true);
    expect(isTrackingPath("/api/e")).toBe(true);
    for (const path of ["/c", "/contact", "/cc/x/y", "/x/c/y", "/", "/og"]) {
      expect(isTrackingPath(path), path).toBe(false);
    }
  });
});
