import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Supabase Auth email templates (supabase/templates/*.html), wired for local dev in
 * supabase/config.toml and applied by hand in the Supabase dashboard for production.
 *
 * HYDLNK sign-in is passwordless, so only `confirmation` and `magic_link` carry a working sign-in
 * link (the token-hash callback). Everything else either points at /login or /signup, or carries a
 * link the callback rejects on purpose (`email_change`). These tests keep all templates on one
 * skeleton, on the design tokens, and inside the copy rules in docs/DESIGN.md.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TEMPLATES_DIR = `${ROOT}supabase/templates/`;
const read = (path: string) => readFileSync(path, "utf8");

const SITE = "{{ .SiteURL }}";
const CALLBACK = (type: string) =>
  `${SITE}/auth/callback?token_hash={{ .TokenHash }}&amp;type=${type}`;
const IGNORE = "If you didn’t ask for this, ignore this email.";
const THIS_WAS_YOU = "If this was you, ignore this email.";
const NOT_YOU = "If this wasn’t you, sign in and check your account.";

/** Every variable Supabase documents for these templates; a template may use only its own subset. */
type Variable =
  | "SiteURL"
  | "TokenHash"
  | "Token"
  | "Email"
  | "NewEmail"
  | "OldEmail"
  | "Phone"
  | "OldPhone"
  | "Provider"
  | "FactorType";

interface Anchor {
  href: string;
  text: string;
}

interface Spec {
  /** Name in the Supabase dashboard (Authentication > Emails). */
  dashboard: string;
  file: string;
  /** auth.email.template.<key> or auth.email.notification.<key> in config.toml. */
  section: `auth.email.template.${string}` | `auth.email.notification.${string}`;
  subject: string;
  variables: readonly Variable[];
  /** Every <a>, in order. The first one is the button when `button` is true. */
  anchors: Anchor[];
  button: boolean;
  /** Text that must appear in the final (footer) cell. */
  footer: string;
}

const LOGIN: Anchor = { href: `${SITE}/login`, text: "Check your account" };

const TEMPLATES: Spec[] = [
  {
    dashboard: "Confirm sign up",
    file: "confirmation.html",
    section: "auth.email.template.confirmation",
    subject: "Confirm your email for HYDLNK",
    variables: ["SiteURL", "TokenHash"],
    anchors: [{ href: CALLBACK("email"), text: "Confirm and sign in" }],
    button: true,
    footer: IGNORE,
  },
  {
    dashboard: "Magic link",
    file: "magic-link.html",
    section: "auth.email.template.magic_link",
    subject: "Your HYDLNK sign-in link",
    variables: ["SiteURL", "TokenHash"],
    anchors: [{ href: CALLBACK("email"), text: "Sign in to HYDLNK" }],
    button: true,
    footer: IGNORE,
  },
  {
    dashboard: "Change email address",
    file: "email-change.html",
    section: "auth.email.template.email_change",
    subject: "Confirm your new email for HYDLNK",
    variables: ["SiteURL", "TokenHash", "Email", "NewEmail"],
    anchors: [
      { href: CALLBACK("email_change"), text: "Confirm new email" },
      { href: `${SITE}/login`, text: "sign in" },
    ],
    button: true,
    footer: "If you didn’t ask for this,",
  },
  {
    dashboard: "Reset password",
    file: "recovery.html",
    section: "auth.email.template.recovery",
    subject: "Signing in to HYDLNK",
    variables: ["SiteURL"],
    anchors: [{ href: `${SITE}/login`, text: "Request a sign-in link" }],
    button: true,
    footer: IGNORE,
  },
  {
    dashboard: "Invite user",
    file: "invite.html",
    section: "auth.email.template.invite",
    subject: "You're invited to HYDLNK",
    variables: ["SiteURL"],
    anchors: [{ href: `${SITE}/signup`, text: "Create your page" }],
    button: true,
    footer: IGNORE,
  },
  {
    dashboard: "Reauthentication",
    file: "reauthentication.html",
    section: "auth.email.template.reauthentication",
    subject: "Your HYDLNK verification code",
    variables: ["Token"],
    anchors: [],
    button: false,
    footer: IGNORE,
  },
  {
    dashboard: "Password changed",
    file: "notification-password-changed.html",
    section: "auth.email.notification.password_changed",
    subject: "Your HYDLNK password was changed",
    variables: ["SiteURL"],
    anchors: [LOGIN],
    button: true,
    footer: THIS_WAS_YOU,
  },
  {
    dashboard: "Email address changed",
    file: "notification-email-changed.html",
    section: "auth.email.notification.email_changed",
    subject: "Your HYDLNK email was changed",
    variables: ["SiteURL", "OldEmail", "Email"],
    anchors: [LOGIN],
    button: true,
    footer: THIS_WAS_YOU,
  },
  {
    dashboard: "Phone number changed",
    file: "notification-phone-changed.html",
    section: "auth.email.notification.phone_changed",
    subject: "Your HYDLNK phone number was changed",
    variables: ["SiteURL", "OldPhone", "Phone"],
    anchors: [LOGIN],
    button: true,
    footer: THIS_WAS_YOU,
  },
  {
    dashboard: "Sign-in method linked",
    file: "notification-identity-linked.html",
    section: "auth.email.notification.identity_linked",
    subject: "A sign-in method was linked to your HYDLNK account",
    variables: ["SiteURL", "Provider", "Email"],
    anchors: [LOGIN],
    button: true,
    footer: THIS_WAS_YOU,
  },
  {
    dashboard: "Sign-in method removed",
    file: "notification-identity-unlinked.html",
    section: "auth.email.notification.identity_unlinked",
    subject: "A sign-in method was removed from your HYDLNK account",
    variables: ["SiteURL", "Provider", "Email"],
    anchors: [LOGIN],
    button: true,
    footer: THIS_WAS_YOU,
  },
  {
    dashboard: "Verification method added",
    file: "notification-mfa-enrolled.html",
    section: "auth.email.notification.mfa_factor_enrolled",
    subject: "A verification method was added to your HYDLNK account",
    variables: ["SiteURL", "FactorType"],
    anchors: [LOGIN],
    button: true,
    footer: THIS_WAS_YOU,
  },
  {
    dashboard: "Verification method removed",
    file: "notification-mfa-unenrolled.html",
    section: "auth.email.notification.mfa_factor_unenrolled",
    subject: "A verification method was removed from your HYDLNK account",
    variables: ["SiteURL", "FactorType"],
    anchors: [LOGIN],
    button: true,
    footer: THIS_WAS_YOU,
  },
];

const NOTIFICATIONS = TEMPLATES.filter((t) => t.section.startsWith("auth.email.notification."));

// --- helpers ----------------------------------------------------------------------------------

/** Just enough TOML for config.toml: `[a.b]` headers and `key = "string" | true | false` lines. */
function parseSections(toml: string): Map<string, Record<string, string | boolean>> {
  const sections = new Map<string, Record<string, string | boolean>>();
  let current: Record<string, string | boolean> | undefined;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[([\w.]+)\]$/.exec(line);
    if (header) {
      current = {};
      sections.set(header[1]!, current);
      continue;
    }
    const pair = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (pair && current) {
      const value = pair[2]!.trim();
      current[pair[1]!] =
        value === "true"
          ? true
          : value === "false"
            ? false
            : (/^"(.*)"$/.exec(value)?.[1] ?? value);
    }
  }
  return sections;
}

const html = new Map(TEMPLATES.map((t) => [t.file, read(`${TEMPLATES_DIR}${t.file}`)]));
const source = (spec: Spec) => html.get(spec.file)!;
const withoutDoctype = (s: string) => s.replace(/<!doctype[^>]*>/i, "");

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&rarr;": "→",
  "&amp;": "&",
  "&#9670;": "◆",
};
/** The text a reader sees: head, hidden preheader and tags dropped, entities decoded. */
function visibleText(s: string): string {
  return withoutDoctype(s)
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<div style="display:none[^"]*">[\s\S]*?<\/div>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

const variablesIn = (s: string) => [...s.matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1]!.trim());
const anchorsIn = (s: string): Anchor[] =>
  [...s.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1]!,
    text: m[2]!.replace(/<[^>]+>/g, "").trim(),
  }));
const lastCell = (s: string) => {
  const cells = [...s.matchAll(/<td\s[^>]*>([\s\S]*?)<\/td>/g)];
  return cells[cells.length - 1]![0];
};

/** "Sentence case": first letter capital, every later word lowercase except HYDLNK. */
const isSentenceCase = (text: string) =>
  /^[A-Z]/.test(text) &&
  text
    .split(/\s+/)
    .slice(1)
    .every((word) => word === "HYDLNK" || !/^[A-Z]/.test(word));

// --- the set --------------------------------------------------------------------------------

describe("email templates: the set", () => {
  it("has a spec for every file in supabase/templates and a file for every spec", () => {
    const onDisk = readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith(".html"))
      .sort();
    expect(onDisk).toEqual(TEMPLATES.map((t) => t.file).sort());
  });

  it("covers the six Auth templates and the seven security notifications", () => {
    expect(TEMPLATES.filter((t) => !NOTIFICATIONS.includes(t)).map((t) => t.dashboard)).toEqual([
      "Confirm sign up",
      "Magic link",
      "Change email address",
      "Reset password",
      "Invite user",
      "Reauthentication",
    ]);
    expect(NOTIFICATIONS).toHaveLength(7);
  });
});

// --- each template --------------------------------------------------------------------------

describe.each(TEMPLATES)("$file ($dashboard)", (spec) => {
  const doc = source(spec);
  const visible = visibleText(doc);

  it("is a complete, balanced HTML document with the subject as its title", () => {
    expect(doc.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(doc.trimEnd().endsWith("</html>")).toBe(true);
    expect(doc).toContain('<meta charset="utf-8" />');
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(/<title>([^<]*)<\/title>/.exec(doc)?.[1]).toBe(spec.subject);
    for (const tag of [
      "html",
      "head",
      "body",
      "table",
      "tr",
      "td",
      "div",
      "p",
      "h1",
      "a",
      "span",
    ]) {
      const opened = [...doc.matchAll(new RegExp(`<${tag}(?=[\\s>])`, "g"))].length;
      const closed = [...doc.matchAll(new RegExp(`</${tag}>`, "g"))].length;
      expect({ tag, opened }).toEqual({ tag, opened: closed });
    }
    expect([...doc.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
  });

  it("shares the HYDLNK header, card and footer with every other template", () => {
    // One 520px card in a table (the e2e email test treats the card as the only table).
    expect([...doc.matchAll(/<table[\s>]/g)]).toHaveLength(1);
    expect(doc).toContain('<body style="margin:0;padding:0;background:#F4F3F0;">');
    expect(doc).toContain(
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E2DFD9;border-radius:6px;">',
    );
    // Charcoal bar with the brass diamond and the text logo.
    expect(doc).toContain(
      "padding:20px 28px;background:#1C1B1A;border-radius:6px 6px 0 0;font-family:'Public Sans',Helvetica,Arial,sans-serif;font-size:15px;line-height:20px;font-weight:700;letter-spacing:2px;color:#F4F3F0;",
    );
    expect(doc).toContain(
      '<span aria-hidden="true" style="color:#B8914F;">&#9670;</span>&nbsp; HYDLNK',
    );
    // Heading and body copy tokens: ink and text-2.
    expect(doc).toContain(
      '<h1 style="margin:0;font-size:24px;line-height:30px;font-weight:700;color:#1C1B1A;">',
    );
    expect(doc).toContain(
      '<p style="margin:12px 0 0 0;font-size:16px;line-height:24px;color:#5E5A54;">',
    );
    // Footer cell, last in the card.
    const footer = lastCell(doc);
    expect(footer).toContain(
      "padding:16px 28px 32px 28px;font-family:'Public Sans',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#5E5A54;",
    );
    expect(footer).toContain(spec.footer);
    // Colours are DESIGN.md tokens only.
    const allowedColours = new Set([
      "#1C1B1A", // ink
      "#5E5A54", // text-2
      "#E2DFD9", // line
      "#F4F3F0", // page
      "#FFFFFF", // surface
      "#B8914F", // brass (logo diamond only)
    ]);
    const used = new Set([...doc.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()));
    expect([...used].filter((c) => !allowedColours.has(c))).toEqual([]);
    // Brass is the logo diamond and nothing else.
    expect([...doc.matchAll(/#B8914F/gi)]).toHaveLength(1);
  });

  it("has a plain-text preheader, hidden, with no variables or markup", () => {
    const preheader =
      /<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F3F0;opacity:0;">([^<]*)<\/div>/.exec(
        doc,
      )?.[1];
    expect(preheader).toBeTruthy();
    expect(preheader).toMatch(/^[\w .,’'-]+$/);
    expect(preheader!.length).toBeLessThanOrEqual(90);
    // It sits first in <body>, before the card.
    expect(doc.indexOf(preheader!)).toBeLessThan(doc.indexOf("<table"));
  });

  it("uses only the variables Supabase documents for this template", () => {
    const used = variablesIn(doc);
    expect(used.every((v) => /^\.[A-Za-z]+$/.test(v))).toBe(true);
    const names = used.map((v) => v.slice(1));
    expect(names.every((v) => (spec.variables as readonly string[]).includes(v))).toBe(true);
    // Every variable the template declares is actually used (no dead entries in the spec).
    expect([...new Set(names)].sort()).toEqual([...spec.variables].sort());
    // No half-open braces left over once the variables are removed.
    expect(doc.replace(/\{\{.*?\}\}/g, "")).not.toMatch(/\{\{|\}\}/);
    expect(doc).not.toContain("ConfirmationURL");
  });

  it("sets every address or phone number in a breakable element, so a long one cannot scroll the card", () => {
    const personal = /\{\{\s*\.(Email|NewEmail|OldEmail|Phone|OldPhone)\s*\}\}/g;
    for (const match of doc.matchAll(personal)) {
      const tagStart = doc.lastIndexOf("<", match.index);
      const tag = doc.slice(tagStart, doc.indexOf(">", tagStart) + 1);
      expect({ variable: match[0], tag }).toEqual({
        variable: match[0],
        tag: expect.stringContaining("word-break:break-all;"),
      });
    }
  });

  it("links only to HYDLNK, with exactly the links this template is meant to carry", () => {
    const anchors = anchorsIn(doc);
    expect(anchors).toEqual(spec.anchors);
    expect(anchors.every((a) => a.href.startsWith(`${SITE}/`))).toBe(true);
    // Nothing is loaded or linked from another host.
    expect(doc).not.toMatch(/https?:\/\//i);
    expect(doc).not.toMatch(/<(img|link|iframe|form|object|embed|video|audio|source)[\s>]/i);
    expect(doc).not.toMatch(/url\(|@import|<style|xmlns/i);
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/\son[a-z]+\s*=/i);
    expect(doc).not.toMatch(/\bhref="(?!\{\{ \.SiteURL \}\}\/)/);
  });

  if (spec.button) {
    it("has a charcoal button: 48px tall, 6px radius, Public Sans, white text", () => {
      const button = /<a\s[^>]*style="([^"]*)"/.exec(doc)![1]!;
      expect(button).toContain("display:inline-block;min-height:48px;");
      expect(button).toContain("background:#1C1B1A;border-radius:6px;");
      expect(button).toContain("font-family:'Public Sans',Helvetica,Arial,sans-serif;");
      expect(button).toContain("font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;");
      expect(isSentenceCase(spec.anchors[0]!.text)).toBe(true);
    });
  }

  it("follows the copy rules: sentence case, no please, no exclamation marks, no successfully", () => {
    expect(visible).not.toMatch(/\bplease\b/i);
    expect(visible).not.toMatch(/successful/i);
    // The e2e email test also requires no "!" anywhere in the HTML after the doctype (no comments,
    // no conditional comments, no !important).
    expect(withoutDoctype(doc)).not.toContain("!");
    const heading = /<h1[^>]*>([^<]*)<\/h1>/.exec(doc)![1]!;
    expect(isSentenceCase(heading)).toBe(true);
    // Typographic apostrophes in the body copy, like magic-link.html.
    expect(visible).not.toContain("'");
  });

  it("is a safe email: no token, callback or sign-in link unless this template is meant to have one", () => {
    const tokenLink = spec.anchors.some((a) => a.href.includes("token_hash="));
    expect(doc.includes("{{ .TokenHash }}")).toBe(tokenLink);
    expect(doc.includes("/auth/callback")).toBe(tokenLink);
    expect(doc.includes("{{ .Token }}")).toBe(spec.file === "reauthentication.html");
  });
});

// --- specific templates ---------------------------------------------------------------------

describe("sign-in links (confirmation and magic link)", () => {
  // The callback (src/lib/auth/callback.ts, server-only) accepts only these token-hash types.
  const callbackSource = read(`${ROOT}src/lib/auth/callback.ts`);
  const accepted = new Set(
    [
      ...(
        /EMAIL_LINK_TYPES[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(callbackSource)?.[1] ?? ""
      ).matchAll(/"(\w+)"/g),
    ].map((m) => m[1]!),
  );

  it("reads the accepted types from the callback", () => {
    expect([...accepted].sort()).toEqual(["email", "magiclink", "signup"]);
  });

  it.each(["confirmation.html", "magic-link.html"])("%s signs in with type=email", (file) => {
    const doc = html.get(file)!;
    expect(doc).toContain(`href="${CALLBACK("email")}"`);
    expect(accepted.has("email")).toBe(true);
  });

  it("email-change.html carries a type the callback rejects, so it can never sign anyone in", () => {
    const doc = html.get("email-change.html")!;
    expect(doc).toContain(`href="${CALLBACK("email_change")}"`);
    expect(accepted.has("email_change")).toBe(false);
  });

  it("only those three templates carry a token hash", () => {
    const withHash = TEMPLATES.filter((t) => source(t).includes("TokenHash")).map((t) => t.file);
    expect(withHash.sort()).toEqual(["confirmation.html", "email-change.html", "magic-link.html"]);
  });
});

describe("recovery.html and invite.html", () => {
  it.each(["recovery.html", "invite.html"])("%s has no token of any kind", (file) => {
    const doc = html.get(file)!;
    expect(doc).not.toMatch(/Token|token_hash|ConfirmationURL|\/auth\/callback/);
  });

  it("recovery says HYDLNK has no passwords and sends people to /login", () => {
    const doc = html.get("recovery.html")!;
    expect(visibleText(doc)).toContain(
      "HYDLNK doesn’t use passwords. To get into your account, request a sign-in link.",
    );
    expect(anchorsIn(doc)).toEqual([{ href: `${SITE}/login`, text: "Request a sign-in link" }]);
  });

  it("invite sends people to sign up", () => {
    expect(anchorsIn(html.get("invite.html")!)).toEqual([
      { href: `${SITE}/signup`, text: "Create your page" },
    ]);
  });
});

describe("email-change.html", () => {
  const doc = html.get("email-change.html")!;

  it("shows the old and new address and points to sign in", () => {
    expect(doc).toContain("{{ .Email }} &rarr; {{ .NewEmail }}");
    expect(visibleText(doc)).toContain("sign in and check your account");
  });

  it("breaks long addresses instead of scrolling sideways", () => {
    expect(doc).toContain("word-break:break-all;");
  });
});

describe("reauthentication.html", () => {
  const doc = html.get("reauthentication.html")!;

  it("shows the one-time code in large mono text and nothing to click", () => {
    expect(doc).toContain("{{ .Token }}");
    expect(doc).toMatch(
      /font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:32px;[^"]*">\{\{ \.Token \}\}</,
    );
    expect(anchorsIn(doc)).toEqual([]);
    expect(doc).not.toContain("TokenHash");
  });

  it("says the code is short-lived, without naming an expiry", () => {
    const text = visibleText(doc);
    expect(text).toContain("next few minutes");
    expect(text).toContain("Don’t share this code with anyone.");
  });
});

describe("security notifications", () => {
  it.each(NOTIFICATIONS.map((n) => [n.file, n] as const))(
    "%s tells people what to do",
    (_file, spec) => {
      const text = visibleText(source(spec));
      expect(text).toContain(NOT_YOU);
      expect(text).toContain(THIS_WAS_YOU);
    },
  );
});

// --- all emails: layout ---------------------------------------------------------------------

describe("layout", () => {
  it("never sets a fixed width above 600px (the card is 100% wide up to 520px)", () => {
    for (const spec of TEMPLATES) {
      const widths = [...source(spec).matchAll(/\bwidth:\s*(\d+)px/g)].map((m) => Number(m[1]));
      expect(Math.max(...widths, 0)).toBeLessThanOrEqual(600);
    }
  });
});

// --- supabase/config.toml wiring ------------------------------------------------------------

describe("supabase/config.toml", () => {
  const sections = parseSections(read(`${ROOT}supabase/config.toml`));

  it.each(TEMPLATES.map((t) => [t.section, t] as const))("wires %s", (section, spec) => {
    const config = sections.get(section);
    expect(config).toBeDefined();
    expect(config!.subject).toBe(spec.subject);
    if (section.startsWith("auth.email.notification.")) {
      // The CLI resolves a notification's content_path from supabase/, a template's from the repo root.
      expect(config!.content_path).toBe(`./templates/${spec.file}`);
      expect(config!.enabled).toBe(true);
    } else {
      expect(config!.content_path).toBe(`./supabase/templates/${spec.file}`);
    }
    // Both spellings must land on the real file.
    const base = section.startsWith("auth.email.notification.") ? `${ROOT}supabase` : ROOT;
    const resolved = resolve(base, config!.content_path as string);
    expect(existsSync(resolved)).toBe(true);
    expect(resolved).toBe(resolve(TEMPLATES_DIR, spec.file));
  });

  it("wires nothing else", () => {
    const wired = [...sections.keys()].filter((k) =>
      /^auth\.email\.(template|notification)\./.test(k),
    );
    expect(wired.sort()).toEqual(TEMPLATES.map((t) => t.section).sort());
  });

  it("uses a different subject for every email", () => {
    const subjects = TEMPLATES.map((t) => t.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
  });
});
