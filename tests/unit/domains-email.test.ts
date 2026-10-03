import { describe, expect, it, vi } from "vitest";
import { emailTransportKind, sendDomainLiveEmail } from "@/lib/domains/email";
import { liveEmailContent } from "@/lib/domains/live-email";

/** M5-23: the words of the email and how it is sent (SMTP in production, Mailpit locally, skipped otherwise). */

describe("M5-23 the email", () => {
  const content = liveEmailContent("links.example.test");

  it("subject, body sentence and the one link", () => {
    expect(content.subject).toBe("links.example.test is live");
    expect(content.text).toContain("Your page is now served at https://links.example.test.");
    expect(content.html).toContain("Your page is now served at https://links.example.test.");
    expect(content.text).toContain("Open links.example.test: https://links.example.test/");
    const links = [...content.html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)];
    expect(links).toHaveLength(1);
    expect(links[0]![1]).toBe("https://links.example.test/");
    expect(links[0]![2]).toBe("Open links.example.test");
  });

  it("has an HTML and a plain-text part and no exclamation marks", () => {
    expect(content.html).toMatch(/^<!doctype html>/);
    expect(content.text.length).toBeGreaterThan(20);
    // The words, not the markup: <!doctype html> is not copy.
    const visible = content.html.replace(/<[^>]*>/g, "");
    for (const part of [content.subject, content.text, visible]) expect(part).not.toContain("!");
  });

  it("escapes what it embeds", () => {
    const evil = liveEmailContent('x"><script>alert(1)</script>.example.test');
    expect(evil.html).not.toContain("<script>");
  });
});

describe("M5-23 transport", () => {
  it("SMTP when SMTP_HOST is set, Mailpit locally, skip on any deployment", () => {
    expect(emailTransportKind({ SMTP_HOST: "smtp.example.test" })).toBe("smtp");
    expect(emailTransportKind({ SMTP_HOST: "smtp.example.test", VERCEL_ENV: "production" })).toBe("smtp");
    expect(emailTransportKind({})).toBe("mailpit");
    expect(emailTransportKind({ NODE_ENV: "development" })).toBe("mailpit");
    expect(emailTransportKind({ VERCEL_ENV: "production" })).toBe("skip");
    expect(emailTransportKind({ VERCEL_ENV: "preview" })).toBe("skip");
    expect(emailTransportKind({ NODE_ENV: "production" })).toBe("skip");
  });

  it("unset in production: skipped and logged, nothing sent, nothing thrown, no address in the log", async () => {
    const fetchImpl = vi.fn();
    const createTransport = vi.fn();
    const log = vi.fn();
    const result = await sendDomainLiveEmail(
      { to: "owner@example.test", hostname: "links.example.test" },
      { VERCEL_ENV: "production" },
      { fetchImpl: fetchImpl as never, createTransport: createTransport as never, log },
    );
    expect(result).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).not.toContain("owner@example.test");
  });

  it("SMTP: sends both parts from EMAIL_FROM through the configured host", async () => {
    const sendMail = vi.fn(async () => ({}));
    const createTransport = vi.fn(() => ({ sendMail }));
    const result = await sendDomainLiveEmail(
      { to: "owner@example.test", hostname: "links.example.test" },
      { SMTP_HOST: "smtp.example.test", SMTP_PORT: "465", SMTP_USER: "u", SMTP_PASS: "p", EMAIL_FROM: "HYDLNK <hello@hydlnk.com>" },
      { createTransport: createTransport as never },
    );
    expect(result).toBe("sent");
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.test", port: 465, secure: true, auth: { user: "u", pass: "p" } }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "HYDLNK <hello@hydlnk.com>",
        to: "owner@example.test",
        subject: "links.example.test is live",
        text: expect.stringContaining("https://links.example.test"),
        html: expect.stringContaining("<a "),
      }),
    );
  });

  it("SMTP without a login or a port uses 587 and no auth", async () => {
    const createTransport = vi.fn(() => ({ sendMail: async () => ({}) }));
    await sendDomainLiveEmail(
      { to: "o@example.test", hostname: "links.example.test" },
      { SMTP_HOST: "smtp.example.test", EMAIL_FROM: "a@b.test" },
      { createTransport: createTransport as never },
    );
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false, auth: undefined }));
  });

  it("an SMTP error rejects (the verifier logs it and carries on)", async () => {
    const createTransport = vi.fn(() => ({ sendMail: async () => Promise.reject(new Error("smtp down")) }));
    await expect(
      sendDomainLiveEmail(
        { to: "o@example.test", hostname: "links.example.test" },
        { SMTP_HOST: "smtp.example.test", EMAIL_FROM: "a@b.test" },
        { createTransport: createTransport as never },
      ),
    ).rejects.toThrow("smtp down");
  });

  it("local: posts to Mailpit's send API with both parts", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await sendDomainLiveEmail(
      { to: "owner@example.test", hostname: "links.example.test" },
      { MAILPIT_URL: "http://mailpit.test:8025/" },
      { fetchImpl: fetchImpl as never },
    );
    expect(result).toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://mailpit.test:8025/api/v1/send");
    const body = JSON.parse(String(init.body));
    expect(body.To).toEqual([{ Email: "owner@example.test" }]);
    expect(body.Subject).toBe("links.example.test is live");
    expect(body.Text).toContain("https://links.example.test");
    expect(body.HTML).toContain("Open links.example.test");
  });

  it("local: a refused message rejects", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(
      sendDomainLiveEmail({ to: "o@example.test", hostname: "links.example.test" }, {}, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/Mailpit refused/);
  });
});
