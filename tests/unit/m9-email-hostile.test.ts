import { createElement } from "react";
import { render } from "react-email";
import { describe, expect, it, vi } from "vitest";
import { DomainLive } from "@/emails/domain-live";
import { isStoredHostname, sendDomainLiveEmail } from "@/lib/domains/email";

/**
 * M9-09 hostile input. `hostname` comes from a stored `domains.hostname` (lower case letters,
 * digits, hyphens and dots); anything else is refused before rendering, sends nothing, and logs one
 * line without the value. The component itself also escapes whatever it is handed.
 */

const HOSTILE = [
  '"><script>alert(1)</script>.example',
  "a b.example.test",
  "line\nbreak.example.test",
  "carriage\r.example.test",
  "Upper.Example.Test",
  `${"a".repeat(250)}.test`,
  `${"a.".repeat(130)}test`,
  "x.example.test/path",
  "x.example.test:8080",
  "user@example.test",
  "ex_ample.example.test",
  "<b>x</b>.example.test",
  "x.example.test\0",
  "",
  "nodots",
  "-lead.example.test",
  "x.example.test.",
  "bücher.example.test",
];

describe("M9-09 a hostname that is not a stored hostname is refused before rendering", () => {
  it("isStoredHostname accepts the stored shape and nothing else", () => {
    for (const ok of ["links.example.test", "a-b.example.co.uk", "xn--bcher-kva.example.test", "zq-ready-ab12cd.example.test"]) {
      expect(isStoredHostname(ok), ok).toBe(true);
    }
    for (const bad of HOSTILE) expect(isStoredHostname(bad), JSON.stringify(bad)).toBe(false);
    expect(isStoredHostname(undefined)).toBe(false);
    expect(isStoredHostname(42)).toBe(false);
  });

  it.each(HOSTILE.map((value) => [JSON.stringify(value).slice(0, 40), value] as const))(
    "%s: no email goes out on any transport, one log line, no value in it, no throw",
    async (_label, hostname) => {
      for (const env of [{ SMTP_HOST: "smtp.example.test", EMAIL_FROM: "a@b.test" }, {}, { VERCEL_ENV: "production" }]) {
        const fetchImpl = vi.fn();
        const sendMail = vi.fn();
        const createTransport = vi.fn(() => ({ sendMail }));
        const log = vi.fn();
        const result = await sendDomainLiveEmail(
          { to: "owner@example.test", hostname },
          env,
          { fetchImpl: fetchImpl as never, createTransport: createTransport as never, log },
        );
        expect(result).toBe("refused");
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(createTransport).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledTimes(1);
        const line = String(log.mock.calls[0]![0]);
        expect(line).not.toContain("owner@example.test");
        if (hostname.length > 2) expect(line).not.toContain(hostname);
        expect(line).not.toMatch(/[\r\n\0]/);
      }
    },
  );

  it("a refused hostname is not a failure of the verification: the sender resolves (the caller carries on)", async () => {
    await expect(
      sendDomainLiveEmail({ to: "o@example.test", hostname: '"><script>alert(1)</script>.example' }, {}, { log: () => {} }),
    ).resolves.toBe("refused");
  });

  it("a valid hostname still goes out", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(
      sendDomainLiveEmail({ to: "o@example.test", hostname: "links.example.test" }, {}, { fetchImpl: fetchImpl as never }),
    ).resolves.toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/** The tag names of an HTML string, in order, with their counts. */
const tags = (html: string): Record<string, number> => {
  const found: Record<string, number> = {};
  for (const match of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<([a-z][a-z0-9]*)/gi)) {
    const name = match[1]!.toLowerCase();
    found[name] = (found[name] ?? 0) + 1;
  }
  return found;
};

describe("M9-09 the component escapes everything it is handed", () => {
  const NEAREST = [
    'x"><script>alert(1)</script>.example.test',
    'a.example.test" onmouseover="alert(1)',
    "a.example.test'><img src=x onerror=alert(1)>",
    "a&b<c>d.example.test",
    "</a><a href=https://evil.example>x</a>.example.test",
    "javascript:alert(1)//.example.test",
  ];

  it("every special character is escaped and no element is added", async () => {
    const benign = await render(createElement(DomainLive, { hostname: "links.example.test" }));
    const expected = tags(benign);
    for (const hostname of NEAREST) {
      const html = await render(createElement(DomainLive, { hostname }));
      // The same elements as for a benign hostname: nothing the input says became markup.
      expect(tags(html), hostname).toEqual(expected);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      // The raw hostile characters appear nowhere unescaped.
      expect(html.replace(/<!--[\s\S]*?-->/g, "").match(/<a\s[^>]*>/g)).toHaveLength(1);
      for (const [raw, escaped] of [["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"]] as const) {
        if (hostname.includes(raw)) expect(html, `${raw} in ${hostname}`).toContain(escaped);
      }
      // The attribute is still one attribute: no second attribute was injected into the anchor.
      const anchor = html.match(/<a\s[^>]*>/)![0]!;
      expect([...anchor.matchAll(/\s([\w-]+)="[^"]*"/g)].map((m) => m[1])).toEqual(["href", "style", "target"]);
      expect(/ href="([^"]*)"/.exec(anchor)![1]!.startsWith("https://")).toBe(true);
    }
  });

  it("the plain-text part is the template's words around the value, as text (nothing is parsed)", async () => {
    const hostname = 'x"><script>alert(1)</script>.example.test';
    const text = await render(createElement(DomainLive, { hostname }), { plainText: true });
    expect(text).toBe(`Your site is now served at https://${hostname}.\n\nOpen ${hostname} https://${hostname}/`);
  });
});
